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

// ---- run only the new steps (continueRuns) ---------------------------------------------------------------------------------------------------------------
import { compareReplies } from '../src/reply-memory.mjs';

/**
 * SolidCraft as the bridge shows it, with `held`: the design is the list of commands run since the last file.new. A `held` statement that is not true
 * (the design is not exactly the first `held` commands, or it was left by a run that failed) is counted in `lies`; the tests need it to stay 0.
 * The reply is a function of the design alone, so a continued run and a run from empty must give the same reply; `slowOver` makes a list time out
 * under a budget; a command with radius < 0 fails.
 */
function engineFake({ slowOver = Infinity } = {}) {
  const J = (c) => JSON.stringify(c);
  const vol = (design) => design.reduce((v, s, i) => v + (i + 1) * s.length + (JSON.parse(s).params.radius ?? JSON.parse(s).params.length ?? 0), 0);
  const e = {
    design: [], clean: true, lies: 0, log: [],
    replyOf: (design) => ({ measure: { bodies: design.length ? [{ name: 'b_box1', volume_mm3: vol(design), faces: 5 + design.length }] : [] }, sketches: [], dirty: design.length > 0, active_sketch: null }),
    start(cmds, held) {
      if (!held) { e.design = []; e.clean = true; return 0; }
      if (!(e.clean && e.design.length === held && e.design.every((s, i) => s === J(cmds[i])))) e.lies++;
      return held;
    },
    async execute(cmds, { fresh = false, budgetS, held = 0, features = false } = {}) {
      e.log.push({ kind: 'execute', n: cmds.length, held: fresh ? held : 0, budgetS: budgetS ?? null, features });
      if (budgetS && cmds.length > slowOver) return { ok: false, timedOut: true, cpuMs: budgetS * 1000, failed: { command: '(budget)' } };
      const n = fresh ? e.start(cmds, held) : e.design.length && 0;
      for (let i = n; i < cmds.length; i++) {
        if (cmds[i].params.radius < 0) { e.clean = false; return { ok: false, failed: { index: i, command: cmds[i].command }, ...e.replyOf(e.design) }; }
        e.design.push(J(cmds[i]));
      }
      if (!fresh) e.clean = false; // added to whatever was there: not a list run from empty
      return { ok: true, completed: cmds.length, ...(features ? { ran: cmds.slice(n).map((_c, i) => ({ feature: n + i + 1 })) } : {}), ...e.replyOf(e.design), ...(budgetS ? { cpuMs: 10 * cmds.length } : {}) };
    },
    async topologyOf(cmds, { held = 0, heldResults } = {}) {
      const use = Array.isArray(heldResults) && heldResults.length === held ? held : 0;
      e.log.push({ kind: 'topologyOf', n: cmds.length, held: use });
      const n = e.start(cmds, use);
      for (let i = n; i < cmds.length; i++) { if (cmds[i].params.radius < 0) { e.clean = false; return { ok: false, failed: { error: 'bad' } }; } e.design.push(J(cmds[i])); }
      return { ok: true, topology: { bodies: [{ name: 'b_box1', faces: e.design.map((_s, i) => ({ name: 'f' + i })), edges: [] }] }, measure: e.replyOf(e.design).measure,
        results: [...(n ? heldResults : []), ...cmds.slice(n).map((_c, i) => ({ feature: n + i + 1 }))] };
    },
    async inspect() { return { ok: true, ...e.replyOf(e.design) }; },
  };
  return e;
}
const A = box(), B = cyl(2), C = cyl(3), D = cyl(4);

test('off unless asked for: the bridge is never told held or features, and every list starts from empty', async () => {
  const e = engineFake(); const m = createReplyMemory(e);
  await m.execute([A], { fresh: true }); await m.execute([A, B], { fresh: true, budgetS: 45 }); await m.topologyOf([A, B]); await m.execute([A, B, C], { fresh: true });
  assert.deepEqual(e.log.map((x) => [x.held, x.features ?? false]), [[0, false], [0, false], [0, false], [0, false]]);
  assert.equal(m.continued, 0);
});

test('a script built one step at a time: each run adds only the new commands, and each reply is the reply of the whole list from empty', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true }); const ref = engineFake();
  const lists = [[A], [A, B], [A, B, C], [A, B, C, D]];
  for (const l of lists) {
    const r = await m.execute(l, { fresh: true, budgetS: 45 });
    assert.deepEqual(r, await ref.execute(l, { fresh: true, budgetS: 45 }));
    assert.equal('ran' in r, false);
  }
  assert.deepEqual(e.log.map((x) => x.held), [0, 1, 2, 3]);
  assert.equal(e.lies, 0); assert.equal(m.continued, 3);
});

test('what SolidCraft holds must be the START of the list: a variant, a longer list or a failed run means from empty', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true });
  await m.execute([A, B], { fresh: true });
  await m.execute([A, C], { fresh: true }); // a variant of the last step: not a continuation
  await m.execute([A], { fresh: true }); // shorter than what is held
  await m.execute([A, D, B], { fresh: true }); // continues [A]
  await m.execute([A, D, bad()], { fresh: true }); // fails: afterwards nothing is held
  await m.execute([A, D, B, C], { fresh: true });
  assert.deepEqual(e.log.map((x) => x.held), [0, 0, 0, 1, 0, 0]);
  assert.equal(e.lies, 0);
});

test('a run stopped by the budget leaves the record as it was, and the next run still continues from it', async () => {
  const e = engineFake({ slowOver: 2 }); const m = createReplyMemory(e, { continueRuns: true });
  await m.execute([A, B], { fresh: true });
  assert.equal((await m.execute([A, B, C], { fresh: true, budgetS: 5 })).timedOut, true);
  await m.execute([A, B, D], { fresh: true });
  assert.deepEqual(e.log.map((x) => x.held), [0, 2, 2]); // the second is the statement sent with the stopped run; SolidCraft was not touched
  assert.equal(e.lies, 0); assert.equal(m.continued, 1);
});

test('an answer from memory does not move the record of what SolidCraft holds', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true });
  await m.execute([A, B], { fresh: true });
  await m.execute([A], { fresh: true }); // SolidCraft now holds [A]
  await m.execute([A, B], { fresh: true }); // from memory: SolidCraft still holds [A]
  await m.execute([A, C], { fresh: true }); // continues [A], not [A, B]
  assert.deepEqual(e.log.map((x) => [x.n, x.held]), [[2, 0], [1, 0], [2, 1]]);
  assert.equal(e.lies, 0);
});

test('SolidCraft holds exactly the list that is asked for (another budget flag, or after a topology reading): nothing is run', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true }); const ref = engineFake();
  await m.execute([A, B], { fresh: true });
  const r = await m.execute([A, B], { fresh: true, budgetS: 45 });
  assert.deepEqual(e.log.map((x) => x.held), [0, 2]);
  assert.deepEqual(r, await ref.execute([A, B], { fresh: true, budgetS: 45 }));
  const t = await m.topologyOf([A, B]);
  assert.equal(e.log.at(-1).held, 2);
  assert.deepEqual(t, await ref.topologyOf([A, B]));
  assert.equal(e.lies, 0);
});

test('a topology reading is continued only when the feature numbers of the held commands are known, and its reply has one for every command', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true }); const ref = engineFake();
  await m.execute([A, B], { fresh: true });
  const t = await m.topologyOf([A, B, C]);
  assert.equal(e.log.at(-1).held, 2);
  assert.deepEqual(t, await ref.topologyOf([A, B, C]));
  assert.deepEqual(t.results.map((x) => x.feature), [1, 2, 3]);
  // and the other way round: an execute continues a topology reading
  const r = await m.execute([A, B, C, D], { fresh: true });
  assert.equal(e.log.at(-1).held, 3);
  assert.deepEqual(r, await ref.execute([A, B, C, D], { fresh: true }));
  // an engine that gives no feature numbers: executes still continue, topology readings start from empty
  const e2 = engineFake(); const plain = e2.execute; e2.execute = async (c, o) => { const { ran: _r, ...x } = await plain(c, o); return x; };
  const m2 = createReplyMemory(e2, { continueRuns: true });
  await m2.execute([A, B], { fresh: true }); await m2.topologyOf([A, B, C]);
  assert.equal(e2.log.at(-1).held, 0); assert.equal(e2.lies, 0);
});

test('the final replay continues too, and leaves SolidCraft on the list', async () => {
  const e = engineFake(); const m = createReplyMemory(e, { continueRuns: true });
  const whole = await m.execute([A, B, C], { fresh: true });
  await m.execute([A, B], { fresh: true }); // a guard looked at the part before the last step
  assert.equal(await m.heldReply([A, B, C]), null);
  const fin = await m.execute([A, B, C], { fresh: true, replay: true });
  assert.equal(e.log.at(-1).held, 2);
  assert.deepEqual(fin, whole);
  assert.deepEqual(e.design, [A, B, C].map((c) => JSON.stringify(c)));
  assert.deepEqual(await m.heldReply([A, B, C]), whole);
  assert.equal(e.lies, 0);
});

test('whatever the layer asks for and in whatever order, no held statement is ever untrue and every reply is the from-empty reply (2000 random runs)', async () => {
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pool = [A, B, C, D, bad(), cyl(5)];
  for (let round = 0; round < 100; round++) {
    const e = engineFake({ slowOver: 4 }); const m = createReplyMemory(e, { continueRuns: true }); const ref = engineFake({ slowOver: 4 });
    let last = [A];
    for (let k = 0; k < 20; k++) {
      // mostly: the last list plus a step; sometimes a variant of its last step, a cut-back, or a list seen before
      const how = rnd(10);
      let l = how < 5 ? [...last, pool[rnd(pool.length)]] : how < 7 ? [...last.slice(0, -1), pool[rnd(pool.length)]] : how < 9 ? last.slice(0, 1 + rnd(last.length)) : [A, pool[rnd(4)]];
      if (l.length > 6) l = l.slice(0, 3);
      const what = rnd(6);
      if (what === 0) assert.deepEqual(await m.topologyOf(l), await ref.topologyOf(l));
      else {
        const opts = { fresh: true, ...(what < 3 ? { budgetS: 45 } : {}), ...(what === 5 ? { replay: true } : {}) };
        const { replay: _x, ...refOpts } = opts;
        assert.deepEqual(await m.execute(l, opts), await ref.execute(l, refOpts), `round ${round} run ${k}`);
        if (what === 5 && !l.some((c) => c.params.radius < 0)) assert.deepEqual(e.design, l.map((c) => JSON.stringify(c)));
      }
      if (!l.some((c) => c.params.radius < 0)) last = l;
    }
    assert.equal(e.lies, 0, `round ${round}`);
  }
});

test('with a reference bridge every real run is compared with the same list from empty, and a difference is recorded', async () => {
  const e = engineFake(); const shadow = engineFake(); const log = [];
  const m = createReplyMemory(e, { continueRuns: true, shadow, log });
  await m.execute([A], { fresh: true }); await m.execute([A, B], { fresh: true, budgetS: 45 }); await m.topologyOf([A, B, C]); await m.execute([A, B], { fresh: true, budgetS: 45 });
  assert.deepEqual(log.map((r) => [r.kind, r.n, r.held, r.same]), [['execute', 1, 0, true], ['execute', 2, 1, true], ['topologyOf', 3, 2, true]]); // the fourth came from memory
  assert.equal(shadow.log.every((x) => x.held === 0), true); // the reference always starts from empty
  // an engine whose continued runs come out differently
  const odd = engineFake(); const run = odd.execute; odd.execute = async (c, o) => { const r = await run(c, o); if (o.held) r.measure.bodies[0].volume_mm3 *= 1 + 1e-12; return r; };
  const log2 = []; const m2 = createReplyMemory(odd, { continueRuns: true, shadow: engineFake(), log: log2 });
  await m2.execute([A], { fresh: true }); await m2.execute([A, B], { fresh: true });
  assert.deepEqual(log2.map((r) => r.same), [true, false]);
  assert.equal(log2[1].diffs[0][0], '/measure/bodies/0/volume_mm3'); assert.ok(log2[1].maxRel > 0 && log2[1].maxRel < 1e-11);
});

test('compareReplies is exact, names where two replies differ, and leaves the worker\'s timing figures out', () => {
  const r = (v, extra = {}) => ({ ok: true, cpuMs: 5, probeVolume: 1, measure: { bodies: [{ name: 'b', volume_mm3: v, faces: 6 }] }, ...extra });
  assert.equal(compareReplies(r(1000), { ...r(1000), cpuMs: 9, probeVolume: 2, probeLoadMs: 3 }).same, true);
  const d = compareReplies(r(1000), r(1000.0000000001));
  assert.equal(d.same, false); assert.equal(d.count, 1); assert.equal(d.diffs[0][0], '/measure/bodies/0/volume_mm3'); assert.ok(d.maxRel < 1e-12);
  assert.equal(compareReplies(r(1000), r(1000, { sketches: [] })).same, false); // a field more
  assert.equal(compareReplies(r(1000), { ...r(1000), ok: false }).same, false);
  assert.equal(compareReplies({ a: [1, 2] }, { a: [1, 2, 3] }).same, false);
  assert.equal(compareReplies({ a: { cpuMs: 1 } }, { a: { cpuMs: 2 } }).same, false); // only the reply's own timing fields are left out
  assert.equal(compareReplies(null, null).same, true); assert.equal(compareReplies(null, r(1)).same, false);
});
