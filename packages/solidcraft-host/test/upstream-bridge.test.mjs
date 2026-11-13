import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamBridge, interiorPoint, adaptBody, verifiedInnerPoint, surfaceDistance, coneOfFace, coneDistance } from '../src/upstream-bridge.mjs';

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

// ---- a countersink's cone, worked out from upstream's own edges (measured on SolidCraft 0.30.1 in the page: test/topology-countersink-0.30.1.json) --------
import { readFileSync } from 'node:fs';
const CS = JSON.parse(readFileSync(new URL('./topology-countersink-0.30.1.json', import.meta.url), 'utf8'));
const csFaces = (k) => CS[k].faces.faces; const csEdges = (k) => CS[k].edges.edges;
test('the cone of a countersink along z is found from its edges: axis z, mouth radius 4 at the top, bore radius 2 where it ends', () => {
  const f = csFaces('csink').find((x) => x.name === 'F2:csink:side:0');
  const k = coneOfFace(f, csEdges('csink'), 40);
  assert.ok(k); assert.ok(Math.abs(Math.abs(k.axis[2]) - 1) < 1e-9);
  const rs = [k.r0, k.r1].sort((a, b) => a - b); assert.ok(Math.abs(rs[0] - 2) < 1e-6 && Math.abs(rs[1] - 4) < 1e-6);
  assert.ok(Math.abs(Math.abs(k.t1) - 2) < 1e-6, 'a 90 degree cone from radius 4 to radius 2 is 2 deep');
  // a point on the cone (radius 3 one down from the mouth) is on it; the hole's axis one down is 3 * cos(45) away; a point on the top face 6 from the axis is 2 * cos(45) away
  assert.ok(coneDistance(k, [8 + 3, 3, 4]) < 1e-6);
  assert.ok(Math.abs(coneDistance(k, [8, 3, 4]) - 3 * Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(coneDistance(k, [8 + 6, 3, 5]) - 2 * Math.SQRT1_2) < 1e-6);
});
test('a part with a countersink keeps the pick points of its flat faces (along z, along x, and beside a counterbore)', () => {
  for (const key of ['csink', 'csink-x', 'two']) {
    const b = adaptBody('b_box1', CS[key].faces, CS[key].edges);
    for (const n of ['F1:+z', 'F1:-z', 'F1:+x', 'F1:-x', 'F1:+y', 'F1:-y']) assert.ok(b.faces.find((f) => f.name === n).inner_hit, `${key}: ${n} has a pick point`);
    for (const f of b.faces.filter((x) => /csink:side/.test(x.name))) assert.equal(f.inner_hit, undefined, `${key}: the cone face ${f.name} itself gets none`);
  }
});
test('a pick point on the cone, or within the clearance of it, is not passed on', () => {
  // on the top face, on the mouth circle (radius 4 about [8, 3]): 0 from the cone
  const faces = csFaces('csink').map((f) => (f.name === 'F1:+z' ? { ...f, point: [12, 3, 5] } : f));
  assert.equal(adaptBody('b', { faces }, CS.csink.edges).faces.find((f) => f.name === 'F1:+z').inner_hit, undefined);
});
test('a cone is not assumed: another name, a missing generator, a bent edge or a second axis leaves the body without pick points', () => {
  const none = (faces, edges) => assert.equal(adaptBody('b', { faces }, { edges }).faces.every((f) => f.inner_hit === undefined), true);
  const F = csFaces('csink'), E = csEdges('csink');
  // not named as a countersink's side
  none(F.map((f) => ({ ...f, name: f.name.replace('csink:side', 'ball') })), E.map((e) => ({ ...e, name: e.name.replaceAll('csink:side', 'ball') })));
  // no straight edge on the face (the generators are gone)
  none(F, E.filter((e) => !/csink:side:0\|F2:csink:side:1/.test(e.name)));
  // a generator that is not straight
  none(F, E.map((e) => (/csink:side:0\|F2:csink:side:1~1/.test(e.name) ? { ...e, mid: [e.mid[0] + 0.3, e.mid[1], e.mid[2]] } : e)));
  // a mouth vertex moved off the mouth circle's height (the far group is no longer in one plane)
  none(F, E.map((e) => ({ ...e, start: e.start.map((v, k) => (k === 2 && Math.abs(e.start[0] - 4.728) < 1e-2 && Math.abs(v - 5) < 1e-9 ? 4.9 : v)), end: e.end.map((v, k) => (k === 2 && Math.abs(e.end[0] - 4.728) < 1e-2 && Math.abs(v - 5) < 1e-9 ? 4.9 : v)) })));
});

// ---- held: run only the commands after the ones SolidCraft already holds (second pilot, Q7) ------------------------------------------------------------
const three = () => [{ command: 'solid.box', params: { length: 30 } }, { command: 'solid.cylinder', params: { radius: 2 } }, { command: 'solid.fillet', params: { radius: 1 } }];
const sent = (sc) => sc.calls.filter((c) => c[0] === 'request').map((c) => c[2].commands.map((x) => x.command));
const news = (sc) => sc.calls.filter((c) => c[1] === 'file.new').length;

test('execute with held: no file.new, only the rest is sent, and completed counts the whole list', async () => {
  const sc = fake(); const r = await createUpstreamBridge(sc).execute(three(), { fresh: true, held: 2 });
  assert.equal(r.ok, true);
  assert.equal(news(sc), 0);
  assert.deepEqual(sent(sc), [['solid.fillet']]);
  assert.equal(r.completed, 3);
});
test('execute with held equal to the whole list runs nothing and reads the design', async () => {
  const sc = fake(); const r = await createUpstreamBridge(sc).execute(three(), { fresh: true, held: 3 });
  assert.equal(r.ok, true); assert.equal(news(sc), 0); assert.deepEqual(sent(sc), []);
  assert.equal(r.completed, 3); assert.equal(r.measure.bodies[0].volume_mm3, 6000);
});
test('a failure in a continued run is reported at its place in the whole list, with that command\'s params', async () => {
  const sc = fake({ failAt: 0 }); const r = await createUpstreamBridge(sc).execute(three(), { fresh: true, held: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.failed.index, 2); assert.equal(r.failed.command, 'solid.fillet'); assert.deepEqual(r.failed.params, { radius: 1 });
});
test('held is only a statement about a fresh run, and only a whole number within the list: anything else starts from empty', async () => {
  for (const held of [0, -1, 4, 1.5, '2', null, NaN]) {
    const sc = fake(); await createUpstreamBridge(sc).execute(three(), { fresh: true, held });
    assert.equal(news(sc), 1, String(held)); assert.deepEqual(sent(sc), [['solid.box', 'solid.cylinder', 'solid.fillet']], String(held));
  }
  const sc = fake(); await createUpstreamBridge(sc).execute(three(), { fresh: false, held: 2 }); // not fresh: the list is added to what is there, all of it
  assert.equal(news(sc), 0); assert.deepEqual(sent(sc), [['solid.box', 'solid.cylinder', 'solid.fillet']]);
});
test('the time budget judges the whole list, also when only the rest is run', async () => {
  const probed = []; const prober = { probe: async (cmds, b) => { probed.push([cmds.length, b]); return { status: 'done', cpuMs: 7, loadMs: 1, reply: { measure: { bodies: [] } } }; } };
  const sc = fake(); const r = await createUpstreamBridge(sc, { prober }).execute(three(), { fresh: true, held: 2, budgetS: 45 });
  assert.deepEqual(probed, [[3, 45]]); assert.deepEqual(sent(sc), [['solid.fillet']]); assert.equal(r.cpuMs, 7);
  const stop = { probe: async () => ({ status: 'timedOut', cpuMs: 45000 }) };
  const sc2 = fake(); const r2 = await createUpstreamBridge(sc2, { prober: stop }).execute(three(), { fresh: true, held: 2, budgetS: 45 });
  assert.equal(r2.timedOut, true); assert.deepEqual(sc2.calls, []); // SolidCraft not touched
});
test('the reply is what it always was unless `features` is asked for; then `ran` is the feature numbers of the commands this call ran', async () => {
  const cmds = three();
  const plain = await createUpstreamBridge(topoFake()).execute(cmds, { fresh: true });
  assert.equal('ran' in plain, false);
  const all = await createUpstreamBridge(topoFake()).execute(cmds, { fresh: true, features: true });
  assert.deepEqual(all.ran, [{ feature: 1 }, { feature: 2 }, { feature: 3 }]);
  const { ran: _r, ...rest } = all; assert.deepEqual(rest, plain);
  const some = await createUpstreamBridge(topoFake()).execute(cmds, { fresh: true, features: true, held: 2 });
  assert.equal(some.ran.length, 1);
  assert.deepEqual((await createUpstreamBridge(topoFake()).execute(cmds, { fresh: true, features: true, held: 3 })).ran, []);
  assert.equal('ran' in await createUpstreamBridge(topoFake({ results: false })).execute(cmds, { fresh: true, features: true }), false);
});
test('topologyOf with held and the held commands\' feature numbers: only the rest is run, and the reply has a number for every command', async () => {
  const cmds = three(); const heldResults = [{ feature: 11 }, { feature: 12 }];
  const sc = topoFake(); const r = await createUpstreamBridge(sc).topologyOf(cmds, { held: 2, heldResults });
  assert.equal(r.ok, true); assert.equal(news(sc), 0); assert.deepEqual(sent(sc), [['solid.fillet']]);
  assert.deepEqual(r.results, [{ feature: 11 }, { feature: 12 }, { feature: 1 }]); // the fake numbers its own batch from 1; upstream goes on counting
  assert.equal(r.topology.bodies[0].faces.length, 6);
  const sc2 = topoFake(); const r2 = await createUpstreamBridge(sc2).topologyOf(cmds, { held: 3, heldResults: [...heldResults, { feature: 13 }] });
  assert.deepEqual(sent(sc2), []); assert.equal(news(sc2), 0); assert.deepEqual(r2.results.map((x) => x.feature), [11, 12, 13]);
});
test('topologyOf without the held feature numbers, or with the wrong count of them, starts from empty', async () => {
  for (const o of [{ held: 2 }, { held: 2, heldResults: [{ feature: 1 }] }, { held: 5, heldResults: [1, 2, 3, 4, 5].map((feature) => ({ feature })) }, { heldResults: [{ feature: 1 }] }]) {
    const sc = topoFake(); const r = await createUpstreamBridge(sc).topologyOf(three(), o);
    assert.equal(news(sc), 1, JSON.stringify(o)); assert.equal(sent(sc)[0].length, 3); assert.deepEqual(r.results.map((x) => x.feature), [1, 2, 3]);
  }
});

// ---- the box of a curved edge (found 2026-11-13: every pick on a cylinder was refused in the page; test/topology-cylinder-0.30.1.json is that cylinder) ------
import { edgeBox } from '../src/upstream-bridge.mjs';
const CYL = JSON.parse(readFileSync(new URL('./topology-cylinder-0.30.1.json', import.meta.url), 'utf8'));
const closeTo = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('a half circle reaches a radius beyond its three points: the box of the two arcs of a cap is the box of the circle', () => {
  const arcs = CYL.edges.edges.filter((e) => e.name.startsWith('F1:bottom|'));
  assert.equal(arcs.length, 2);
  const boxes = arcs.map((e) => edgeBox(e, [0, 0, 1], 3e-5));
  const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[0][k]))), hi = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b[1][k])));
  // the cylinder: radius 12 about (5, 3), the cap at z = -13
  closeTo(lo[0], -7, 1e-6); closeTo(hi[0], 17, 1e-6); closeTo(lo[1], -9, 1e-6); closeTo(hi[1], 15, 1e-6); closeTo(lo[2], -13, 1e-9); closeTo(hi[2], -13, 1e-9);
  // and the three points alone fall short of it, which is what refused the pick
  const three = arcs.flatMap((e) => [e.start, e.mid, e.end]);
  assert.ok(Math.max(...three.map((p) => p[1])) < 13);
});
test('one arc is boxed as the arc, not as its whole circle', () => {
  // a quarter of the unit circle in the xy plane, from (1,0) to (0,1): it reaches x = 1 and y = 1 at its ends and nowhere beyond
  const q = { start: [1, 0, 0], mid: [Math.SQRT1_2, Math.SQRT1_2, 0], end: [0, 1, 0] };
  const [lo, hi] = edgeBox(q, null, 1e-9);
  closeTo(lo[0], 0); closeTo(lo[1], 0); closeTo(hi[0], 1); closeTo(hi[1], 1);
  // the other three quarters, same ends, mid on the far side: it reaches -1 in both and +1 at its ends
  const [lo3, hi3] = edgeBox({ start: [1, 0, 0], mid: [-Math.SQRT1_2, -Math.SQRT1_2, 0], end: [0, 1, 0] }, null, 1e-9);
  closeTo(lo3[0], -1); closeTo(lo3[1], -1); closeTo(hi3[0], 1); closeTo(hi3[1], 1);
  // run the other way round (end and start swapped) it is the same arc
  const [lo4, hi4] = edgeBox({ start: [0, 1, 0], mid: [-Math.SQRT1_2, -Math.SQRT1_2, 0], end: [1, 0, 0] }, null, 1e-9);
  closeTo(lo4[0], -1); closeTo(lo4[1], -1); closeTo(hi4[0], 1); closeTo(hi4[1], 1);
});
test('a straight edge, and an arc flatter than 1000 chords, keep the box of their three points', () => {
  assert.deepEqual(edgeBox({ start: [0, 0, 0], mid: [1, 1, 1], end: [2, 2, 2] }, null, 1e-9), [[0, 0, 0], [2, 2, 2]]);
  assert.deepEqual(edgeBox({ start: [0, 0, 0], mid: [1, 1e-7, 0], end: [2, 0, 0] }, null, 1e-9), [[0, 0, 0], [2, 1e-7, 0]]);
});
test('a whole circle given as one edge is boxed as the circle when the face says which plane it is in, and as its points when it does not', () => {
  const ring = { start: [3, 0, 5], mid: [-3, 0, 5], end: [3, 0, 5] };
  const [lo, hi] = edgeBox(ring, [0, 0, 2], 1e-9);
  closeTo(lo[0], -3); closeTo(hi[0], 3); closeTo(lo[1], -3); closeTo(hi[1], 3); closeTo(lo[2], 5); closeTo(hi[2], 5);
  assert.deepEqual(edgeBox(ring, null, 1e-9), [[-3, 0, 5], [3, 0, 5]]);
  assert.deepEqual(edgeBox(ring, [1, 0, 0], 1e-9), [[-3, 0, 5], [3, 0, 5]]); // an axis along the diameter cannot be the circle's
});
test('the measured cylinder: both caps keep the pick point upstream gives, and a point off a cap does not pass', () => {
  const b = adaptBody('b_cyl1', CYL.faces, CYL.edges);
  // the two halves of the wall are one cylinder: a point on one is on the other's surface too, so neither gets a pick point (verifiedInnerPoint, as before)
  assert.deepEqual(b.faces.map((f) => [f.name, !!f.inner_point]), [['F1:bottom', true], ['F1:side#2', false], ['F1:side#1', false], ['F1:top', true]]);
  for (const f of b.faces.filter((x) => x.inner_point)) assert.deepEqual(f.inner_hit, { index: f.index, dist: 0 });
  const faces = CYL.faces.faces, edges = CYL.edges.edges; const cap = faces.find((f) => f.name === 'F1:top');
  const at = (point) => { const moved = { ...cap, point }; return verifiedInnerPoint(moved, faces.map((f) => (f === cap ? moved : f)), edges, 30); };
  assert.notEqual(at([5, 3, 17]), null); // the middle of the cap
  assert.equal(at([5, 16, 17]), null); // on its plane, 1 past the rim: outside the box of the circle
  assert.equal(at([18, 3, 17]), null);
  assert.equal(at([5, 3, 16]), null); // not on the plane
  assert.equal(at([5, 14.9995, 17]), null); // on the cap but within the clearance of the wall
});
