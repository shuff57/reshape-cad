// The hollow under the time budget (0.30.1 pin, 2026-11-09). On SolidCraft 0.30.1 a failing hollow can run for minutes before the kernel gives up
// (docs/spikes/solidcraft-referee/remeasure-0.30.1/REMEASURE-0.30.1.md, "Speed": 35 failing fuzz shells, median 122 s, 4 past 600 s). The shell-draft step
// now sends a hollow's engine runs with { budgetS } (45 s + 1.5 x the CPU the last accepted run used, the holes / booleans / groove rule), and a host reply
// { ok: false, timedOut: true } refuses the hollow with the holes loop's existing sentence for a step that is not a hole (budgetSentenceOther, text unchanged).
// No kernel: a fake engine that builds boxes exactly and answers a shell with a time-out whenever it is given a budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';

const holes = await import(new URL('../dist/holes.js', import.meta.url).href);
const host = await import(new URL('../../solidcraft-host/pane/src/host-entry.mjs', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const SETS = ['shell-draft', 'unified'];
const TR = Object.fromEntries(SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };

/** boxes measured exactly (each reply reports cpuMs = BOX_MS); a solid.shell under a budget times out, without one it is not in this fake */
const BOX_MS = 2000;
function fake() {
  const calls = [];
  const runSC = (cmds, opts) => {
    calls.push({ cmds, opts });
    if (cmds.some((c) => c.command === 'solid.shell')) {
      if (opts && typeof opts.budgetS === 'number') return Promise.resolve({ ok: false, timedOut: true, cpuMs: opts.budgetS * 1000, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${opts.budgetS * 1000} ms` } });
      return Promise.resolve({ ok: false, failed: { command: 'solid.shell', error: 'not in this fake' } });
    }
    const bodies = [];
    for (const c of cmds) {
      const p = c.params ?? {};
      if (c.command !== 'solid.box') return Promise.resolve({ ok: false, failed: { command: c.command, error: 'not in this fake' } });
      const [x, y, z] = p.center ?? [0, 0, 0]; const h = [p.length / 2, p.width / 2, p.height / 2];
      bodies.push({ name: p.body_name, bbox: { min: [x - h[0], y - h[1], z - h[2]], max: [x + h[0], y + h[1], z + h[2]] }, volume_mm3: p.length * p.width * p.height, area_mm2: 2 * (p.length * p.width + p.width * p.height + p.length * p.height), faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [x, y, z] });
    }
    return Promise.resolve({ ok: true, cpuMs: BOX_MS, measure: { bodies } });
  };
  const fakeState = { top: null };
  const runSC0 = runSC;
  const runSCx = async (cmds, opts) => { const r = await runSC0(cmds, opts); if (r.ok) { const bb = r.measure.bodies[0].bbox; fakeState.top = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.max[2]]; } return r; };
  // the opening's pick point: the centre of the top face of the last box built (a stand-in for the browser topology the host gives)
  const resolveAt = async () => (fakeState.top ? { kind: 'face', centroid: fakeState.top } : null);
  return { runSC: runSCx, resolveAt, calls };
}
const ctxOf = (engine) => ({ arc: lib.arc, mt: lib.mt, runSC: engine.runSC, resolveAt: engine.resolveAt, soups: {}, fromUsage: [] });
const SRC = "const b = box(40, 40, 20)\nhollow(b, { wall: 2, open: 'top' })";

test('the existing sentence, unchanged: budgetSentenceOther is the holes loop\'s wording for a step that is not a hole', () => {
  assert.equal(holes.budgetSentenceOther('shell1', 'shell'), 'shell1 (shell): building this took longer than 45 seconds of computing, so it was stopped and shell1 is shown without it.');
});

test('a hollow that runs out of its budget is refused with that sentence (G-BUDGET); the box beside it stands; shell-draft, unified and the host entry', async () => {
  for (const set of [...SETS, 'host']) {
    const translate = set === 'host' ? host.translateDoc : TR[set].translateDoc;
    const engine = fake();
    const doc = docOf(SRC);
    const r = await translate(structuredClone(doc), ctxOf(engine));
    const box = r.features.find((f) => f.kind === 'box');
    const sh = r.features.find((f) => f.kind === 'shell');
    assert.equal(box.status, 'built', set);
    assert.equal(sh.status, 'refused', `${set}: ${JSON.stringify(sh).slice(0, 300)}`);
    assert.equal(sh.guard, 'G-BUDGET', set);
    assert.equal(sh.refusal, holes.budgetSentenceOther(sh.id, 'shell'), set);
    const shellRuns = engine.calls.filter((c) => c.cmds.some((x) => x.command === 'solid.shell'));
    assert.equal(shellRuns.length, 1, `${set}: a time-out stops the hollow at once (no other opening is tried)`);
    // 45 s + 1.5 x the 2 s the box's accepted run reported
    assert.equal(shellRuns[0].opts.budgetS, 45 + 1.5 * BOX_MS / 1000, set);
    assert.ok(!r.commands.some((c) => c.command === 'solid.shell'), `${set}: nothing of the hollow is accepted`);
    // the box's own run carries no budget (only a hollow's runs do, in a document without holes, patterns or combines)
    const boxRuns = engine.calls.filter((c) => !c.cmds.some((x) => x.command === 'solid.shell'));
    assert.ok(boxRuns.length > 0 && boxRuns.every((c) => c.opts === undefined), set);
  }
});
