import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamBridge, interiorPoint } from '../src/upstream-bridge.mjs';

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
test('topology and restore answer honestly that they are not built', async () => {
  const b = createUpstreamBridge(fake());
  assert.equal((await b.execute([], { topology: true })).ok, false);
  assert.equal((await b.restorePrevious()).ok, false);
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
