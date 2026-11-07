// DIFFERENTIAL TEST for the booleans fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/bool-translate-r3.mjs with booleans.guard.mjs, booleans.slow.mjs,
// booleans-r3/combine-exec.mjs and revolve-groove.guard.mjs, all untouched, wired exactly as the group's runner run-booleans.mjs wires them) against the compiled TypeScript port in
// 'booleans' mode (createTranslator({ planners: 'booleans' })). Both are fed the same ModelDocs through the same deterministic FAKE engine (test/fake-engine.mjs, no kernel, no wasm; its
// opt-in boolModel makes the executor and the after-the-build checks reachable) and must produce IDENTICAL output: the translateDoc result (features, commands), the ordered list of
// engine calls (the commands of every run) and a thrown error.
//
// HOW THE TWO ARE COMPARED. The port notes two more fields on a refusal than the original (`guard`: the code of the guard or of the sentence rule, `raw`: the text the sentence was made
// from) and `evidence: null` on a built feature (every generic step in the layer does); they are dropped before the comparison. What is compared: status, the sentence, the commands, the
// measure, pickedFrom, variantsTried, pick. The port ALSO passes { budgetS } to every engine run of a combine (the group's rule for the page: the original has no code for it); the options are
// recorded apart: the commands of the runs are compared, and the options are asserted to be on the runs of a combine and on no other.
//
// WHAT "IDENTICAL" CAN MEAN HERE (NOTES.md "Fold 5"). The original is phase0/translate.mjs + patches; the layer's base is the phase 4 translator. Where phase0 and phase 4 plan a feature
// OTHER than a combine differently, the two cannot be equal: such a doc is EXCLUDED from the equality requirement, counted with the kind that differs, and shown to really differ. They are the
// ones of fold 4: a shell, a fillet or a draft (the original asks brep-rs for the point of a name, the port reads the engine's topology) and a constrained sketch (soup) used by a pull,
// pocket, spin, groove or loft. Any difference outside them is a failure of this test.
//
// This shows the port equals the original on the inputs below. It does NOT show that a built solid is right: the fake has no geometry kernel (its boolModel is a few lines on bounding boxes).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs, generatedDoc } from './docs.mjs';
import { boolDoc, N_THEMES } from './bool-docs.mjs';
import { loadOriginal, origCtx } from './booleans-original.mjs';
import { box, cyl, sphere, cone, torus, prism, wedge, rect, circ, extrude, pocket, combine, mirror, pattern, hole, move, rotate, revolve } from './docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);
const orig = await loadOriginal(contract);
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), b: await dist('booleans.js'), g: await dist('booleans-guard.js'), sl: await dist('booleans-slow.js') };
const BOOL = port.tr.createTranslator({ planners: 'booleans' });
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const CONFIGS = [
  { name: 'boxBool+boolModel, mt', fake: { boxBool: true, boolModel: true }, useMt: true },
  { name: 'default fake, mt', fake: {}, useMt: true },
  { name: 'boxBool+boolModel, every 5th call fails, no mt', fake: { boxBool: true, boolModel: true, failEvery: 5 }, useMt: false },
  { name: 'all models (hole, shell, pm, bool), mt', fake: { boxBool: true, boolModel: true, holeModel: true, shellDraft: true, pmModel: true }, useMt: true },
  { name: 'boxBool+boolModel, the bridge dies on every 7th call (WASM TRAP path), mt', fake: { boxBool: true, boolModel: true, throwWhen: (cmds, k) => k % 7 === 0 }, useMt: true },
];

const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
const norm = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));

/** the original's notes, in the shape the port gives (nothing to rename: the original's refusal IS the sentence) */
function normOrig(tr) {
  return {
    features: tr.features.map((f) => {
      const o = { id: f.id, kind: f.kind, status: f.status, commands: f.commands };
      if (f.status === 'refused') o.refusal = f.refusal; else if (f.status === 'built') Object.assign(o, { measure: f.measure, pickedFrom: f.pickedFrom, variantsTried: f.variantsTried, pick: f.pick });
      return o;
    }),
    commands: tr.commands,
  };
}
function runOrig(item, cfg) {
  const fake = makeFake({ sync: true, ...cfg.fake });
  const doc = structuredClone(item.doc);
  let result; let error = null;
  try { result = norm(normOrig(orig.tr.translateDoc(doc, origCtx(orig, { arc, skipSketchVolume: true, skipOpenOutline: true, mt }, doc, fake.runSC, cfg.useMt)))); } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log };
}
async function runPort(tr, item, cfg, extra = {}, passOpts = false) {
  const fake = makeFake({ ...cfg.fake });
  const optsLog = [];
  const runSC = (cmds, opts) => { optsLog.push({ opts: opts ?? null, last: cmds[cmds.length - 1]?.command }); return passOpts ? fake.runSC(cmds, opts) : fake.runSC(cmds); };
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, runSC, topologyOf: fake.topologyOf, soups: {}, ...(cfg.useMt ? { mt } : {}), ...extra };
  let result; let error = null; let guards = [];
  try {
    const { _state, ...rest } = await tr.translateDoc(structuredClone(item.doc), ctx);
    assert.ok(_state);
    guards = rest.features.filter((f) => f.status === 'refused').map((f) => f.guard ?? null);
    result = norm({ features: rest.features.map(({ guard, raw, evidence, ...f }) => f), commands: rest.commands });
  } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, guards, optsLog };
}

// ---- where phase0 and phase 4 plan a feature other than a combine differently ------------------------------------------------------------------
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
const { CASES } = await imp(path.join(contract, 'boolean-cases.mjs'));
for (const f of ['boolean-cases-r2.mjs', 'boolean-cases-r3.mjs', 'boolean-cases-r4.mjs', 'boolean-cases-r5.mjs', 'boolean-cases-r6.mjs']) await imp(path.join(contract, f));
const caseDocs = []; const caseSkipped = []; const seenCase = new Set();
for (const c of CASES) {
  const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.features)}`; if (seenCase.has(key)) continue; seenCase.add(key);
  if (c.script === undefined) { caseDocs.push({ name: `case ${c.id}`, doc: solveDoc({ version: 1, features: c.features }) }); continue; }
  const r = runScript(c.script);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); continue; }
  caseDocs.push({ name: `case ${c.id}`, doc: solveDoc(r.doc) });
}
const N_GEN = 720;
const generated = Array.from({ length: N_GEN }, (_, i) => ({ name: `bool seed ${i}`, doc: boolDoc(i) }));
const hand = handDocs().map(([name, doc]) => ({ name: `hand ${name}`, doc }));
const baseGen = Array.from({ length: 160 }, (_, i) => ({ name: `generated seed ${1000 + i}`, doc: generatedDoc(1000 + i) }));

// hand-written docs aimed at single guards (each is also reached by the generator, these name the intent and make sure it is reached)
const B = (i, size = [20, 20, 10], at = [0, 0, 0], x) => box(i, size, at, x);
const aimed = [
  ['G1 the same shape twice', [B('b1'), combine('c1', 'union', ['b1', 'b1']), combine('c2', 'subtract', ['b1', 'b1'])]],
  ['G10 a tube tool that sticks out', [B('b1', [30, 30, 20]), { ...rect('sk1', 6, 14), points: [[3, 0], [6, 0], [6, 14], [3, 14]] }, revolve('v1', 'sk1', 360), combine('c1', 'subtract', ['b1', 'v1'])]],
  ['G2 two cylinders at right angles, a cone and a box, a torus and a box', [cyl('c1', 5, 20), cyl('c2', 3, 20, [0, 0, 0], { rotate: [90, 0, 0] }), combine('k1', 'union', ['c1', 'c2']), cone('n1', 6, 12), B('b2', [10, 10, 10], [3, 0, 0]), combine('k2', 'union', ['n1', 'b2']), torus('t1', 8, 2), B('b3', [30, 30, 10], [3, 0, 0]), combine('k3', 'subtract', ['b3', 't1'])]],
  ['G3 a sliver overlap (flat, turned, curved)', [B('b1'), B('b2', [10, 10, 10], [9.999, 0, 0]), combine('c1', 'subtract', ['b1', 'b2']), B('b3'), B('b4', [10, 10, 10], [9.95, 0, 0], { rotate: [0, 0, 30] }), combine('c2', 'intersect', ['b3', 'b4']), B('b5', [100, 100, 20]), sphere('s1', 20, [0, 0, 29]), combine('c3', 'intersect', ['b5', 's1'])]],
  ['G4 a cut that misses; G5 a keep that is empty', [B('b1'), B('b2', [5, 5, 5], [40, 0, 0]), combine('c1', 'subtract', ['b1', 'b2']), B('b3'), B('b4', [5, 5, 5], [40, 0, 0]), combine('c2', 'intersect', ['b3', 'b4'])]],
  ['G6 a pinch join (an edge, a point, a ball on a face)', [B('b1'), B('b2', [10, 10, 10], [10, 10, 0]), combine('c1', 'union', ['b1', 'b2']), B('b3'), sphere('s1', 5, [0, 0, 15]), combine('c2', 'union', ['b3', 's1'])]],
  ['G7 a cylinder tangent to two sides, an inscribed ball', [B('b1', [20, 20, 10]), cyl('c1', 5, 30, [5, 5, 0]), combine('k1', 'subtract', ['b1', 'c1']), B('b2', [20, 20, 20]), sphere('s1', 10, [0, 0, 0]), combine('k2', 'subtract', ['b2', 's1'])]],
  ['G13 a ring and a coaxial cylinder at the inner equator', [torus('t1', 8, 2), cyl('c1', 6, 10), combine('k1', 'union', ['t1', 'c1'])]],
  ['G14 a hollow ball', [sphere('s1', 10), sphere('s2', 5), combine('c1', 'subtract', ['s1', 's2'])]],
  ['G16 a tilted cylinder through a box; G18 a rounded box and a cylinder', [B('b1', [20, 20, 10]), cyl('c1', 3, 30, [0, 0, 0], { rotate: [30, 0, 0] }), combine('k1', 'subtract', ['b1', 'c1']), B('b2', [30, 30, 20], [0, 0, 0], { round: 3 }), cyl('c2', 12, 30, [10, 0, 0]), combine('k2', 'subtract', ['b2', 'c2'])]],
  ['G17 a keep of two cylinders on one axis; G20 two parallel cylinders that cross', [cyl('c1', 5, 20), cyl('c2', 5, 20, [0, 0, 10]), combine('k1', 'intersect', ['c1', 'c2']), cyl('c3', 5, 20), cyl('c4', 5, 20, [6, 0, 0]), combine('k2', 'intersect', ['c3', 'c4'])]],
  ['G19 a keep that overshoots; G21 a curved remainder under 3 percent', [B('b1', [400, 400, 20]), sphere('s1', 200, [0, 0, 195]), combine('c1', 'intersect', ['b1', 's1']), cyl('c2', 10, 20), B('b2', [20.2, 20.2, 24]), combine('c3', 'subtract', ['c2', 'b2'])]],
  ['pieces: a cut that splits, then a cut, a join, a keep, a hole and a move of the pieces', [B('b1', [40, 20, 10]), B('t1', [6, 40, 20]), combine('c1', 'subtract', ['b1', 't1']), B('t2', [4, 4, 30], [12, 0, 0]), combine('c2', 'subtract', ['c1', 't2']), B('j1', [8, 8, 8], [-12, 0, 0]), combine('c3', 'union', ['c2', 'j1']), hole('h1', 'c3', {}), move('m1', 'c3', [1, 0, 0])]],
  ['keep of three; join of four; cut with two tools', [B('b1'), B('b2', [10, 10, 10], [4, 0, 0]), B('b3', [10, 10, 10], [-4, 0, 0]), combine('c1', 'intersect', ['b1', 'b2', 'b3']), B('b4'), B('b5', [10, 10, 10], [4, 0, 0]), B('b6', [10, 10, 10], [-4, 0, 0]), B('b7', [10, 10, 10], [0, 4, 0]), combine('c2', 'union', ['b4', 'b5', 'b6', 'b7']), B('b8', [30, 30, 10]), cyl('c9', 3, 20, [5, 0, 0]), cyl('c10', 3, 20, [-5, 0, 0]), combine('c3', 'subtract', ['b8', 'c9', 'c10'])]],
  ['G8 a tool a later join uses again (keep_tools), an operand used up, a combine of a combine', [B('b1', [30, 30, 10]), cyl('t1', 4, 20), combine('c1', 'subtract', ['b1', 't1']), B('b2', [20, 20, 10], [30, 0, 0]), combine('c2', 'union', ['b2', 't1']), combine('c3', 'union', ['c1', 'c2']), combine('c4', 'subtract', ['b1', 't1'])]],
  ['dependencies: a refused combine, then a hole, a pull and a combine on it', [B('b1'), combine('c1', 'union', ['b1', 'b1']), hole('h1', 'c1', {}), rect('sk1', 5, 5), pocket('pk1', 'sk1', 'c1', 3), combine('c2', 'subtract', ['c1', 'b1']), mirror('x1', 'c1', 'yz'), pattern('p1', 'c1', { count: 2, step: [30, 0, 0] })]],
  ['one target, a missing target, a ghost body, a sketch as operand', [B('b1'), combine('c1', 'union', ['b1']), combine('c2', 'union', ['b1', 'nope']), B('ghost1'), combine('c3', 'union', ['b1', 'ghost1']), rect('sk1', 5, 5), combine('c4', 'union', ['b1', 'sk1'])]],
  ['malformed: a primitive without a size, a combine without targets', [{ id: 'b1', kind: 'box' }, B('b2'), combine('c1', 'union', ['b1', 'b2']), { id: 'c2', kind: 'combine', op: 'union' }]],
  ['a pull and a spin as operands; the sketches that make them', [B('b1', [30, 30, 20]), { ...rect('sk1', 10, 8), points: [[-5, -4], [5, -4], [5, 4], [-5, 4]] }, extrude('e1', 'sk1', 30), combine('c1', 'subtract', ['b1', 'e1']), circ('sk2', 4, 5, 0), extrude('e2', 'sk2', 8), combine('c2', 'union', ['c1', 'e2'])]],
  ['every primitive kind joined onto a box', [B('b1', [40, 40, 20]), cyl('c1', 4, 30, [5, 0, 0]), sphere('s1', 5, [10, 10, 0]), cone('n1', 5, 12, [-10, 0, 0]), torus('t1', 6, 1, [0, 12, 0]), prism('p1', 6, 5, 8, [12, -12, 0]), wedge('w1', 8, 6, 6, [-14, -12, 0]), combine('k1', 'union', ['b1', 'c1', 's1', 'n1', 'p1', 'w1'])]],
];
const aimedDocs = aimed.map(([name, features]) => ({ name: `aimed ${name}`, doc: { version: 1, features } }));

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), calls: 0,
  inSet: { docs: 0 }, excluded: { docs: 0, kinds: {}, differ: 0, agree: 0 }, byCorpus: {}, combineRuns: 0, otherRuns: 0, optsBad: [],
};
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const shape = (s) => String(s).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f|d|pk|pa|mi|u|sph|cyl|ghost|t|v|k|n|w|j|z)\d*\b/g, '$1');
function note(a, b) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'refused') { bump(tally.refused, f.kind); tally.sentences.add(shape(f.refusal)); }
  }
  for (const g of b.guards) bump(tally.guards, g ?? '(none)');
}
/** the options: every run whose last command is a solid.combine of a booleans feature carries { budgetS: 45 + ... }, every other run carries none */
function checkOpts(name, cfgName, b, doc) {
  const hasCombine = doc.features.some((f) => f.kind === 'combine');
  for (const o of b.optsLog) {
    const wants = o.last === 'solid.combine';
    if (o.opts) {
      tally.combineRuns++;
      if (!(typeof o.opts.budgetS === 'number' && o.opts.budgetS >= 45 && Object.keys(o.opts).length === 1)) tally.optsBad.push(`${name} [${cfgName}]: ${JSON.stringify(o.opts)}`);
      if (!wants || !hasCombine) tally.optsBad.push(`${name} [${cfgName}]: options on a run that does not end in a combine (${o.last})`);
    } else tally.otherRuns++;
  }
}
async function compareDoc(name, item, cfg, extra = {}) {
  const a = runOrig(item, cfg);
  const b = await runPort(BOOL, item, cfg, extra);
  tally.cases++;
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  checkOpts(name, cfg.name, b, item.doc);
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
      const a = runOrig(item, CONFIGS[0]); const b = await runPort(BOOL, item, CONFIGS[0]);
      try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.error, a.error); tally.excluded.agree++; } catch { tally.excluded.differ++; }
      continue;
    }
    tally.inSet.docs++; tally.byCorpus[label].inSet++;
    for (const cfg of CONFIGS) await compareDoc(item.name, item, cfg);
  }
}

test('the set exists, is a member of nothing else by accident, and the default stays base', () => {
  assert.equal(BOOL.planners, 'booleans');
  assert.equal(port.tr.createTranslator().planners, 'base');
  assert.ok(Object.keys(port.tr.PROFILES).includes('booleans'));
  assert.deepStrictEqual(port.b.BOOL_KINDS, ['combine']);
  // the executor decides the commands, so the planner of a combine returns a plan with no variants: it is the step that runs it
  const st = { head: {}, bodies: { a: ['b_a'], b: ['b_b'] }, stale: {}, refused: {}, sketches: {}, measure: { a: { volume: 8000, faces: 6, kernelFaces: 6, curved: false, bbox: [-10, -10, -10, 10, 10, 10], faceTypes: { plane: 6 }, com: [0, 0, 0], bodies: ['b_a'] }, b: { volume: 1000, faces: 6, kernelFaces: 6, curved: false, bbox: [5, -5, -5, 15, 5, 5], faceTypes: { plane: 6 }, com: [10, 0, 0], bodies: ['b_b'] } }, counter: 0, accLen: {} };
  port.b.initBool(st, { features: [{ id: 'a', kind: 'box', size: [20, 20, 20], center: [0, 0, 0] }, { id: 'b', kind: 'box', size: [10, 10, 10], center: [10, 0, 0] }, { id: 'c', kind: 'combine', op: 'union', targets: ['a', 'b'] }] });
  const p = BOOL.planFeature({ id: 'c', kind: 'combine', op: 'union', targets: ['a', 'b'] }, st, { arc, skipSketchVolume: true, skipOpenOutline: true, runSC: () => ({ ok: true }), resolve: () => null });
  assert.deepStrictEqual(p.r3, { op: 'union', groups: [['b_a'], ['b_b']], keep: [false, false] });
});

test('(a) every case of the group that turns into a ModelDoc', { timeout: 3_000_000 }, async () => {
  await runCorpus('cases', caseDocs);
});
test('(b) aimed docs, the base hand docs, 160 base-generated docs and 720 generated docs', { timeout: 3_000_000 }, async () => {
  await runCorpus('aimed', aimedDocs);
  await runCorpus('hand', hand);
  await runCorpus('base-generated', baseGen);
  await runCorpus('generated', generated);
});

test('the time limit: a run past its budget refuses the combine with the group sentence and G-BUDGET; the budget is 45 s plus 1.5 x the last run; a host that ignores it changes nothing', { timeout: 600_000 }, async () => {
  const docs = [
    ['subtract', [B('b1', [30, 30, 10]), cyl('t1', 4, 20), combine('c1', 'subtract', ['b1', 't1'])]],
    ['union', [B('b1', [30, 30, 10]), B('b2', [10, 10, 10], [5, 0, 0]), combine('c1', 'union', ['b1', 'b2']), B('b3', [10, 10, 10], [10, 0, 0]), combine('c2', 'subtract', ['c1', 'b3'])]],
  ];
  // a run that ends in a combine costs 50 s of CPU: past the 45 s of the first combine (the fake reports no CPU for the runs before it, so the last run was 0 s)
  const cfg = { name: 'cpu', fake: { boxBool: true, boolModel: true, cpuMs: (cmds) => (cmds[cmds.length - 1].command === 'solid.combine' ? 50000 : 10) }, useMt: true };
  for (const [op, features] of docs) {
    const b = await runPort(BOOL, { doc: { version: 1, features } }, cfg, {}, true);
    const c1 = b.result.features.find((f) => f.id === 'c1');
    assert.equal(c1.status, 'refused');
    assert.equal(c1.refusal, orig.G.SENTENCES.budget(op));
    assert.match(c1.refusal, /took longer than 45 seconds to calculate, so it was stopped and nothing was changed/);
    assert.equal(b.guards.filter(Boolean)[0], 'G-BUDGET');
  }
  // the budget of a run is 45 s plus 1.5 x the CPU of the last run: after a 10 s run a combine of 55 s fits (60 s), one of 70 s does not
  for (const [cost, built] of [[55000, true], [70000, false]]) {
    const fake = makeFake({ boxBool: true, boolModel: true, cpuMs: (cmds) => (cmds[cmds.length - 1].command === 'solid.combine' ? cost : 10000) });
    const seen = [];
    const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, mt, runSC: (c, o) => { seen.push(o?.budgetS ?? null); return fake.runSC(c, o); }, topologyOf: fake.topologyOf, soups: {} };
    const r = await BOOL.translateDoc({ version: 1, features: [B('b1', [30, 30, 10]), B('b2', [10, 10, 10], [5, 0, 0]), combine('c1', 'union', ['b1', 'b2'])] }, ctx);
    assert.equal(r.features.find((f) => f.id === 'c1').status, built ? 'built' : 'refused', `a combine run of ${cost} ms`);
    assert.deepStrictEqual(seen.filter((s) => s !== null), [60]);
  }
  // a host that ignores the option (the fake called without it) is not stopped: nothing is refused for time and the output is the original's
  for (const item of aimedDocs.slice(0, 6)) await compareDoc(`${item.name} (host ignores budgetS)`, item, CONFIGS[0]);
});

test('the pure guard and the sentences equal the original: SENTENCES, plainSentence, plainPieces, explainCombineArgs, obbDepth, orient, slantedMeeting, roundBandHit, guardCombine on random descriptors', () => {
  const rnd = (k) => { let a = k; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; };
  const r = rnd(11);
  const pick = (a) => a[Math.floor(r() * a.length)];
  // sentences: every key, every op
  assert.equal(port.g.BUDGET_S, orig.G.BUDGET_S);
  assert.deepStrictEqual(port.g.SLIVER, orig.G.SLIVER);
  for (const k of Object.keys(orig.G.SENTENCES)) {
    assert.ok(k in port.g.SENTENCES, k);
    for (const op of ['union', 'subtract', 'intersect', 'weird']) assert.equal(port.g.SENTENCES[k](op), orig.G.SENTENCES[k](op), `${k} ${op}`);
    assert.equal(port.g.SENTENCES[k](), orig.G.SENTENCES[k]());
  }
  assert.deepStrictEqual(Object.keys(port.g.SENTENCES), Object.keys(orig.G.SENTENCES));
  assert.equal(port.g.SENTENCES.sliver('subtract', 0.2), orig.G.SENTENCES.sliver('subtract', 0.2));
  // plainSentence: the raw texts the engine and the translator make, and the sentences themselves (which pass through)
  const raws = ['', undefined, null, 'x: no body named b_c1 came back', 'solidcraft ran the commands but no body named b_a, b_b came back', 'solid.combine: a body cannot be combined with itself', 'needs two or more targets', 'c1 (combine): needs two or more targets',
    'c1 (combine): its target b1 was already changed in place by c0, and a solidcraft command list has no second copy of it', 'c1 (combine): its target b1 was refused (x)', 'solid.combine: WASM TRAP: unreachable', 'undefined: WASM TRAP: fake', 'RuntimeError: unreachable executed', 'solid.combine: coincident faces', 'solid.combine: exact fallback for where the bodies meet',
    'planar faces only', 'curved faces', 'shallow angle', 'tangent', 'implausible result volume', 'not a manifold', 'tolerance', 'degenerate', 'failed to boolean', 'failed to intersect', 'could not', 'cannot', 'Cannot read properties of undefined (reading \'0\')', 'anything else', 'c1 (combine): every target must be a single body', 'c1: not a single body', 'needs a single measured target body',
    ...Object.values(orig.G.SENTENCES).map((f) => f('union')), ...Object.values(orig.G.SENTENCES).map((f) => f('subtract')), ...Object.values(orig.G.SENTENCES).map((f) => f('intersect'))];
  for (const f of [null, undefined, { op: 'union' }, { op: 'subtract' }, { op: 'intersect' }, { op: 'weird' }]) for (const t of raws) {
    assert.deepStrictEqual(port.g.plainSentence(t, f), orig.G.plainSentence(t, f), `${f?.op} / ${t}`);
    assert.equal(port.g.isPlain(String(t)), orig.G.isPlain(String(t)));
    assert.deepStrictEqual(port.g.plainPieces(t), orig.G.plainPieces(t), `pieces / ${t}`);
  }
  for (const s of [...raws, 'This cut() would leave only a very thin sliver of the part (under 3 percent of its volume), which cannot be calculated reliably here, so nothing was changed; cut less away, or remove the sliver on purpose with a different cut.', 'A bad  sentence', 'two. Sentences here.']) assert.deepStrictEqual(port.g.lintSentence(s), orig.G.lintSentence(s), String(s));
  // the script-level sentences
  const srcs = [['cut() needs two or more shapes: cut(a, b).', 'const a = box(1,1,1); cut(a);', 1], ['cut() needs two or more shapes: cut(a, b).', 'const a = box(1,1,1); cut(a, 5);', 1], ['join() needs two or more shapes', 'join([a, b]);', 1], ['join() needs two or more shapes', 'const l = [a, b]; join(l);', 1],
    ['keep() needs two or more shapes', 'keep(a, "x");', 1], ['keep() needs two or more shapes', 'const s = sketch("top"); join(a, s);', 1], ['keep() needs two or more shapes', 'join(a, nothing);', 1], ['cut() needs two or more shapes', 'cut(a, [1, 2]);', 1], ['cut() needs two or more shapes', 'cut(a);', 3], ['other', 'cut(a);', 1],
    ['Rounding works on a shape, not a combination. Round the shapes first.', '', 1], ['join() needs two or more shapes', 'const a = box(1,2,3); const n = 4; join(a, n);', 1], ['join() needs two or more shapes', 'join(a, join(b, c), 7);', 1], ['join() needs two or more shapes', undefined, undefined]];
  for (const [m, s, l] of srcs) {
    assert.equal(port.g.explainCombineArgs(m, s, l), orig.G.explainCombineArgs(m, s, l), `${m} / ${s}`);
    assert.equal(port.g.explainFront(m), orig.G.explainFront(m));
  }
  // orient / slantedMeeting / roundBandHit / obbDepth / cylInsideCyl on random primitives
  const prims = () => {
    const kind = pick(['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge']);
    const rot = r() < 0.5 ? [pick([0, 0, 30, 90]), pick([0, 0, 45, 90]), pick([0, 15, 45, 90])] : undefined;
    const base = { id: 'p', kind, center: [Math.round(r() * 40 - 20), Math.round(r() * 20 - 10), Math.round(r() * 10 - 5)], ...(rot ? { rotate: rot } : {}), ...(r() < 0.15 ? { round: 2 } : {}) };
    if (kind === 'box') return { ...base, size: [pick([6, 10, 20]), pick([6, 10]), pick([4, 10, 20])] };
    if (kind === 'cylinder' || kind === 'cone') return { ...base, radius: pick([3, 5, 8]), height: pick([8, 12, 20]) };
    if (kind === 'sphere') return { ...base, radius: pick([3, 5, 9]) };
    if (kind === 'torus') return { ...base, ringRadius: pick([8, 10]), tubeRadius: pick([1, 2]) };
    if (kind === 'prism') return { ...base, sides: pick([3, 6, 12]), radius: pick([4, 7]), height: pick([6, 10]) };
    return { ...base, width: pick([8, 12]), depth: pick([6, 8]), height: pick([4, 6]) };
  };
  let n = 0;
  for (let i = 0; i < 1500; i++) {
    const A = prims(); const Bf = prims(); A.id = 'pa'; Bf.id = 'pb';
    const feats = { pa: A, pb: Bf };
    const oa = orig.SL.orient('pa', feats, null, {}); const ob = port.sl.orient('pa', feats, null, {});
    assert.deepStrictEqual(ob, oa);
    const ia = orig.SL.orient('pa', feats, null); const ib = orig.SL.orient('pb', feats, null);
    const ja = port.sl.orient('pa', feats, null); const jb = port.sl.orient('pb', feats, null);
    assert.deepStrictEqual([ja, jb], [ia, ib]);
    assert.equal(port.sl.slantedMeeting({ info: ja, prim: A }, { info: jb, prim: Bf }), orig.SL.slantedMeeting({ info: ia, prim: A }, { info: ib, prim: Bf }));
    if (A.kind === 'cylinder' && Bf.kind === 'cylinder') assert.equal(port.sl.cylInsideCyl(A, Bf), orig.SL.cylInsideCyl(A, Bf));
    if (i % 5 === 0) assert.equal(port.sl.roundBandHit({ ...A, kind: 'box', size: [20, 20, 20], round: 3 }, Bf), orig.SL.roundBandHit({ ...A, kind: 'box', size: [20, 20, 20], round: 3 }, Bf));
    // guardCombine on the descriptors the two describe() give for the same measured box
    const meas = (f) => { const e = f.kind === 'box' ? f.size : f.kind === 'sphere' ? [2 * f.radius, 2 * f.radius, 2 * f.radius] : [2 * (f.radius ?? 5), 2 * (f.radius ?? 5), f.height ?? 8]; const c = f.center; return { bbox: [c[0] - e[0] / 2, c[1] - e[1] / 2, c[2] - e[2] / 2, c[0] + e[0] / 2, c[1] + e[1] / 2, c[2] + e[2] / 2], faceTypes: f.kind === 'box' ? { plane: 6 } : { plane: 2, cylinder: 1 }, curved: f.kind !== 'box' }; };
    for (const op of ['union', 'subtract', 'intersect']) {
      const f = { id: 'c', op, targets: i % 17 === 0 ? ['pa', 'pa'] : ['pa', 'pb'] };
      const mk = (G, SL, F) => [{ id: 'pa', d: G.describe(meas(A), A, { pieces: 1, info: F.pa }) }, { id: 'pb', d: G.describe(meas(Bf), Bf, { pieces: 1, info: F.pb }) }];
      const go = orig.G.guardCombine(f, mk(orig.G, orig.SL, { pa: ia, pb: ib }));
      const gp = port.g.guardCombine(f, mk(port.g, port.sl, { pa: ja, pb: jb }));
      assert.deepStrictEqual(gp, go, `guardCombine ${op} ${JSON.stringify([A, Bf])}`);
      if (go) n++;
      const ob2 = orig.G.obbDepth(mk(orig.G, orig.SL, { pa: ia, pb: ib })[0].d, mk(orig.G, orig.SL, { pa: ia, pb: ib })[1].d);
      const pb2 = port.g.obbDepth(mk(port.g, port.sl, { pa: ja, pb: jb })[0].d, mk(port.g, port.sl, { pa: ja, pb: jb })[1].d);
      assert.equal(pb2, ob2);
      // afterCombine
      const m = { volume: 100 * r(), bbox: [-5, -5, -5, 5, 5, 5].map((v) => v + (r() < 0.2 ? 0.01 * r() : 0)), curved: r() < 0.5 };
      const bf = { volume: pick([100, 1000, 3]) };
      const boxes = r() < 0.8 ? [[-5, -5, -5, 5, 5, 5], [-4, -5, -5, 6, 5, 5]] : undefined;
      assert.deepStrictEqual(port.g.afterCombine(f, m, bf, boxes), orig.G.afterCombine(f, m, bf, boxes));
    }
  }
  assert.ok(n > 300, `${n} random pairs reached a guard`);
  // reusedTools
  const feats = [{ id: 'a' }, { id: 'c1', kind: 'combine', targets: ['a', 't'] }, { id: 'x', kind: 'move', target: 't' }, { id: 'c2', kind: 'combine', targets: ['c1', 'z'] }];
  assert.deepStrictEqual(port.g.reusedTools(feats[1], feats), orig.G.reusedTools(feats[1], feats));
});

test('summary', () => {
  const inSet = tally.inSet.docs;
  const reached = Object.keys(tally.guards).filter((g) => g !== '(none)').sort();
  const ALL = ['G1', 'G10', 'G2', 'G16', 'G18', 'G17', 'G20', 'G13', 'G14', 'G3', 'G3b', 'G4', 'G5', 'G7', 'G6', 'G4b', 'G19', 'G21', 'G12', 'K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K9a', 'K9b'];
  const missing = ALL.filter((g) => !reached.includes(g));
  console.log(`# booleans differential: ${tally.cases} comparisons (${inSet} docs in the equality set x ${CONFIGS.length} configs + the host-ignores-budget runs), ${tally.identical} identical, ${tally.thrown} thrown errors (the same on both), ${tally.calls} engine calls compared
# by corpus: ${JSON.stringify(tally.byCorpus)}; cases skipped (no ModelDoc): ${caseSkipped.length}
# built: ${JSON.stringify(tally.built)}
# refused: ${JSON.stringify(tally.refused)}
# guards / sentence rules reached (the port's codes): ${JSON.stringify(tally.guards)}
# NOT reached by any doc of the equality set under the fake: ${JSON.stringify(missing)} (G-BUDGET is reached by the time-limit test, PLAIN is the same text passing through plainSentence after G4b / G19 / G21 and is reported under that guard's code)
# runs with { budgetS }: ${tally.combineRuns}, runs without: ${tally.otherRuns}
# distinct refusal sentences (numbers and ids folded): ${tally.sentences.size}
# excluded docs (phase0 and phase 4 differ on a feature other than a combine): ${tally.excluded.docs} ${JSON.stringify(tally.excluded.kinds)}; of them the port differs from the original on ${tally.excluded.differ}, agrees on ${tally.excluded.agree}`);
  assert.ok(tally.identical === tally.cases);
  assert.deepStrictEqual(tally.optsBad, []);
  assert.ok(inSet > 700, `the equality set shrank: ${inSet}`);
  assert.ok(tally.excluded.differ > 0, 'no excluded doc really differs: the exclusion rule is vacuous');
  assert.ok(N_THEMES > 0);
});
