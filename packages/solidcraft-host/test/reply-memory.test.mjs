// The reply memory of one run (src/reply-memory.mjs; second pilot, Q7). No kernel: a fake bridge that counts what really ran and keeps "what SolidCraft holds".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyMemory, sameBodies, keyOf } from '../src/reply-memory.mjs';

const box = (n = 10) => ({ command: 'solid.box', params: { length: n, width: n, height: n, body_name: 'b_box1' } });
const cyl = (r = 2) => ({ command: 'solid.cylinder', params: { radius: r, height: 30, body_name: 'tool' } });
const bad = () => ({ command: 'solid.cylinder', params: { radius: -1, height: 1 } });

/** A bridge with the semantics of upstream-bridge.mjs: a budget stop does not touch the design; a failed run leaves what it built. */
function fakeBridge({ cpuMs = () => 100, timeOutOver = Infinity } = {}) {
  const b = {
    design: [], log: [],
    volumeOf: (cmds) => cmds.reduce((v, c) => v + (c.command === 'solid.box' ? c.params.length ** 3 : -c.params.radius), 0),
    replyOf(cmds) { return { ok: true, measure: { bodies: cmds.length ? [{ name: 'b_box1', volume_mm3: b.volumeOf(cmds), faces: 6 + cmds.length - 1 }] : [] }, sketches: [] }; },
    async execute(cmds, opts = {}) {
      b.log.push(['execute', cmds.length, opts.budgetS ?? null]);
      const t = cpuMs(cmds);
      if (opts.budgetS && t > Math.min(opts.budgetS * 1000, timeOutOver)) return { ok: false, timedOut: true, cpuMs: opts.budgetS * 1000, failed: { command: '(budget)' } };
      if (opts.probeError) return { ok: false, probeError: true, failed: { command: '(probe)' } };
      const start = opts.fresh ? [] : b.design;
      const i = cmds.findIndex((c) => c.params.radius < 0);
      if (i >= 0) { b.design = [...start, ...cmds.slice(0, i)]; return { ok: false, failed: { index: i, command: cmds[i].command }, ...b.replyOf(b.design), ...{ ok: false } }; }
      b.design = [...start, ...cmds];
      return { ...b.replyOf(b.design), ...(opts.budgetS ? { cpuMs: t } : {}) };
    },
    async topologyOf(cmds) {
      b.log.push(['topologyOf', cmds.length]);
      if (cmds.some((c) => c.params.radius < 0)) { b.design = []; return { ok: false, failed: { error: 'bad' } }; }
      b.design = [...cmds];
      return { ok: true, topology: { bodies: [{ name: 'b_box1', faces: [], edges: [] }] }, measure: b.replyOf(cmds).measure };
    },
    async inspect() { b.log.push(['inspect']); return { ok: true, ...b.replyOf(b.design) }; },
  };
  return b;
}
const ran = (b, what) => b.log.filter((x) => x[0] === what).length;

test('the same list is run once and answered from memory, as an equal but separate reply', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const a1 = await m.execute([box(), cyl()], { fresh: true });
  const a2 = await m.execute([box(), cyl()], { fresh: true });
  assert.equal(ran(b, 'execute'), 1);
  assert.deepEqual(a2, a1);
  assert.notEqual(a2, a1);
  a2.measure.bodies[0].volume_mm3 = -1; // a caller that changes its reply does not change the memory
  assert.equal((await m.execute([box(), cyl()], { fresh: true })).measure.bodies[0].volume_mm3, 998);
  assert.deepEqual([m.runs, m.hits], [1, 2]);
});

test('a different list, however close, is run', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  await m.execute([box(), cyl(2)], { fresh: true });
  await m.execute([box(), cyl(2.0000001)], { fresh: true });
  await m.execute([box()], { fresh: true });
  assert.equal(ran(b, 'execute'), 3);
});

test('a run under the time budget and a run without one are kept apart (the budgeted reply carries cpuMs, the other does not)', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const withB = await m.execute([box()], { fresh: true, budgetS: 45 });
  const without = await m.execute([box()], { fresh: true });
  assert.equal(ran(b, 'execute'), 2);
  assert.equal(withB.cpuMs, 100); assert.equal(without.cpuMs, undefined);
  assert.equal((await m.execute([box()], { fresh: true, budgetS: 45 })).cpuMs, 100); // from memory, with the time it took
  assert.equal(ran(b, 'execute'), 2);
});

test('a run stopped by the budget is not remembered, and leaves what SolidCraft holds as it was', async () => {
  const b = fakeBridge({ cpuMs: (cmds) => (cmds.length > 1 ? 9000 : 100) }); const m = createReplyMemory(b);
  await m.execute([box()], { fresh: true, budgetS: 5 });
  const held = m.page;
  const r = await m.execute([box(), cyl()], { fresh: true, budgetS: 5 });
  assert.equal(r.timedOut, true);
  assert.equal(m.page, held); // SolidCraft was not touched
  await m.execute([box(), cyl()], { fresh: true, budgetS: 5 });
  assert.equal(ran(b, 'execute'), 3); // asked again, run again
  assert.deepEqual(await m.heldReply([box()]), await b.execute([box()], { fresh: true, budgetS: 5 }));
});

test('a remembered reply is not used under a budget smaller than the time it took', async () => {
  const b = fakeBridge({ cpuMs: () => 8000 }); const m = createReplyMemory(b);
  assert.equal((await m.execute([box()], { fresh: true, budgetS: 45 })).ok, true);
  const r = await m.execute([box()], { fresh: true, budgetS: 5 });
  assert.equal(ran(b, 'execute'), 2);
  assert.equal(r.timedOut, true); // what the engine says under 5 s, not the 45 s answer
  assert.equal((await m.execute([box()], { fresh: true, budgetS: 10 })).ok, true); // 8 s fits in 10 s: from memory
  assert.equal(ran(b, 'execute'), 2);
});

test('a failed run is remembered as failed, and after it nothing is held', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  await m.execute([box()], { fresh: true });
  const r = await m.execute([box(), bad()], { fresh: true });
  assert.equal(r.ok, false);
  assert.equal(m.page, null);
  assert.equal(await m.heldReply([box(), bad()]), null);
  assert.equal(await m.heldReply([box()]), null); // SolidCraft holds a box, but not by a run of [box] to its end
  assert.equal((await m.execute([box(), bad()], { fresh: true })).ok, false);
  assert.equal(ran(b, 'execute'), 2);
});

test('topology readings are remembered; a failed one is not', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const t1 = await m.topologyOf([box()]); const t2 = await m.topologyOf([box()]);
  assert.equal(ran(b, 'topologyOf'), 1); assert.deepEqual(t2, t1); assert.notEqual(t2, t1);
  await m.topologyOf([box(), bad()]); await m.topologyOf([box(), bad()]);
  assert.equal(ran(b, 'topologyOf'), 3);
  assert.equal(m.page, null);
});

test('heldReply: the reply of the list SolidCraft last ran, and only that list', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const whole = await m.execute([box(), cyl()], { fresh: true, budgetS: 45 });
  assert.deepEqual(await m.heldReply([box(), cyl()]), whole);
  assert.equal(await m.heldReply([box()]), null);
  // the layer then tries a variant (a check, a refused step): SolidCraft holds the variant, not the accepted list
  await m.execute([box(), cyl(3)], { fresh: true });
  assert.equal(await m.heldReply([box(), cyl()]), null);
  // an answer from memory does not move SolidCraft: it still holds the variant
  await m.execute([box(), cyl()], { fresh: true, budgetS: 45 });
  assert.equal(await m.heldReply([box(), cyl()]), null);
  assert.deepEqual((await m.heldReply([box(), cyl(3)])).measure, b.replyOf([box(), cyl(3)]).measure);
});

test('heldReply: after a topology reading of the accepted list, the execute reply of that list is the one returned', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const whole = await m.execute([box(), cyl()], { fresh: true });
  await m.execute([box()], { fresh: true });
  await m.topologyOf([box(), cyl()]);
  assert.deepEqual(await m.heldReply([box(), cyl()]), whole);
  // a topology reading of a list that was never executed gives nothing to return
  await m.topologyOf([box(), cyl(5)]);
  assert.equal(await m.heldReply([box(), cyl(5)]), null);
});

test('heldReply: a run that did not start from an empty design leaves nothing held', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  await m.execute([box()], { fresh: true });
  await m.execute([cyl()], { fresh: false });
  assert.equal(m.page, null);
  assert.equal(await m.heldReply([cyl()]), null);
});

test('heldReply reads SolidCraft itself: when it shows other bodies than the remembered reply, nothing is returned', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  await m.execute([box(), cyl()], { fresh: true });
  b.design = [box(11), cyl()]; // something moved SolidCraft behind the memory's back
  assert.equal(await m.heldReply([box(), cyl()]), null);
  b.design = [box(), cyl()];
  assert.notEqual(await m.heldReply([box(), cyl()]), null);
  b.inspect = async () => { throw new Error('gone'); };
  assert.equal(await m.heldReply([box(), cyl()]), null);
});

test('sameBodies is exact: one digit, one face, one name or one body more is a difference', () => {
  const r = (bodies) => ({ measure: { bodies } });
  const a = { name: 'b', volume_mm3: 1000, faces: 6 };
  assert.equal(sameBodies(r([a]), r([{ ...a }])), true);
  assert.equal(sameBodies(r([a]), r([{ ...a, volume_mm3: 1000 + 2e-13 }])), false);
  assert.equal(sameBodies(r([a]), r([{ ...a, faces: 7 }])), false);
  assert.equal(sameBodies(r([a]), r([{ ...a, name: 'c' }])), false);
  assert.equal(sameBodies(r([a]), r([a, a])), false);
  assert.equal(sameBodies(r([]), r([])), true);
  assert.equal(sameBodies({}, r([])), false);
  assert.equal(sameBodies(null, undefined), false);
});

test('the key is the list itself: the same commands in another order are another list', () => {
  assert.notEqual(keyOf([box(), cyl()]), keyOf([cyl(), box()]));
  assert.equal(keyOf([box(), cyl()]), keyOf([box(), cyl()]));
});

test('replay: the run that puts SolidCraft on a list is never answered from memory, and the bridge is not handed the word', async () => {
  const b = fakeBridge(); const m = createReplyMemory(b);
  const seen = []; const inner = b.execute; b.execute = async (cmds, opts) => { seen.push(Object.keys(opts ?? {}).sort().join(',')); return inner(cmds, opts); };
  const first = await m.execute([box(), cyl()], { fresh: true });
  await m.execute([box(), cyl(3)], { fresh: true }); // a variant a guard tried: SolidCraft is left on it
  assert.equal((await m.execute([box(), cyl()], { fresh: true })).ok, true); // from memory: SolidCraft still holds the variant
  assert.deepEqual(b.design, [box(), cyl(3)]);
  const again = await m.execute([box(), cyl()], { fresh: true, replay: true });
  assert.deepEqual(b.design, [box(), cyl()]); // now it holds the list
  assert.deepEqual(again, first);
  assert.deepEqual(seen, ['fresh', 'fresh', 'fresh']);
  assert.deepEqual(await m.heldReply([box(), cyl()]), first);
});

test('the report and SolidCraft agree at the end of a run, whichever way the end is reached', async () => {
  // the page's ending (pane.js run()): the held reply when there is one, else a real replay
  const finish = async (m, cmds) => (await m.heldReply(cmds)) ?? m.execute(cmds, { fresh: true, replay: true });
  for (const tail of [[], [[box(), cyl(3)]], [[box(), cyl(3)], [box(), cyl()]], [[box(), bad()]], [[box()]]]) {
    const b = fakeBridge(); const m = createReplyMemory(b);
    await m.execute([box(), cyl()], { fresh: true });
    for (const t of tail) await m.execute(t, { fresh: true }); // what the guards tried afterwards; the third tail ends on a memory hit
    if (tail.length === 2) assert.equal(m.hits, 1);
    const fin = await finish(m, [box(), cyl()]);
    assert.deepEqual(fin.measure, (await b.inspect()).measure, JSON.stringify(tail.map((t) => t.length)));
    assert.deepEqual(b.design, [box(), cyl()]);
  }
});
