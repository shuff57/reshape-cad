// The hollow of a part with rounded or bevelled edges against its closed form (src/hollow-check.ts; docs/spikes/solidcraft-referee/GUARD-FAMILY-C-HOLLOW.md).
// No kernel: the closed form against the OCCT-direct numbers family-c-run.mjs recorded (fuzz/NEXT-LOOP-PHASE1.md), and the check in every set and the host entry
// on the differential tests' fake engine, wrapped so the part after its rounds measures its closed form and the hollow measures what the test says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFake } from './fake-engine.mjs';
import { fakeResolveAt } from './fake-resolve-at.mjs';
import { lib } from './unified-harness.mjs';

const hc = await import(new URL('../dist/hollow-check.js', import.meta.url).href);
const sdm = await import(new URL('../dist/shell-draft.js', import.meta.url).href);
const host = await import(new URL('../../solidcraft-host/pane/src/host-entry.mjs', import.meta.url).href);
const SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));

const P = (part, feature = 'b1') => ({ cause: 'primitive', feature, kind: 'face', part });
const between = (a, b, feature = 'b1') => ({ cause: 'between', feature, kind: 'edge', of: [P(a, feature), P(b, feature)] });
const box = (size = [40, 30, 10], extra = {}) => ({ id: 'b1', kind: 'box', size, center: [0, 0, size[2] / 2], ...extra });
const blend = (id, target, edge, size, style = 'fillet') => ({ id, kind: 'fillet', target, edge, size, style });
const hollow = (target, t, open = '+z') => ({ id: 's1', kind: 'shell', target, thickness: t, open: P(open) });
const SIDES = [['-z', '-y'], ['-z', '+y'], ['-z', '-x'], ['-z', '+x']];
/** family C: the four bottom edges rounded R, hollowed t, open at the top */
const famC = (L, W, H, R, t, extra = []) => {
  const f = [box([L, W, H])]; let prev = 'b1';
  SIDES.forEach(([a, b], i) => { f.push(blend(`r${i + 1}`, prev, between(a, b), R)); prev = `r${i + 1}`; });
  for (const x of extra) { f.push({ ...x, target: prev }); prev = x.id; }
  f.push(hollow(prev, t));
  return f;
};
const byIdOf = (features) => Object.fromEntries(features.map((f) => [f.id, f]));
const closed = (features) => { const s = features.find((f) => f.kind === 'shell'); const cov = hc.hollowModel(s, byIdOf(features)); assert.ok(cov.ok, JSON.stringify(cov)); return hc.hollowClosedForm(cov.model); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// fuzz/NEXT-LOOP-PHASE1.md: OCCT built directly from each case (four bottom edges in one MakeFillet, MakeThickSolidByJoin open at the top), which agrees with the
// plane-offset oracle P to 4.5e-7 or better (6.5e-5 with the hole, the oracle's lattice)
const HOLE = { id: 'h1', kind: 'hole', diameter: 5, depth: 8, center: [5.65, -5.15, 0], axis: 'z' };
const CASES = [
  { id: 'C-plain-40x30x10-t0.5-R0.75', f: famC(40, 30, 10, 0.75, 0.5), occt: 1240.5800101047305, shipped030: 1246.7622619990445, right021: 1240.5589987900723 },
  { id: 'C-plain-40x30x10-t1-R1.5', f: famC(40, 30, 10, 1.5, 1), occt: 2364.7285964650555, shipped030: 2376.146643649628, right021: 2364.716949904476 },
  { id: 'C-plain-40x30x10-t1.5-R2.25', f: famC(40, 30, 10, 2.25, 1.5), occt: 3376.058591338459, shipped030: 3391.8936525564877, right021: 3376.013279470181 },
  { id: 'C-plain-40x30x10-t2-R3', f: famC(40, 30, 10, 3, 2), occt: 4278.182828182674, shipped030: 4282.787170846388, right021: 4278.1028434688915 },
  { id: 'C-plain-40x30x10-t2.5-R3.75', f: famC(40, 30, 10, 3.75, 2.5), occt: 5074.714141424588, shipped030: 5080.092208766356, right021: 5074.668389536709 },
  { id: 'C-repro-s1-00475', f: famC(30, 24, 12, 0.75, 0.5), occt: 958.0136395337893, shipped030: 961.6815199382609, right021: 958.0106926679783 },
  { id: 'C-repro-s2-00591', f: famC(30, 24, 6, 0.75, 0.5), occt: 640.0136395264198, shipped030: 643.66814840875, right021: 640.0113456087466 },
  { id: 'C-gen-s2-01562', f: famC(24, 20, 6, 0.75, 0.5, [HOLE]), occt: 504.8587697625644, shipped030: 507.23369124363245, right021: 504.85627427045523 },
];

test('the closed form: every family-C hollow against OCCT built directly, and the part against the fuzz closed form S', () => {
  for (const c of CASES) {
    const cf = closed(c.f);
    assert.ok(rel(cf.hollow, c.occt) < 1e-6, `${c.id}: closed form ${cf.hollow} vs OCCT direct ${c.occt} (${rel(cf.hollow, c.occt).toExponential(2)})`);
  }
  // the unshelled part, 40 x 30 x 10, R 1.5, against the fuzz closed form S as NEXT-LOOP-PHASE1.md prints it (11933.696)
  assert.ok(rel(closed(famC(40, 30, 10, 1.5, 1)).part, 11933.696) < 1e-6);
  // a plain box with no blend: the hollow is the box less the inner box
  assert.equal(hc.hollowClosedForm({ size: [40, 30, 10], blends: [], holes: [], open: '+z', t: 1, rounds: false }).hollow, 12000 - 38 * 28 * 9);
});

test('the bar: every right family-C hollow passes, every one the shipped route built wrong on 0.30.1 is outside it', () => {
  for (const c of CASES) {
    const cf = closed(c.f);
    assert.ok(rel(c.right021, cf.hollow) <= hc.HOLLOW_TOL.curved, `${c.id}: the right build ${rel(c.right021, cf.hollow).toExponential(2)}`);
    assert.ok(rel(c.shipped030, cf.hollow) > hc.HOLLOW_TOL.curved, `${c.id}: the wrong build ${rel(c.shipped030, cf.hollow).toExponential(2)}`);
  }
});

/** the fake engine of the differential tests (blends add faces), with the part after its blends measured at `part` and the hollow at `hollow` */
function engine(part, hollow) {
  const fake = makeFake({ shellDraft: true, fcModel: true });
  const fix = (cmds, res) => {
    if (!res?.ok || !res.measure) return res;
    const shell = cmds.findLast((c) => c.command === 'solid.shell');
    const blendC = cmds.findLast((c) => c.command === 'solid.fillet' || c.command === 'solid.chamfer');
    const body = shell?.params?.body ?? blendC?.params?.body;
    const v = shell ? hollow : blendC ? part : null;
    if (v == null) return res;
    return { ...res, measure: { ...res.measure, bodies: res.measure.bodies.map((b) => (b.name === body ? { ...b, volume_mm3: v } : b)) } };
  };
  return {
    runSC: async (cmds, ...rest) => fix(cmds, await fake.runSC(cmds, ...rest)),
    topologyOf: async (cmds) => { const t = await fake.topologyOf(cmds); return t.measure ? fix(cmds, t) : t; },
  };
}
const ctxOf = (e, extra = {}) => ({ arc: lib.arc, mt: lib.mt, runSC: e.runSC, topologyOf: e.topologyOf, soups: {}, fromUsage: [], ...extra });
async function each(features, part, hollow, extra, fn) {
  for (const set of [...SETS, 'host']) for (const resolveAt of [null, fakeResolveAt]) {
    const translate = set === 'host' ? host.translateDoc : TR[set].translateDoc;
    const tr = await translate({ version: 1, features: structuredClone(features) }, ctxOf(engine(part, hollow), { ...(resolveAt ? { resolveAt } : {}), ...extra }));
    fn(Object.fromEntries(tr.features.map((f) => [f.id, f])), `${set}${resolveAt ? ' (resolveAt)' : ''}`);
  }
}
// the sentence names the part by the step that made it (b1, the box), not by the last round (r1, e3): part-name.ts, owner decision 2026-11-11
const SENT = (target) => sdm.SENTENCE.openAxisEngine({ id: 's1', target });

test('in all nine sets and the host entry: a right family-C hollow is built, a wrong one is refused with the shell group\'s sentence', async () => {
  const f = famC(40, 30, 10, 1.5, 1).slice(0, 2).concat(hollow('r1', 1)); // one bottom round: every set builds it one call, on both pick paths
  const cf = closed(f);
  await each(f, cf.part, cf.hollow * (1 - 1e-5), {}, (n, at) => {
    assert.equal(n.r1.status, 'built', `${at}: ${JSON.stringify(n.r1).slice(0, 200)}`);
    assert.equal(n.s1.status, 'built', `${at}: a right hollow builds (${JSON.stringify(n.s1).slice(0, 300)})`);
  });
  await each(f, cf.part, cf.hollow * (1 + 1.06e-3), {}, (n, at) => {
    assert.equal(n.s1.status, 'refused', at);
    assert.equal(n.s1.guard, hc.HOLLOW_CHECK_GUARD, at);
    assert.equal(n.s1.refusal, SENT('b1'), at);
  });
  // the measuring switch, and the fake-engine switch of every check after the build
  await each(f, cf.part, cf.hollow * (1 + 1.06e-3), { skipHollowCheck: true }, (n, at) => assert.equal(n.s1.status, 'built', at));
  await each(f, cf.part, cf.hollow * (1 + 1.06e-3), { skipSketchVolume: true }, (n, at) => assert.equal(n.s1.status, 'built', at));
  // the part before the hollow off its own closed form: the formula does not describe it, so the hollow is not shown unchecked
  await each(f, cf.part * (1 + 1e-3), cf.hollow, {}, (n, at) => { assert.equal(n.s1.status, 'refused', at); assert.equal(n.s1.guard, hc.HOLLOW_CHECK_GUARD, at); });
});

test('a bevelled part is checked at the planar bar; an uncovered hollow is refused only when a round is in its history', async () => {
  const bev = [box(), blend('c1', 'b1', between('-z', '-y'), 1.5, 'chamfer'), hollow('c1', 1)];
  const cf = closed(bev);
  assert.ok(Math.abs(cf.hollow - (12000 - 1.125 * 40 - (38 * 28 * 9 - 0.5 * (1.5 - (2 - Math.SQRT2)) ** 2 * 38))) < 1e-9);
  await each(bev, cf.part, cf.hollow, {}, (n, at) => assert.equal(n.s1.status, 'built', at));
  await each(bev, cf.part, cf.hollow * (1 + 1e-6), {}, (n, at) => { assert.equal(n.s1.status, 'refused', at); assert.equal(n.s1.guard, hc.HOLLOW_CHECK_GUARD, at); });
  // uncovered: three blends at one corner
  const corner = (style) => [box(), blend('e1', 'b1', between('-z', '-y'), 1, style), blend('e2', 'e1', between('-z', '-x'), 1, style), blend('e3', 'e2', between('-y', '-x'), 1, style), hollow('e3', 2)];
  for (const style of ['fillet', 'chamfer']) {
    const fs = corner(style); const s = fs.at(-1);
    const cov = hc.hollowModel(s, byIdOf(fs));
    assert.ok(cov.ok && 'why' in hc.hollowClosedForm(cov.model), style);
    const res = { ok: true, measure: { bodies: [{ name: 'b1', volume_mm3: 1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }] } };
    const r = hc.hollowRefusal(s, fs, { measure: {} }, {}, res, ['b1'], []);
    if (style === 'fillet') { assert.equal(r?.guard, hc.HOLLOW_CHECK_GUARD); assert.equal(r.sentence, SENT('b1')); } else assert.equal(r, null);
  }
});

test('a hollow with no blend is not checked; a hole is measured at the curved bar', () => {
  // a plain box with a through hole, its faceted bore 1.8e-6 low (fuzz-guard-run.mjs plain-centered-hole on one kernel): built, as before the check
  const plainHole = [box(), { ...HOLE, target: 'b1', center: [0, 0, 0], depth: 20 }, hollow('h1', 1)];
  const res = { ok: true, measure: { bodies: [{ name: 'b1', volume_mm3: 1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }] } };
  assert.equal(hc.hollowRefusal(plainHole.at(-1), plainHole, { measure: {} }, {}, res, ['b1'], []), null);
  // a bevel and a through hole: checked at the curved bar
  const bevHole = [box(), blend('c1', 'b1', between('-z', '-y'), 1.5, 'chamfer'), { ...HOLE, target: 'c1', center: [0, 0, 0], depth: 20 }, hollow('h1', 1)];
  const cf = closed(bevHole);
  const at = (part, hollowV) => hc.hollowRefusal(bevHole.at(-1), bevHole, { measure: { h1: { volume: part, bodies: ['b1'] } } }, {},
    { ok: true, measure: { bodies: [{ name: 'b1', volume_mm3: hollowV, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }] } }, ['b1'], []);
  assert.equal(at(cf.part * (1 - 2e-6), cf.hollow * (1 - 2e-6)), null);
  assert.equal(at(cf.part, cf.hollow * (1 + 1e-3))?.guard, hc.HOLLOW_CHECK_GUARD);
  assert.equal(at(cf.part * (1 + 1e-3), cf.hollow)?.guard, hc.HOLLOW_CHECK_GUARD);
});

test('what the closed form covers', () => {
  const cov = (fs) => hc.hollowModel(fs.find((f) => f.kind === 'shell'), byIdOf(fs));
  const cfw = (fs) => { const c = cov(fs); return c.ok ? hc.hollowClosedForm(c.model) : c; };
  // a move, a turn and a whole quarter turn of the box do not change the volume
  const moved = [box([40, 30, 10], { rotate: [0, 0, 90] }), blend('r1', 'b1', between('-z', '-y'), 1.5), { id: 'm1', kind: 'move', target: 'r1', offset: [3, 4, 5], copy: false }, { id: 't1', kind: 'rotate', target: 'm1', angles: [10, 0, 0] }, hollow('t1', 1)];
  assert.ok(Math.abs(cfw(moved).hollow - closed([box(), blend('r1', 'b1', between('-z', '-y'), 1.5), hollow('r1', 1)]).hollow) < 1e-9);
  // vertical and rim rounds; a rim round as big as the wall is not covered
  assert.ok(!('why' in cfw([box(), blend('r1', 'b1', between('+x', '+y'), 3), hollow('r1', 2)])));
  assert.ok(!('why' in cfw([box(), blend('r1', 'b1', between('+z', '+y'), 1), hollow('r1', 2)])));
  assert.match(cfw([box(), blend('r1', 'b1', between('+z', '+y'), 3), hollow('r1', 2)]).why, /rim/);
  // not covered: another root, a whole-shape round, a copy, a pocket, a blind or a crossing hole, the same edge twice, a blend named on another feature
  assert.equal(cov([{ id: 'c1', kind: 'cylinder', radius: 5, height: 10 }, blend('r1', 'c1', between('+z', 'side', 'c1'), 1), hollow('r1', 1)]).ok, false);
  assert.match(cov([box([40, 30, 10], { round: 1 }), hollow('b1', 2)]).why, /whole-shape round/);
  assert.equal(cov([box([40, 30, 10], { round: 1 }), hollow('b1', 2)]).rounds, true);
  assert.match(cov([box(), blend('r1', 'b1', between('-z', '-y'), 1), { id: 'm1', kind: 'move', target: 'r1', offset: [1, 0, 0], copy: true }, hollow('m1', 1)]).why, /copy/);
  assert.match(cov([box(), blend('r1', 'b1', between('-z', '-y'), 1), { id: 'h1', kind: 'hole', target: 'r1', diameter: 4, depth: 5, center: [0, 0, 2.5], axis: 'z' }, hollow('h1', 1)]).why, /blind/);
  assert.match(cfw([box(), blend('r1', 'b1', between('-z', '-y'), 1), { id: 'h1', kind: 'hole', target: 'r1', diameter: 4, depth: 50, center: [0, 0, 0], axis: 'x' }, hollow('h1', 1)]).why, /across the open axis/);
  assert.match(cfw([box(), blend('r1', 'b1', between('-z', '-y'), 3), { id: 'h1', kind: 'hole', target: 'r1', diameter: 4, depth: 20, center: [0, -11, 0], axis: 'z' }, hollow('h1', 1)]).why, /reaches a blend/);
  assert.match(cov([box(), blend('r1', 'b1', between('-z', '-y'), 1), blend('r2', 'r1', between('-y', '-z'), 1), hollow('r2', 1)]).why, /twice/);
  assert.match(cov([box(), blend('r1', 'b1', { cause: 'between', feature: 'x1', kind: 'edge', of: [P('-z', 'x1'), P('-y', 'x1')] }, 1), hollow('r1', 1)]).why, /two faces of the box/);
  assert.match(cfw([box(), blend('r1', 'b1', between('-z', '-y'), 1), blend('r2', 'r1', between('-z', '-x'), 2), hollow('r2', 0.5)]).why, /different blends at a corner/);
  // the sentence is the shell group's own
  assert.equal(hc.openAxisEngineSentence({ id: 's1', target: 'r1' }), sdm.SENTENCE.openAxisEngine({ id: 's1', target: 'r1' }));
});
