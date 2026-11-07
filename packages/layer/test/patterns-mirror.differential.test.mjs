// DIFFERENTIAL TEST for the patterns-mirror fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/pm-translate.mjs, which imports outline-guard.mjs;
// both untouched) against the compiled TypeScript port in 'patterns-mirror' mode (createTranslator({ planners: 'patterns-mirror' })). Both are fed the same ModelDocs through
// the same deterministic FAKE engine (test/fake-engine.mjs, no kernel, no wasm; its opt-in pmModel makes the group's guards reachable) and must produce IDENTICAL output: the
// translateDoc result (features, commands), the ordered list of engine calls (the guards' probe re-runs and their { budgetS } included) and a thrown error.
//
// HOW THE TWO ARE COMPARED. The original notes a refusal twice: `refusal` (the engine / translator reason) and `student` (the sentence a student reads). The port puts the
// sentence in `refusal` (as every set of the layer does) and the reason in `raw`, and names the guard in `guard`. The original is mapped to that shape and the port's `guard` is
// dropped before the comparison, so what is compared is: status, the sentence, the reason, the commands, the measure, pickedFrom, variantsTried, pick, mirrorAt and wallMs.
// The clock is fixed (Date.now() is 0 for both) so wallMs and the time-limit options are the same; the document time limit is tested with a limit below zero.
//
// WHAT "IDENTICAL" CAN MEAN HERE (NOTES.md "Fold 4" has the long version). The original is phase0/translate.mjs + 17 patches; the layer's base is the phase 4 translator. Where
// phase0 and phase 4 plan a feature OTHER than pattern and mirror differently, the two cannot be equal: such a doc is EXCLUDED from the equality requirement, counted with the
// kind that differs, and shown to really differ. They are: a shell, a fillet or a draft (the original asks brep-rs for the point of a name, the port reads the engine's topology;
// a shell with no open face is sent to the engine by the original and refused by the base), and a constrained sketch (soup) used by a pull, pocket, spin, groove or loft
// (phase 4 maps it for pull and pocket, the original refuses it).
// The patch switches and the partial-angle switch of the original's harness are not ported (every patch on, a partial turn refused), so the original is run with exactly that.
//
// This shows the port equals the original on the inputs below. It does NOT show that a built solid is right: the fake has no geometry kernel (its pmModel is a few lines on
// bounding boxes, see the notes above pmJoin in fake-engine.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs } from './docs.mjs';
import { pmDoc, N_THEMES } from './pm-docs.mjs';
import { box, cyl, sphere, torus, rect, circ, extrude, pocket, combine, mirror, pattern, hole, move, rotate, shell, fillet, prim, between, revolve, groove, soup, line } from './docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);
const orig = { pm: await imp(path.join(contract, 'pm-translate.mjs')), pre: await imp(path.join(contract, 'pm-preflight.mjs')) };
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), pm: await dist('patterns-mirror.js'), pre: await dist('pm-preflight.js') };
const PM = port.tr.createTranslator({ planners: 'patterns-mirror' });
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

const ALL_PATCHES = ['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver', 'web', '__explicit'];
const PATCHES = new Set(ALL_PATCHES);

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const slow = (cmds) => (cmds.some((c) => c.command.startsWith('solid.pattern') && (c.params.count ?? c.params.count1) >= 5) ? 700000 : 10);
const CONFIGS = [
  { name: 'boxBool+pmModel, mt', fake: { boxBool: true, pmModel: true }, useMt: true },
  { name: 'default fake, mt', fake: {}, useMt: true },
  { name: 'boxBool+pmModel, every 5th call fails, no mt', fake: { boxBool: true, pmModel: true, failEvery: 5 }, useMt: false },
  { name: 'boxBool+pmModel+holeModel, a pattern of 5 or more copies runs past the time limit, mt', fake: { boxBool: true, pmModel: true, holeModel: true, cpuMs: slow }, useMt: true },
];

const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
const realNow = Date.now;
const norm = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
/** the original's notes, in the shape the port gives */
function normOrig(tr) {
  return {
    features: tr.features.map((f) => {
      const o = { id: f.id, kind: f.kind, status: f.status, commands: f.commands };
      if (f.status === 'refused') { o.refusal = f.student; o.raw = f.refusal; } else if (f.status === 'built') Object.assign(o, { measure: f.measure, pickedFrom: f.pickedFrom, variantsTried: f.variantsTried, pick: f.pick, mirrorAt: f.mirrorAt, wallMs: f.wallMs });
      return o;
    }),
    commands: tr.commands,
  };
}
function runOrig(item, cfg, extra = {}) {
  const fake = makeFake({ sync: true, ...cfg.fake });
  const runSC = (cmds, opts) => fake.runSC(cmds, opts ? { budgetS: opts.budgetMs / 1000 } : undefined);
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, runSC, resolveAt: () => null, patches: PATCHES, inProcess: true, ...(cfg.useMt ? { mt } : {}), ...extra };
  let result; let error = null;
  Date.now = () => 0;
  try { result = norm(normOrig(orig.pm.translateDoc(structuredClone(item.doc), ctx))); } catch (e) { error = errOf(e); } finally { Date.now = realNow; }
  return { result, error, log: fake.log };
}
async function runPort(tr, item, cfg, extra = {}) {
  const fake = makeFake({ ...cfg.fake });
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {}, ...(cfg.useMt ? { mt } : {}), ...extra };
  let result; let error = null; let guards = [];
  Date.now = () => 0;
  try {
    const { _state, ...rest } = await tr.translateDoc(structuredClone(item.doc), ctx);
    assert.ok(_state);
    guards = rest.features.filter((f) => f.status === 'refused').map((f) => f.guard ?? null);
    result = norm({ features: rest.features.map(({ guard, ...f }) => f), commands: rest.commands });
  } catch (e) { error = errOf(e); } finally { Date.now = realNow; }
  return { result, error, log: fake.log, guards };
}

// ---- where phase0 and phase 4 plan a feature other than pattern and mirror differently ------------------------------------------------------------
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'shell') out.push(f.open ? 'shell with an open face (name resolution)' : 'shell with no open face (the engine vs the base)');
    if (f.kind === 'fillet') out.push('fillet (edge name resolution and candidates)');
    if (f.kind === 'draft') out.push('draft (face name resolution)');
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch (soup)`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch (soup)');
  }
  return out;
}

// ---- corpora ------------------------------------------------------------------------------------------------------------------------------------
const { CASES } = await imp(path.join(contract, 'pm-cases.mjs'));
const { CASES2 } = await imp(path.join(contract, 'pm-cases-r2.mjs'));
const { CASES3 } = await imp(path.join(contract, 'pm-cases-r3.mjs'));
const { CASES4 } = await imp(path.join(contract, 'pm-cases-r4.mjs'));
const { CASES6 } = await imp(path.join(contract, 'pm-cases-r6.mjs'));
const ALL_CASES = [...CASES, ...CASES2, ...CASES3, ...CASES4, ...CASES6];
const caseDocs = []; const caseSkipped = []; const caseDup = new Set();
for (const c of ALL_CASES) {
  const key = `${c.id}\u0000${c.src}`; if (caseDup.has(key)) continue; caseDup.add(key);
  // the group's runner (pm-run.mjs) puts the script through the front door first; a refused script has no ModelDoc to translate
  if (orig.pre.preflightScript(c.src)) { caseSkipped.push([c.id, 'preflight']); continue; }
  const r = runScript(c.src);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); continue; }
  const doc = solveDoc(r.doc);
  // a repeat of hundreds of copies is a real-engine case (the fake would build, measure and compare every pair of copies on every re-run): not replayed here
  if (doc.features.some((f) => f.kind === 'pattern' && f.count > 40)) { caseSkipped.push([c.id, 'more than 40 copies']); continue; }
  caseDocs.push({ name: `case ${c.id}`, doc });
}
const N_GEN = 600;
const generated = Array.from({ length: N_GEN }, (_, i) => ({ name: `pm seed ${i}`, doc: pmDoc(i) }));
const hand = handDocs().map(([name, doc]) => ({ name: `hand ${name}`, doc }));

// hand-written docs aimed at single guards (each is also reached by the generator, these name the intent and make sure it is reached)
const B = (i, at = [0, 0, 0], s = [10, 10, 10]) => box(i, s, at);
const aimed = [
  ['zero step', [B('b1'), pattern('p1', 'b1', { count: 3, step: [0, 0, 0] }), move('m1', 'p1', [1, 0, 0])]],
  ['count 0 and 1 are the original alone', [B('b1'), pattern('p1', 'b1', { count: 1 }), B('b2'), pattern('p2', 'b2', { count: 0, step: [20, 0, 0] })]],
  ['disjoint copies (the fallback variant keeps them apart)', [B('b1'), pattern('p1', 'b1', { count: 3, step: [30, 0, 0] })]],
  ['touching copies fuse along a face', [B('b1'), pattern('p1', 'b1', { count: 3, step: [10, 0, 0] })]],
  ['overlapping copies', [B('b1'), pattern('p1', 'b1', { count: 4, step: [6, 0, 0] })]],
  ['copies that meet along an edge', [B('b1'), pattern('p1', 'b1', { count: 3, step: [10, 10, 0] })]],
  ['copies that meet at a point', [B('b1'), pattern('p1', 'b1', { count: 3, step: [10, 10, 10] })]],
  ['a copy shifted by almost nothing (snap)', [B('b1'), pattern('p1', 'b1', { count: 3, step: [0.05, 0, 0] })]],
  ['sliver overlap', [B('b1'), pattern('p1', 'b1', { count: 2, step: [10 - 3e-4, 0, 0] })]],
  ['sub-resolution gap', [B('b1'), pattern('p1', 'b1', { count: 2, step: [10 + 1e-5, 0, 0] })]],
  ['aligned (a gap on one axis, slivers on the others)', [B('b1'), pattern('p1', 'b1', { count: 2, step: [10.2, 10 - 2e-4, 10 - 2e-4] })]],
  ['circular pattern, full turn', [cyl('c1', 2, 5, [10, 0, 0]), pattern('p1', 'c1', { mode: 'circular', count: 6, axis: 'z' })]],
  ['circular pattern, partial turn is refused', [cyl('c1', 2, 5, [10, 0, 0]), pattern('p1', 'c1', { mode: 'circular', count: 4, totalAngle: 180 })]],
  ['torus pattern, not clear', [torus('t1', 8, 1), pattern('p1', 't1', { count: 3, step: [5, 0, 0] })]],
  ['torus pattern, clear', [torus('t1', 8, 1), pattern('p1', 't1', { count: 3, step: [30, 0, 0] })]],
  ['torus mirror', [torus('t1', 8, 1), mirror('x1', 't1', 'yz')]],
  ['mirror of a box', [B('b1', [5, 3, 0]), mirror('x1', 'b1', 'xz'), mirror('x2', 'x1', 'yz')]],
  ['mirror of a sphere (point contact, not fused)', [sphere('s1', 6), mirror('x1', 's1', 'yz')]],
  ['mirror of a cylinder along its axis, and across it', [cyl('c1', 5, 10), mirror('x1', 'c1', 'xy'), cyl('c2', 5, 10), mirror('x2', 'c2', 'yz')]],
  ['mirror of a moved and a turned part (analytic box)', [B('b1', [5, 3, 1]), move('m1', 'b1', [2, 0, 0]), mirror('x1', 'm1', 'yz'), B('b2'), rotate('r1', 'b2', [0, 0, 90]), mirror('x2', 'r1', 'xz')]],
  ['pattern of a join, of a pattern', [B('b1'), B('b2', [8, 0, 0], [6, 6, 20]), combine('c1', 'union', ['b1', 'b2']), pattern('p1', 'c1', { count: 3, step: [0, 30, 0] }), pattern('p2', 'p1', { count: 2, step: [0, 0, 40] })]],
  ['near-coincident pockets (snap) and a thin wall (web)', [B('b1', [0, 0, 0], [60, 40, 10]), rect('s1', 8, 6), pocket('pk1', 's1', 'b1', 3), { ...rect('s2', 8, 6), points: [[0.04, 0], [8.04, 0], [8.04, 6], [0.04, 6]] }, pocket('pk2', 's2', 'b1', 3), { ...rect('s3', 8, 6), points: [[8.3, 0], [16.3, 0], [16.3, 6], [8.3, 6]] }, pocket('pk3', 's3', 'b1', 3)]],
  ['reversed pocket and tapered pull (the group maps both)', [B('b1', [0, 0, 0], [40, 30, 10]), rect('s1', 8, 6), pocket('pk1', 's1', 'b1', 3, { reversed: true }), rect('s2', 10, 10), extrude('e1', 's2', 6, { taper: 5 }), mirror('x1', 'e1', 'yz'), rect('s3', 10, 10), extrude('e2', 's3', 6, { taper: 80 })]],
  ['holes: two holes a hair apart, then a pattern', [B('b1', [0, 0, 0], [30, 30, 10]), hole('h1', 'b1', { diameter: 4, center: [-5, 0, 0] }), hole('h2', 'b1', { diameter: 4, center: [-0.99, 0, 0] }), pattern('p1', 'b1', { count: 2, step: [40, 0, 0] })]],
  ['revolve then mirror (spinbox)', [{ ...rect('s1', 6, 14) }, revolve('r1', 's1', 360), mirror('x1', 'r1', 'xz'), { ...rect('s2', 6, 14) }, revolve('r2', 's2', 180), mirror('x2', 'r2', 'xz')]],
  ['pattern or mirror of something that is not a solid', [pattern('p1', 'nope', { count: 3, step: [10, 0, 0] }), mirror('x1', 'nope', 'yz'), rect('s1'), pattern('p2', 's1', { count: 2, step: [5, 0, 0] })]],
  ['a refused pattern, then what depends on it', [B('b1'), pattern('p1', 'b1', { count: 3, step: [0, 0, 0] }), mirror('x1', 'p1', 'yz'), hole('h1', 'p1', {}), move('m1', 'x1', [1, 0, 0])]],
  ['a consumed target', [B('b1'), pattern('p1', 'b1', { count: 2, step: [30, 0, 0] }), pattern('p2', 'b1', { count: 2, step: [0, 30, 0] })]],
  ['ghost and boom bodies', [B('ghost1'), pattern('p1', 'ghost1', { count: 2, step: [30, 0, 0] }), B('b1'), mirror('x1', 'b1', 'yz')]],
];
const aimedDocs = aimed.map(([name, features]) => ({ name: `aimed ${name}`, doc: { version: 1, features } }));

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), calls: 0,
  inSet: { docs: 0 }, excluded: { docs: 0, kinds: {}, differ: 0, agree: 0 }, byCorpus: {},
};
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const shape = (s) => String(s).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f|d|pk|pa|mi|u|sph|cyl|ghost)\d*\b/g, '$1');
function note(a, b) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'refused') { bump(tally.refused, f.kind); tally.sentences.add(shape(f.refusal)); }
  }
  for (const g of b.guards) bump(tally.guards, g ?? '(none)');
}
async function compareDoc(name, item, cfg, extra = {}, pextra = extra) {
  const a = runOrig(item, cfg, extra);
  const b = await runPort(PM, item, cfg, pextra);
  tally.cases++;
  // NAMED EXCEPTION (owner decision (b), NOTES Fold 5): the original SKIPS the mirror contact check when one of its probe runs fails; the port refuses (PM-MIRCONTACT, 'mirror contact check could not run').
  // It may differ ONLY there: the first differing feature is a mirror the port refuses with that text and the original did not refuse for that reason, the commands before it are equal, and the config must
  // be one in which the engine fails runs. Everything after that feature can differ (it depends on it) and is not compared.
  const same = (x, y) => { try { assert.deepStrictEqual(x, y); return true; } catch { return false; } };
  if (!a.error && !b.error && !same(a.result, b.result)) {
    const k = b.result.features.findIndex((x, j) => !same(x, a.result.features[j]));
    const pf = b.result.features[k]; const of = a.result.features[k];
    if (k >= 0 && pf.kind === 'mirror' && pf.status === 'refused' && /mirror contact check could not run: a probe run failed/.test(pf.raw ?? '') && !/mirror contact is not a face/.test(of?.raw ?? '') && cfg.fake.failEvery) {
      tally.mirrorProbeException = (tally.mirrorProbeException ?? 0) + 1;
      return { a, b };
    }
  }
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  tally.identical++; tally.calls += a.log.length;
  if (a.error) { tally.thrown++; bump((tally.errors ??= {}), a.error); }
  note(a, b);
  return { a, b };
}
async function runCorpus(label, items) {
  tally.byCorpus[label] = { docs: items.length, inSet: 0 };
  for (const item of items) {
    const diff = differences(item.doc);
    if (diff.length) {
      tally.excluded.docs++;
      for (const d of new Set(diff)) bump(tally.excluded.kinds, d);
      // shown to really differ (or agree by luck: counted), not asserted equal
      const a = runOrig(item, CONFIGS[0]); const b = await runPort(PM, item, CONFIGS[0]);
      try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.error, a.error); tally.excluded.agree++; } catch { tally.excluded.differ++; }
      continue;
    }
    tally.inSet.docs++; tally.byCorpus[label].inSet++;
    for (const cfg of CONFIGS) await compareDoc(item.name, item, cfg);
  }
}

test('the set exists, is a member of nothing else by accident, and the default stays base', () => {
  assert.equal(PM.planners, 'patterns-mirror');
  assert.equal(port.tr.createTranslator().planners, 'base');
  assert.ok(Object.keys(port.tr.PROFILES).includes('patterns-mirror'));
  // pattern and mirror are planned synchronously by planFeature (this set's planners), unlike a hole / shell / draft
  const st = { head: {}, bodies: { b1: ['b_b1'] }, stale: {}, refused: {}, sketches: {}, measure: { b1: { volume: 1000, faces: 6, kernelFaces: 6, curved: false, bbox: [-5, -5, -5, 5, 5, 5], faceTypes: {}, com: [0, 0, 0], bodies: ['b_b1'], shells: 1 } }, counter: 0, accLen: {} };
  port.pm.PM_PROFILE.initState(st);
  const p = PM.planFeature({ id: 'p1', kind: 'pattern', target: 'b1', mode: 'linear', count: 3, step: [30, 0, 0] }, st, { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, runSC: () => ({ ok: true }), resolve: () => null });
  assert.equal(p.variants.length, 2);
});

test('(a) every case of the group that turns into a ModelDoc', { timeout: 3_000_000 }, async () => {
  await runCorpus('cases', caseDocs);
});
test('(b) aimed docs, the base hand docs, and 600 generated docs', { timeout: 3_000_000 }, async () => {
  await runCorpus('aimed', aimedDocs);
  await runCorpus('hand', hand);
  await runCorpus('generated', generated);
});

test('the time limits: a document limit below zero refuses every step with the group sentence, in both', { timeout: 600_000 }, async () => {
  let n = 0;
  for (const item of [...aimedDocs.slice(0, 8), ...generated.slice(0, 20)]) {
    if (differences(item.doc).length) continue;
    const { a } = await compareDoc(`${item.name} (document limit)`, item, CONFIGS[0], { docBudgetMs: -1 }, { pmDocBudgetMs: -1 });
    const refused = a.result.features.filter((f) => f.status === 'refused');
    if (refused.length) { assert.match(refused[0].raw, /TIME BUDGET: whole model exceeded -1 ms/); assert.match(refused[0].refusal, /checking the whole model was stopped after/); n++; }
  }
  assert.ok(n >= 10, `${n} docs hit the document limit`);
  // a per-run limit of 1 ms: the options carry it, the fake reports a run past it as timed out only when it is told a cost; the options are what is compared
  for (const item of aimedDocs.slice(0, 6)) await compareDoc(`${item.name} (run limit)`, item, CONFIGS[3], { budgetMs: 1000 }, { pmBudgetMs: 1000 });
});

test('the sentence of every refusal reason: studentSentence equals the original for the group\'s own texts and for texts it has no rule for', () => {
  const kinds = [{ id: 'f1', kind: 'pattern', mode: 'linear', count: 3 }, { id: 'f2', kind: 'pattern', mode: 'circular', count: 4 }, { id: 'f3', kind: 'mirror' }, { id: 'f4', kind: 'shell' }, { id: 'f5', kind: 'draft' }, { id: 'f6', kind: 'combine', op: 'union' }, { id: 'f7', kind: 'combine', op: 'subtract' }, { id: 'f8', kind: 'combine', op: 'intersect' }, { id: 'f9', kind: 'fillet', style: 'chamfer' }, { id: 'f10', kind: 'fillet' }, { id: 'f11', kind: 'extrude' }, { id: 'f12', kind: 'revolve' }, { id: 'f13', kind: 'blend' }, { id: 'f14', kind: 'hole' }, { id: 'f15', kind: 'pattern', count: 1001 }];
  const raws = [...new Set([
    'f1 (pattern): TIME BUDGET: whole model exceeded 3600000 ms before this step', 'f1 (pattern): x: TIME BUDGET: exceeded 600000 ms', 'x: TIME BUDGET: exceeded 900 ms', 'TIME BUDGET: whole model',
    'f1: pattern count must be at most 1000', 'near-coincident copies: consecutive copies are shifted by only 0.05 mm (0.15 mm is the smallest safe shift: 1.5% of the part\'s smallest size 10 mm)', 'near-coincident copies',
    'thin wall: this cut leaves a wall of only 0.4 mm between it and an earlier cut; 0.5 mm is the smallest safe wall between two cuts (1% of the part\'s diagonal)', 'thin wall: wall of only 0.4 mm  0.5 mm is the smallest safe wall between a cut and the side of the part', 'thin wall',
    'near-coincident cut: this cut lies by only 0.05 mm from an earlier cut of the same size (0.1 mm is the smallest safe shift', 'near-coincident cut by only 0.05 mm from an earlier cut of the same size (0.1 mm is the smallest safe shift',
    'copies 1 and 2 meet only along an edge or at a point [curved-near gap=1.0e-6] (bbox', '[curved-near', 'mirror copy not fused: solid.mirror', 'boolean Union: the operation failed', 'sub-resolution gap: copies 1 and 2 are apart by 1.0e-5 mm (bbox gap)', 'sub-resolution gap', 'sub-resolution overlap: copies 1 and 2 overlap by only 3.0e-4 mm', 'sub-resolution overlap',
    'copies overlap or touch (curved faces): copies 1 and 2', 'copies overlap or touch: copies 1 and 2', 'mirror contact is not a face: the overlap', 'lumps: shell boundaries intersect or touch', 'join cannot preserve the original faces', 'exact fallback for where the bodies meet',
    'angle semantics', 'less than 360 degrees is not mapped', 'a zero step puts', 'counterbore and countersink are not mapped', 'faces. must be a list of points', 'solid.shell: x', 'a torus is in the shape and its copies are not provably clear of each other (truck does not return on touching tori)',
    'only along an edge or at a point', 'no analytic box', 'cannot tell exactly where the part ends', 'the midplane option is not mapped', 'the reversed option is not mapped in phase 0', 'taper closes the profile', 'fold over itself', 'not a single body', 'needs a single target body', 'solid.draft: x', 'drafting faces', 'sum check: the 3 copies', 'no measured bounding box for b1',
    'f1 (pattern): its target b1 was refused (x)', 'f1 (pattern): its target b1 was already changed in place by m1, and', 'anything else', '', 'solidcraft refused it -- solid.fillet: boom',
  ])];
  let n = 0;
  for (const f of kinds) for (const raw of raws) { assert.equal(port.pm.studentSentence(f, raw), orig.pm.studentSentence(f, raw), `${f.kind} / ${raw}`); n++; }
  // every sentence of the committed evidence rows that this function can make
  assert.ok(n > 500);
});

test('the pure helpers equal the original: polyDist, webCut, analyticBox, the thresholds', () => {
  assert.equal(port.pm.SNAP_REL, orig.pm.SNAP_REL); assert.equal(port.pm.SLIVER_MM, orig.pm.SLIVER_MM); assert.equal(port.pm.WEB_REL, orig.pm.WEB_REL);
  const rnd = (k) => { let a = k; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; };
  const r = rnd(7);
  const polyOf = () => { const x = r() * 20 - 10; const y = r() * 20 - 10; const w = r() * 8 + 0.1; const h = r() * 8 + 0.1; return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; };
  for (let i = 0; i < 400; i++) {
    const A = polyOf(); const Bp = r() < 0.3 ? A.map((p) => [p[0] + r() * 3, p[1]]) : polyOf();
    assert.equal(port.pm.polyDist(A, Bp), orig.pm.polyDist(A, Bp));
  }
  const tools = () => { const ai = Math.floor(r() * 3) - (r() < 0.2 ? 1 : 0); const lo = [r() * 10, r() * 10, r() * 10]; const hi = lo.map((v) => v + r() * 6 + 0.1); const circle = r() < 0.2; return { lo, hi, circle, poly: circle ? null : [lo, [hi[0], lo[1], lo[2]], hi, [lo[0], hi[1], hi[2]]], ai }; };
  for (let i = 0; i < 600; i++) {
    const tb = tools(); const prior = Array.from({ length: Math.floor(r() * 3) }, tools); const bb = [0, 0, 0, 12 + r() * 6, 12 + r() * 6, 12 + r() * 6];
    assert.deepStrictEqual(port.pm.webCut(tb, prior, bb), orig.pm.webCut(tb, prior, bb));
  }
  const st = { sketches: { sk1: rect('sk1', 10, 6) }, measure: {}, pm: { abox: { b1: { lo: [0, 0, 0], hi: [4, 5, 6] }, b2: { lo: [1, 1, 1], hi: [3, 3, 3] }, m1: null } } };
  const ost = { sketches: st.sketches, abox: st.pm.abox };
  const features = [box('x', [4, 4, 4], [1, 2, 3], { rotate: [0, 90, 0] }), cyl('c', 3, 8, [1, 1, 1]), sphere('s', 2), torus('t', 8, 2), extrude('e', 'sk1', 5), extrude('e2', 'sk1', 5, { taper: 3 }), revolve('rv', 'sk1', 360), revolve('rv2', 'sk1', 90),
    combine('u', 'union', ['b1', 'b2']), combine('d', 'subtract', ['b1', 'b2']), combine('i', 'intersect', ['b1', 'b2']), hole('h', 'b1', {}), pocket('p', 'sk1', 'b1'), move('m', 'b1', [1, 2, 3]), move('mc', 'b1', [1, 2, 3], true), rotate('r', 'b1', [90, 0, 90]), rotate('r2', 'b1', [0, 0, 45]),
    pattern('pa', 'b1', { count: 3, step: [2, 0, 0] }), pattern('pb', 'b1', { count: 1 }), pattern('pc', 'b1', { mode: 'circular', count: 4 }), mirror('mi', 'b1', 'yz'), { id: 'pr', kind: 'prism', sides: 6, radius: 3, height: 4, center: [0, 0, 0] }, { id: 'we', kind: 'wedge', width: 3, depth: 4, height: 5, center: [1, 1, 1] }];
  for (const f of features) {
    for (const mirrorAt of [undefined, { axis: 0, at: 0, how: 'analytic' }]) {
      const A = port.pm.analyticBox(f, st, { arc, mt }, mirrorAt);
      const O = orig.pm.analyticBox(f, ost, { arc, mt, patches: PATCHES }, { mirrorAt });
      assert.deepStrictEqual(A, O, `${f.kind} ${f.id}`);
    }
  }
});

test('the source-level front door (pm-preflight): the port equals the original on every case script and on constructed scripts', () => {
  const srcs = [...ALL_CASES.map((c) => c.src),
    'repeatAround(a, { count: 4, angle: 720 });', 'repeatAround(a, { count: 4, angle: -360 });', 'repeatAround(a, { count: 4, angle: 360 });', 'repeatAround(a, { count: 4, angle: 90 });', 'polarPattern(a, { count: 4, angle: 400 });',
    'const n = 720; repeatAround(a, { count: 4, angle: n });', 'repeatAround(a, opts); // angle', 'const f = repeatAround; f(a, { angle: 3 });', 'repeatAround(a, { "angle": 540, count: 3 });', 'repeatAround(a, { count: 3, angle: 2 * 180 });',
    'repeatAround(a, { count: 3, angle: 1e3 });', 'repeatAround(a, { count: 3 });', 'repeatAround(a);', '/* repeatAround(a, { angle: 720 }) */ box(1,1,1);', 'repeatAround(a, { count: 3, angle: foo(1) });', 'repeatAround(a, { count: 3, angle: 10 / 0 });', 'repeatAround(a, { count: 3, angle: (1 });', 'repeatAround(a, { count: [1, 2], angle: 90 })'];
  let hits = 0;
  for (const s of srcs) { const a = orig.pre.preflightScript(s); const b = port.pre.preflightScript(s); assert.deepStrictEqual(b, a, s); if (a) hits++; }
  assert.equal(port.pre.PREFLIGHT_SENTENCE, orig.pre.PREFLIGHT_SENTENCE); assert.equal(port.pre.PREFLIGHT_SENTENCE_VAR, orig.pre.PREFLIGHT_SENTENCE_VAR);
  assert.ok(hits >= 8, `${hits} scripts refused`);
});

test('summary', () => {
  const inSet = tally.inSet.docs;
  const reached = Object.keys(tally.guards).filter((g) => g !== '(none)').sort();
  const ALL = ['G-BUDGET', 'PM-CONTACT', 'PM-DISJOINT', 'PM-FUSED', 'PM-MIRCONTACT', 'PM-SLIVER', 'PM-SNAP', 'PM-SNAPCUT', 'PM-SUBGAP', 'PM-SUMCHECK', 'PM-TORUS', 'PM-WEB'];
  const missing = ALL.filter((g) => !reached.includes(g));
  console.log(`# patterns-mirror differential: ${tally.cases} comparisons (${inSet} docs in the equality set x ${CONFIGS.length} configs + the time-limit runs), ${tally.identical} identical, ${tally.thrown} thrown errors (the same on both), ${tally.calls} engine calls compared
# by corpus: ${JSON.stringify(tally.byCorpus)}; cases skipped (no ModelDoc): ${caseSkipped.length}
# built: ${JSON.stringify(tally.built)}
# refused: ${JSON.stringify(tally.refused)}
# guards reached (the port's names): ${JSON.stringify(tally.guards)}
# guards NOT reached by any doc under the fake: ${JSON.stringify(missing)}
# distinct refusal sentences (numbers and ids folded): ${tally.sentences.size}
# excluded docs (phase0 and phase 4 differ on a feature other than pattern / mirror): ${tally.excluded.docs} ${JSON.stringify(tally.excluded.kinds)}; of them the port differs from the original on ${tally.excluded.differ}, agrees on ${tally.excluded.agree}`);
  console.log(`# patterns-mirror: named exception (mirror contact probe failed): ${tally.mirrorProbeException ?? 0} runs`);
  assert.ok(tally.identical + (tally.mirrorProbeException ?? 0) === tally.cases);
  assert.ok((tally.mirrorProbeException ?? 0) > 0, 'the named exception never fired: it is untested');
  assert.ok(inSet > 600, `the equality set shrank: ${inSet}`);
  assert.ok(tally.excluded.differ > 0, 'no excluded doc really differs: the exclusion rule is vacuous');
  assert.ok(N_THEMES > 0);
});
