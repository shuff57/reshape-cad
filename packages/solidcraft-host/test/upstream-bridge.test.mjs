import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamBridge, interiorPoint, adaptBody, verifiedInnerPoint, surfaceDistance } from '../src/upstream-bridge.mjs';

// a fake upstream with the shapes measured on v0.21.0 (see test/live.mjs): inspect, sketch.inspect, engine.batch with failed
function fake({ failAt = null } = {}) {
  const calls = [];
  const sc = {
    calls,
    inspect: async () => ({ bodies: [{ name: 'b', volume_mm3: 6000, bbox: { min: [0, 0, 0], max: [30, 20, 10] } }], sketches: [{ name: 's1', dof: 6, status: 'solved', curves: 4 }], dirty: true, active_sketch: null }),
    execute: async (command, params) => { calls.push(['execute', command, params]); if (command === 'sketch.inspect') return { profiles: [{ index: 0, area_mm2: 1000, curves: ['l1'], holes: [] }], failing: [], fully_constrained: false, points: [{ id: 'c1.center', at: [10, 5] }], curves: [{ id: 'c1', type: 'circle', radius: 4 }], constraints: [] }; return {}; },
    request: async (method, params) => { calls.push(['request', method, params]); if (failAt === null) return { completed: params.commands.length }; return { completed: failAt, failed: { index: failAt, command: params.commands[failAt].command, error: 'invalid parameters for `solid.fillet`: `edges` must be a list' } }; },
  };
  return sc;
}

test('fresh starts with file.new, runs one batch without rollback, and returns the pane shape', async () => {
  const sc = fake(); const b = createUpstreamBridge(sc);
  const r = await b.execute([{ command: 'solid.box', params: { length: 30 } }], { fresh: true });
  assert.equal(r.ok, true);
  assert.deepEqual(sc.calls[0], ['execute', 'file.new', {}]);
  assert.equal(sc.calls[1][2].rollback, false);
  assert.equal(r.measure.bodies[0].volume_mm3, 6000);
  assert.equal(r.sketches[0].profile_list[0].area_mm2, 1000);
  assert.deepEqual(r.sketches[0].sketch.points[0], { id: 'c1.center', pos: [10, 5] });
  assert.equal(r.sketches[0].sketch.curves[0].r, 4);
});
test('a failed step is reported with its command, error, index and params', async () => {
  const sc = fake({ failAt: 1 }); const b = createUpstreamBridge(sc);
  const r = await b.execute([{ command: 'solid.box', params: {} }, { command: 'solid.fillet', params: { radius: 1 } }]);
  assert.equal(r.ok, false);
  assert.deepEqual([r.failed.index, r.failed.command, r.failed.params], [1, 'solid.fillet', { radius: 1 }]);
  assert.match(r.failed.error, /edges/);
});
test('not fresh does not reset the design', async () => {
  const sc = fake(); await createUpstreamBridge(sc).execute([{ command: 'solid.box' }]);
  assert.equal(sc.calls.some((c) => c[1] === 'file.new'), false);
});
test('restore answers honestly that it is not built', async () => {
  assert.equal((await createUpstreamBridge(fake()).restorePrevious()).ok, false);
});
test('a request that throws becomes a refusal, not a crash', async () => {
  const sc = fake(); sc.request = async () => { throw new Error('too many pending'); };
  const r = await createUpstreamBridge(sc).execute([{ command: 'solid.box' }]);
  assert.equal(r.ok, false); assert.match(r.failed.error, /too many pending/);
});

test('interior point of a ring is in the ring, not in its hole (the centroid is in the hole)', () => {
  const curves = [{ id: 'c1', type: 'circle', center_at: [0, 0], radius: 10 }, { id: 'c2', type: 'circle', center_at: [0, 0], radius: 4 }];
  const p = interiorPoint({ curves: ['c1'], holes: [['c2']], centroid_sketch: [0, 0] }, curves);
  const r = Math.hypot(p[0], p[1]);
  assert.ok(r > 4.5 && r < 9.5, `radius ${r}`);
});
test('interior point of an L shape is inside the L', () => {
  const L = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]];
  const curves = L.map((a, i) => ({ id: 'l' + i, type: 'line', start_at: a, end_at: L[(i + 1) % L.length] }));
  const p = interiorPoint({ curves: curves.map((c) => c.id), holes: [], centroid_sketch: [14, 12] }, curves);
  assert.ok(p[0] > 0 && p[1] > 0 && (p[0] < 15 || p[1] < 15) && p[0] < 40 && p[1] < 30, JSON.stringify(p));
});
test('arc profile samples counter-clockwise from start to end', () => {
  const curves = [{ id: 'a', type: 'arc', center_at: [0, 0], radius: 10, start_at: [10, 0], end_at: [-10, 0] }, { id: 'l', type: 'line', start_at: [-10, 0], end_at: [10, 0] }];
  const p = interiorPoint({ curves: ['a', 'l'], holes: [] }, curves);
  assert.ok(p[1] > 0, JSON.stringify(p)); // a half disc above the x axis
});


// ---- topology ----------------------------------------------------------------------------------------------------------------------------------
// a 20 x 10 x 5 box as v0.21.0 reports it (measured, names and the `point` of each face are upstream's)
const boxFaces = [
  { index: 0, name: 'F1:-z', area: 200, centroid: [10, 5, 0], plane_normal: [0, 0, -1], point: [16.18, 3.82, 0] },
  { index: 1, name: 'F1:-y', area: 100, centroid: [10, 0, 2.5], plane_normal: [0, -1, 0], point: [17.8, 0, 2.19] },
  { index: 2, name: 'F1:+x', area: 50, centroid: [20, 5, 2.5], plane_normal: [1, 0, 0], point: [20, 8.09, 1.91] },
  { index: 3, name: 'F1:+y', area: 100, centroid: [10, 10, 2.5], plane_normal: [0, 1, 0], point: [2.19, 10, 2.19] },
  { index: 4, name: 'F1:-x', area: 50, centroid: [0, 5, 2.5], plane_normal: [-1, 0, 0], point: [0, 1.91, 1.91] },
  { index: 5, name: 'F1:+z', area: 200, centroid: [10, 5, 5], plane_normal: [0, 0, 1], point: [16.18, 3.82, 5] },
];
const E = (index, name, s, e) => ({ index, name, start: s, end: e, mid: s.map((x, k) => (x + e[k]) / 2), length: Math.hypot(...s.map((x, k) => x - e[k])) });
const boxEdges = [
  E(0, 'F1:-x|F1:-z', [0, 0, 0], [0, 10, 0]), E(1, 'F1:+y|F1:-z', [0, 10, 0], [20, 10, 0]), E(2, 'F1:+x|F1:-z', [20, 10, 0], [20, 0, 0]), E(3, 'F1:-y|F1:-z', [20, 0, 0], [0, 0, 0]),
  E(4, 'F1:+x|F1:-y', [20, 0, 0], [20, 0, 5]), E(5, 'F1:+z|F1:-y', [20, 0, 5], [0, 0, 5]), E(6, 'F1:-x|F1:-y', [0, 0, 5], [0, 0, 0]), E(7, 'F1:+x|F1:+y', [20, 10, 0], [20, 10, 5]),
  E(8, 'F1:+x|F1:+z', [20, 10, 5], [20, 0, 5]), E(9, 'F1:+y|F1:-x', [0, 10, 0], [0, 10, 5]), E(10, 'F1:+y|F1:+z', [0, 10, 5], [20, 10, 5]), E(11, 'F1:+z|F1:-x', [0, 0, 5], [0, 10, 5]),
];
test('a box becomes the layer topology: names, normals, edge ends, and a pick point on every face', () => {
  const b = adaptBody('box1', { faces: boxFaces }, { edges: boxEdges });
  assert.equal(b.faces.length, 6); assert.equal(b.edges.length, 12);
  const top = b.faces.find((f) => f.name === 'F1:+z');
  assert.deepEqual(top.plane_normal, [0, 0, 1]);
  assert.deepEqual(top.inner_point, [16.18, 3.82, 5]);
  assert.deepEqual(top.inner_hit, { index: 5, dist: 0 });
  assert.equal(b.faces.every((f) => f.inner_hit && f.inner_hit.index === f.index), true);
  assert.equal(b.faces.some((f) => 'centroid_hit' in f), false, 'centroid_hit is not derivable and must not appear');
  assert.equal(b.edges[10].name, 'F1:+y|F1:+z');
  assert.deepEqual(b.edges[10].mid, [10, 10, 5]);
});
test('a pick point off the face plane is not passed on', () => {
  const faces = boxFaces.map((f) => (f.name === 'F1:+z' ? { ...f, point: [16, 3, 4.5] } : f));
  const b = adaptBody('b', { faces }, { edges: boxEdges });
  const top = b.faces.find((f) => f.name === 'F1:+z');
  assert.equal(top.inner_point, undefined); assert.equal(top.inner_hit, undefined);
  assert.ok(b.faces.find((f) => f.name === 'F1:-z').inner_hit, 'the other faces keep theirs');
});
test('a pick point outside the box of the face boundary is not passed on', () => {
  const faces = boxFaces.map((f) => (f.name === 'F1:+z' ? { ...f, point: [30, 3, 5] } : f));
  assert.equal(adaptBody('b', { faces }, { edges: boxEdges }).faces.find((f) => f.name === 'F1:+z').inner_hit, undefined);
});
test('a point on the plane of another face is ambiguous and is not passed on', () => {
  // on the top face, but at the edge shared with +y: the +y plane is 0 away
  const faces = boxFaces.map((f) => (f.name === 'F1:+z' ? { ...f, point: [10, 10, 5] } : f));
  assert.equal(adaptBody('b', { faces }, { edges: boxEdges }).faces.find((f) => f.name === 'F1:+z').inner_hit, undefined);
});
test('a body with a face whose surface is not described (no normal, no cylinder) gets no pick points at all', () => {
  const faces = [...boxFaces, { index: 6, name: 'F2:ball', area: 5, centroid: [1, 1, 1], plane_normal: null, point: [1, 1, 2] }];
  const b = adaptBody('b', { faces }, { edges: boxEdges });
  assert.equal(b.faces.every((f) => f.inner_hit === undefined), true);
});
test('a cylinder wall is checked against its own radius; the caps against their planes', () => {
  const cyl = { axis: [0, 0, 1], origin: [0, 0, 0], radius: 5 };
  const wall = { index: 1, name: 'F1:side#2', centroid: [-1.8, 2.6, 5], plane_normal: null, cylinder: cyl, point: [-3.1635159780786486, 3.8719719338395344, 9.735618109220722] };
  assert.ok(surfaceDistance(wall, wall.point) < 1e-3);
  assert.ok(surfaceDistance(wall, [0, 0, 5]) > 4.9);
  const faces = [
    { index: 0, name: 'F1:bottom', centroid: [0, 0, 0], plane_normal: [0, 0, -1], point: [0.9, -4.6, 0] },
    wall,
    { index: 3, name: 'F1:top', centroid: [0, 0, 10], plane_normal: [0, 0, 1], point: [0.9, -4.6, 10] },
  ];
  const arc = (i, n, s0, m, e) => ({ index: i, name: n, start: s0, mid: m, end: e, length: 15.7 }); // measured: a half circle reports its start, a mid point and its end
  const edges = [arc(1, 'F1:bottom|F1:side#2', [-4.089340965789886, -2.877028061300868, 0], [-2.8770280613008694, 4.089340965789887, 0], [4.089340965789886, 2.8770280613008694, 0]), arc(3, 'F1:side#2|F1:top', [-4.089340965789886, -2.877028061300868, 10], [-2.8770280613008694, 4.089340965789887, 10], [4.089340965789886, 2.8770280613008694, 10])];
  const b = adaptBody('c', { faces }, { edges });
  assert.ok(b.faces.find((f) => f.name === 'F1:side#2').cylinder);
  // the wall point is in the box of its edges; its distance to the cap planes (9.7 from the bottom, 0.26 from the top) clears the top plane? 0.264 > 1e-3 yes
  assert.ok(b.faces.find((f) => f.name === 'F1:side#2').inner_hit);
});
test('missing faces or edges make the body an error, not an empty success', () => {
  const b = adaptBody('x', null, { edges: [] });
  assert.ok(b.error); assert.deepEqual(b.faces, []);
});
test('verifiedInnerPoint needs a named face and a point', () => {
  assert.equal(verifiedInnerPoint({ ...boxFaces[5], point: undefined }, boxFaces, boxEdges, 20), null);
  assert.equal(verifiedInnerPoint({ ...boxFaces[5], name: '' }, boxFaces, boxEdges, 20), null);
});

function topoFake({ failAt = null, results = true } = {}) {
  const calls = [];
  return {
    calls,
    inspect: async () => ({ bodies: [{ name: 'box1', faces: 6, kernel: { faces: 6 }, volume_mm3: 1000 }], sketches: [], dirty: true }),
    execute: async (command, params) => { calls.push(['execute', command, params]); if (command === 'model.faces') return { body: params.body, faces: boxFaces }; if (command === 'model.edges') return { body: params.body, edges: boxEdges }; return {}; },
    request: async (method, params) => { calls.push(['request', method, params]); if (failAt !== null) return { completed: 0, failed: { index: 0, command: params.commands[0].command, error: 'boom' } }; return { completed: params.commands.length, ...(results ? { results: params.commands.map((c, i) => ({ feature: i + 1 })) } : {}) }; },
  };
}
test('topologyOf replays from an empty design and returns topology, the measure of the same run, and feature numbers', async () => {
  const sc = topoFake(); const cmds = [{ command: 'solid.box', params: { length: 20, body_name: 'box1' } }];
  const r = await createUpstreamBridge(sc).topologyOf(cmds);
  assert.equal(r.ok, true);
  assert.deepEqual(sc.calls[0], ['execute', 'file.new', {}]);
  assert.equal(sc.calls[1][2].rollback, false);
  assert.deepEqual(sc.calls.filter((c) => c[1] === 'model.faces' || c[1] === 'model.edges').map((c) => c[2]), [{ body: 'box1' }, { body: 'box1' }]);
  assert.equal(r.topology.bodies[0].name, 'box1'); assert.equal(r.topology.bodies[0].faces.length, 6);
  assert.equal(r.measure.bodies[0].faces, 6);
  assert.deepEqual(r.results, [{ feature: 1 }]);
});
test('execute(..., {topology:true}) is the same answer', async () => {
  const r = await createUpstreamBridge(topoFake()).execute([{ command: 'solid.box', params: {} }], { topology: true });
  assert.equal(r.ok, true); assert.ok(r.topology);
});
test('a batch that fails makes the topology answer ok:false with the error', async () => {
  const r = await createUpstreamBridge(topoFake({ failAt: 0 })).topologyOf([{ command: 'solid.box', params: {} }]);
  assert.equal(r.ok, false); assert.equal(r.failed.error, 'boom');
});
test('no per-command results from upstream means no feature numbers are claimed', async () => {
  const r = await createUpstreamBridge(topoFake({ results: false })).topologyOf([{ command: 'solid.box', params: {} }]);
  assert.equal(r.ok, true); assert.equal(r.results, undefined);
});
test('model.faces throwing marks that body as an error', async () => {
  const sc = topoFake(); sc.execute = async (c) => { if (c === 'model.faces') throw new Error('no body'); return {}; };
  const r = await createUpstreamBridge(sc).topologyOf([{ command: 'solid.box', params: {} }]);
  assert.equal(r.ok, true); assert.ok(r.topology.bodies[0].error);
});
