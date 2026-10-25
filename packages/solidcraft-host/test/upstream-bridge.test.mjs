import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamBridge } from '../src/upstream-bridge.mjs';

// a fake upstream with the shapes measured on v0.21.0 (see test/live.mjs): inspect, sketch.inspect, engine.batch with failed
function fake({ failAt = null } = {}) {
  const calls = [];
  const sc = {
    calls,
    inspect: async () => ({ bodies: [{ name: 'b', volume_mm3: 6000, bbox: { min: [0, 0, 0], max: [30, 20, 10] } }], sketches: [{ name: 's1', dof: 6, status: 'solved', curves: 4 }], dirty: true, active_sketch: null }),
    execute: async (command, params) => { calls.push(['execute', command, params]); if (command === 'sketch.inspect') return { profiles: [{ index: 0, area_mm2: 1000, curves: ['l1'], holes: [] }], failing: [], fully_constrained: false, points: [], constraints: [] }; return {}; },
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
