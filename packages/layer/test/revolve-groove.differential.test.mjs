// DIFFERENTIAL TEST for the revolve-groove fold: the ORIGINAL group translators (docs/spikes/solidcraft-referee/contract/revolve-groove-rig/rg-translate-p4.mjs and rg-translate-p0.mjs with
// revolve-groove.guard.mjs, all untouched) against the compiled TypeScript port in 'revolve-groove' mode (createTranslator({ planners: 'revolve-groove' })). Both are fed the same ModelDocs through the same
// deterministic FAKE engine (test/fake-engine.mjs, no kernel, no wasm; its opt-in rgModel makes the group's after-the-build check and the split pieces reachable) and must produce IDENTICAL output: the
// translateDoc result (features, commands), the ordered list of engine calls (the commands of every run) and a thrown error.
//
// TWO ORIGINALS, TWO EQUALITY SETS.
//   * rg-translate-p4.mjs is translate-p4.mjs (the phase 7 pane translator) + the group's eleven patches. The layer's base IS a port of translate-p4.mjs, so the set equals this original on EVERY document: no exclusion.
//   * rg-translate-p0.mjs is phase0/translate.mjs + the same patches (the translator the committed rows were built with). It plans some other kinds differently (a shell / fillet / draft name is asked of brep-rs, a
//     constrained sketch used by a pull, pocket, spin, groove or loft is refused, a throw inside the bridge is worded "WASM TRAP" where phase 4 says "bridge error"). Such documents (and the configuration whose
//     bridge throws) are EXCLUDED from the p0 comparison, counted, and shown to really differ; any other difference fails the test.
//
// HOW THE NOTES ARE COMPARED. The port notes two more things than the original: `guard` is the CODE of the guard that refused (the original has none), and `evidence: null` on a built feature (every generic step
// in the layer does). The original's own `guard` (the cost features, the engine angle, the side) is the port's `rg`; the test renames it back before comparing. What is compared: status, the sentence, the commands, the
// measure, pickedFrom, variantsTried, pick, failed, sketchAtFailure and the original's guard object. The port ALSO passes { budgetS } to every engine run of a groove (the group's rule for the page: the original
// has no code for it); the options are recorded apart: the commands of the runs are compared, and the options are asserted to be on the runs of a groove and on no other.
//
// This shows the port equals the original on the inputs below. It does NOT show that a built solid is right: the fake has no geometry kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs, generatedDoc } from './docs.mjs';
import { rgDoc, N_THEMES } from './rg-docs.mjs';
import { box, cyl, sphere, cone, torus, rect, circ, extrude, pocket, combine, mirror, pattern, hole, shell, move, rotate, revolve, groove, soup, line } from './docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const rig = path.join(contract, 'revolve-groove-rig');
const imp = (p) => import(pathToFileURL(p).href);
const orig = { RG: await imp(path.join(contract, 'revolve-groove.guard.mjs')), p4: await imp(path.join(rig, 'rg-translate-p4.mjs')), p0: await imp(path.join(rig, 'rg-translate-p0.mjs')) };
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), rg: await dist('revolve-groove.js'), g: await dist('revolve-groove-guard.js') };
const RGSET = port.tr.createTranslator({ planners: 'revolve-groove' });
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const CONFIGS = [
  { name: 'boxBool+rgModel, mt', fake: { boxBool: true, rgModel: true }, useMt: true },
  { name: 'default fake, mt', fake: {}, useMt: true },
  { name: 'boxBool+rgModel, every 5th call fails, no mt', fake: { boxBool: true, rgModel: true, failEvery: 5 }, useMt: false },
  { name: 'all models (hole, shell, pm, bool, rg), mt', fake: { boxBool: true, rgModel: true, boolModel: true, holeModel: true, shellDraft: true, pmModel: true }, useMt: true },
  { name: 'boxBool+rgModel, the bridge dies on every 7th call (bridge error path), mt', fake: { boxBool: true, rgModel: true, throwWhen: (cmds, k) => k % 7 === 0 }, useMt: true, throws: true },
];

const same = (x, y) => { try { assert.deepStrictEqual(x, y); return true; } catch { return false; } };
const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
const norm = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));

/** the original's result as the test compares it (p0 has no evidence, failed or sketchAtFailure on its notes) */
function normOrig(tr, which) {
  return {
    features: tr.features.map((f) => {
      const { evidence, failed, sketchAtFailure, ...rest } = f;
      return which === 'p4' ? { ...rest, ...(evidence !== undefined ? { evidence } : {}), ...(failed !== undefined ? { failed } : {}), ...(sketchAtFailure !== undefined ? { sketchAtFailure } : {}) } : rest;
    }),
    commands: tr.commands,
  };
}
async function runOrig(which, item, cfg) {
  const fake = makeFake({ sync: which === 'p0', ...cfg.fake });
  const doc = structuredClone(item.doc);
  let result; let error = null; const soups = {};
  try {
    const ctx = which === 'p0' ? { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, ...(cfg.useMt ? { mt } : {}), runSC: fake.runSC, resolveAt: () => null } : { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, ...(cfg.useMt ? { mt } : {}), runSC: fake.runSC, topologyOf: fake.topologyOf, soups };
    const res = await orig[which].translateDoc(doc, ctx);
    result = norm(normOrig(res, which));
  } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, soups };
}
/** the port's result in the original's shape: `guard` (code) dropped, `rg` renamed to `guard` */
function normPort(rest, which) {
  return {
    features: rest.features.map((f) => {
      const { guard, rg, evidence, failed, sketchAtFailure, ...r } = f;
      const o = { ...r, ...(rg !== undefined ? { guard: rg } : {}) };
      if (which === 'p4') { if (f.status === 'built') o.evidence = evidence ?? null; else if (failed !== undefined) { o.failed = failed; o.sketchAtFailure = sketchAtFailure; } }
      return o;
    }),
    commands: rest.commands,
  };
}
async function runPort(tr, item, cfg, which = 'p4', extra = {}, passOpts = false) {
  const fake = makeFake({ ...cfg.fake });
  const optsLog = [];
  const runSC = (cmds, opts) => { optsLog.push({ opts: opts ?? null, last: cmds[cmds.length - 1]?.command, op: cmds[cmds.length - 1]?.params?.operation }); return passOpts ? fake.runSC(cmds, opts) : fake.runSC(cmds); };
  const soups = {};
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, runSC, topologyOf: fake.topologyOf, soups, ...(cfg.useMt ? { mt } : {}), ...extra };
  let result; let error = null; let guards = [];
  try {
    const { _state, ...rest } = await tr.translateDoc(structuredClone(item.doc), ctx);
    assert.ok(_state);
    guards = rest.features.filter((f) => f.status === 'refused').map((f) => f.guard ?? null);
    result = norm(normPort(rest, which));
  } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, guards, optsLog, soups, raw: result };
}

// ---- where phase0 and phase 4 plan a feature other than a spin / groove differently ----------------------------------------------------------------
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
const caseFiles = ['cases-r3.mjs', 'cases-r3-chainprobe.mjs', 'cases-r3-fuzz.mjs', 'cases-r3-sliver.mjs', 'cases-r3-spinfuzz.mjs', 'cases-r4-graze.mjs', 'cases-r5-regress.mjs', 'cases-r5-wall.mjs'];
const allSrcCases = [];
{
  const { allCases } = await imp(path.join(rig, 'rg-cases.mjs'));
  allSrcCases.push(...allCases('/nonexistent-rg-dir', []));
  for (const f of caseFiles) allSrcCases.push(...(await imp(path.join(rig, f))).cases);
}
const caseDocs = []; const caseSkipped = []; const seenCase = new Set();
for (const c of allSrcCases) {
  if (typeof c.src !== 'string') continue;
  const key = `${c.id}\u0000${c.src}`; if (seenCase.has(key)) continue; seenCase.add(key);
  const r = runScript(c.src);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); continue; }
  caseDocs.push({ name: `case ${c.id}`, doc: solveDoc(r.doc) });
}
const N_GEN = 600;
const generated = Array.from({ length: N_GEN }, (_, i) => ({ name: `rg seed ${i}`, doc: rgDoc(i) }));
const hand = handDocs().map(([name, doc]) => ({ name: `hand ${name}`, doc }));
const baseGen = Array.from({ length: 160 }, (_, i) => ({ name: `generated seed ${1000 + i}`, doc: generatedDoc(1000 + i) }));

// hand-written docs aimed at single guards (each is also reached by the generator, these name the intent and make sure it is reached)
const R = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const S = (id, points, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points, ...extra });
const POST = [cyl('c1', 15, 30, [0, 0, 0])];
const aimed = [
  ['G1 a part turn of a profile on the -u side (spin and groove)', [S('s1', R(-12, -4, 0, 10)), revolve('v1', 's1', 90), box('b1', [60, 60, 40], [0, 0, 0]), S('s2', R(-30, -26, -5, 5)), groove('g1', 's2', 'b1', 90)]],
  ['G2 a full turn that splits the part, then a groove into the pieces', [...POST, S('s1', R(5, 8, -20, 20)), groove('g1', 's1', 'c1', 360), S('s2', R(10, 12, -3, 3)), groove('g2', 's2', 'c1', 360)]],
  ['G3 angles of 400, 720, -720, 721, 0 and a string', [S('s1', R(5, 10, 0, 10)), revolve('v1', 's1', 400), revolve('v2', 's1', 720), revolve('v3', 's1', -720), revolve('v4', 's1', 721), revolve('v5', 's1', 0), revolve('v6', 's1', '90'), revolve('v7', 's1', 0.5)]],
  ['G4 the profiles: starter, bow-tie, one line, dup, crossing the axis, touching, a soup, two shapes', [S('s1', [[0, 0], [40, 0], [40, 25], [0, 25]], { constraints: [{}, {}, {}, {}] }), revolve('v1', 's1', 90), S('s2', [[5, 0], [15, 10], [15, 0], [5, 10]]), revolve('v2', 's2', 90), S('s3', [[5, 0], [10, 5], [15, 10]]), revolve('v3', 's3', 90), S('s4', R(-5, 8, 0, 10)), revolve('v4', 's4', 90), soup('s5', [line(1, [0, 0], [10, 0]), line(2, [10, 0], [10, 8]), line(3, [10, 8], [0, 8]), line(4, [0, 8], [0, 0])], []), revolve('v5', 's5', 90), S('s6', [[5, 0], [5, 0], [15, 10], [5, 10]]), revolve('v6', 's6', 90)]],
  ['G4 a ring that cannot touch the part, a groove into a sketch, a groove into pieces', [box('b1', [20, 20, 10], [0, 0, 0]), S('s1', R(200, 210, 0, 5)), groove('g1', 's1', 'b1', 360), S('s2', R(8, 9, -2, 2)), groove('g2', 's2', 's1', 360), groove('g3', 'nope', 'b1', 90)]],
  ['G5 a part turn that turns away from the part: the engine returns it unchanged', [box('b1', [20, 20, 10], [30, 0, 0]), S('s1', R(-26, -22, -4, 4)), groove('g1', 's1', 'b1', 40)]],
  ['G6 a groove the engine refuses (a ghost body), a spin that comes back empty', [box('ghost1', [20, 20, 10], [0, 0, 0]), S('s1', R(3, 5, -2, 2)), groove('g1', 's1', 'ghost1', 360), S('s2', R(5, 9, 0, 10)), { id: 'v1', kind: 'revolve', target: 's2', angle: 90, body: 'x' }]],
  ['G7 the profile plane holds a flat face of a box: part turn refused, full turn built with the plane turned', [box('b1', [40, 40, 20], [0, 0, 10]), S('s1', R(8, 14, 2, 10), { plane: 'xz' }), groove('g1', 's1', 'b1', 90), S('s2', R(8, 14, 2, 10), { plane: 'xz' }), groove('g2', 's2', 'b1', 360)]],
  ['G8 the cost rule: a torus tool, a cone tool, a part turn reaching a round wall, a full turn off the axis, a tilted axis', [...POST, S('s1', [[10, 0], [12, 0]], { shape: 'circle' }), groove('g1', 's1', 'c1', 360), S('s2', [[10, 5], [13, 5], [10, 9]]), groove('g2', 's2', 'c1', 360), S('s3', R(10, 16, 5, 9)), groove('g3', 's3', 'c1', 120), cyl('c2', 15, 30, [40, 0, 0]), S('s4', R(8, 10, 2, 5)), groove('g4', 's4', 'c2', 360), box('b3', [30, 30, 30], [80, 0, 0]), S('s5', R(5, 8, 2, 6), { frame: { origin: [80, 0, 0], u: [0.7071067811865476, 0.7071067811865476, 0], v: [0, 0, 1] } }), groove('g5', 's5', 'b3', 360)]],
  ['G9 a ring completely inside a box and inside a post', [box('b1', [40, 40, 40], [0, 0, 0]), S('s1', R(5, 10, -5, 5)), groove('g1', 's1', 'b1', 360), ...POST, S('s2', R(4, 8, -4, 4)), groove('g2', 's2', 'c1', 90)]],
  ['G10 a lip 0.1 mm short of a face, a ring wall 0.2 mm inside a post wall, a ring wall tangent to a flat face', [box('b1', [40, 40, 20], [0, 0, 0]), S('s1', R(5, 10, -10, 9.9)), groove('g1', 's1', 'b1', 360), ...POST, S('s2', R(8, 14.8, -4, 4)), groove('g2', 's2', 'c1', 360), box('b2', [40, 40, 20], [100, 0, 0]), S('s3', R(8, 19.9, -5, 5), { frame: { origin: [100, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), groove('g3', 's3', 'b2', 90)]],
  ['chain: a refused groove, then a groove, a pocket, a hole, a shell, a move, a combine, a pattern, a mirror on the same part', [box('b1', [40, 40, 20], [0, 0, 0]), S('s1', R(200, 210, 0, 5)), groove('g1', 's1', 'b1', 360), S('s2', R(8, 12, -4, 4)), groove('g2', 's2', 'b1', 360), S('s3', R(0, 5, 0, 5)), pocket('pk1', 's3', 'b1', 3), hole('h1', 'b1', {}), shell('sh1', 'b1', undefined, 2), move('m1', 'b1', [3, 0, 0]), box('b2', [5, 5, 5], [30, 0, 0]), combine('c1', 'union', ['b1', 'b2']), pattern('p1', 'b1', { count: 2, step: [60, 0, 0] }), mirror('x1', 'b1', 'yz')]],
  ['a spin as the operand of another kind', [S('s1', R(3, 8, 0, 12), { plane: 'xz' }), revolve('v1', 's1', 360), hole('h1', 'v1', { diameter: 2, depth: 20 }), box('b1', [20, 20, 10], [0, 0, 6]), combine('c1', 'subtract', ['b1', 'v1']), pattern('p1', 'v1', { count: 3, step: [30, 0, 0] }), mirror('x1', 'v1', 'xz')]],
  ['a groove into a spun frustum, a stepped plate and a tube', [S('s1', [[0, 0], [30, 0], [29, 30], [0, 30]], { plane: 'xz' }), revolve('v1', 's1', 360), S('s2', R(10, 29.5, 5, 25), { plane: 'xz' }), groove('g1', 's2', 'v1', 90), S('s3', [[0, 0], [30, 0], [30, 6], [18, 6], [18, 20], [0, 20]], { plane: 'xz' }), revolve('v2', 's3', 360), S('s4', R(8, 12, 8, 14), { plane: 'xz' }), groove('g2', 's4', 'v2', 360)]],
  ['malformed: a groove with no target, a spin with no angle, a groove with no into', [S('s1', R(5, 9, -4, 4)), { id: 'g1', kind: 'groove', angle: 90 }, { id: 'v1', kind: 'revolve', target: 's1' }, { id: 'g2', kind: 'groove', target: 's1', angle: 90 }, box('b1', [10, 10, 10], [0, 0, 0]), { id: 'g3', kind: 'groove', target: 's1', into: 'b1' }]],
  ['a sphere, a cone and a torus as the part the groove cuts', [sphere('s0', 15, [0, 0, 0]), S('s1', R(5, 9, -3, 3)), groove('g1', 's1', 's0', 360), cone('n0', 12, 20, [60, 0, 0]), S('s2', R(5, 9, -3, 3), { frame: { origin: [60, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), groove('g2', 's2', 'n0', 360), torus('t0', 10, 3, [120, 0, 0]), S('s3', R(8, 11, -2, 2), { frame: { origin: [120, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), groove('g3', 's3', 't0', 360)]],
];
const aimedDocs = aimed.map(([name, features]) => ({ name: `aimed ${name}`, doc: { version: 1, features } }));

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), calls: 0, side: { neg: 0, pos: 0 }, nudge: 0, split: 0,
  noMt: { runs: 0, docs: new Set(), by: {} }, p4: { docs: 0 }, p0: { compared: 0, docs: 0 }, excluded: { docs: 0, kinds: {}, differ: 0, agree: 0, trapRuns: 0, trapDiffer: 0, trapAgree: 0 }, byCorpus: {}, grooveRuns: 0, otherRuns: 0, optsBad: [],
};
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const shape = (s) => String(s).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f|d|pk|pa|mi|u|sph|cyl|ghost|t|v|k|n|w|j|z|g)\d*\b/g, '$1');
function note(a, b) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') {
      bump(tally.built, f.kind);
      if (f.guard?.side === -1) tally.side.neg++; else if (f.guard?.side === 1) tally.side.pos++;
      if (f.guard?.nudgeDeg) tally.nudge++;
    }
    if (f.status === 'refused') { bump(tally.refused, f.kind); tally.sentences.add(shape(f.refusal)); }
  }
  if ((a.result?.features ?? []).some((f) => f.kind === 'groove' && f.status === 'built' && f.measure?.bodies?.length > 1)) tally.split++;
  for (const g of b.guards) bump(tally.guards, g ?? '(none)');
}
/** the options: every run whose last command is a solid.revolve with operation cut carries { budgetS: 45 + ... }, every other run carries none */
function checkOpts(name, cfgName, b, doc) {
  const hasGroove = doc.features.some((f) => f.kind === 'groove');
  for (const o of b.optsLog) {
    const wants = o.last === 'solid.revolve' && o.op === 'cut';
    if (o.opts) {
      tally.grooveRuns++;
      if (!(typeof o.opts.budgetS === 'number' && o.opts.budgetS >= 45 && Object.keys(o.opts).length === 1)) tally.optsBad.push(`${name} [${cfgName}]: ${JSON.stringify(o.opts)}`);
      if (!wants || !hasGroove) tally.optsBad.push(`${name} [${cfgName}]: options on a run that does not end in a groove cut (${o.last})`);
    } else {
      tally.otherRuns++;
      if (wants && hasGroove) tally.optsBad.push(`${name} [${cfgName}]: a groove cut run without options`);
    }
  }
}
async function compareDoc(name, item, cfg, which, extra = {}) {
  const a = await runOrig(which, item, cfg);
  const b = await runPort(RGSET, item, cfg, which, extra);
  // phase 0 words a throw inside the bridge "WASM TRAP", phase 4 (and the layer) "bridge error": a p0 run that hit one is not compared (counted, and shown to really differ)
  if (which === 'p0' && JSON.stringify(a.result ?? a.error).includes('WASM TRAP')) {
    tally.excluded.trapRuns++;
    try { assert.deepStrictEqual(b.result, a.result); tally.excluded.trapAgree++; } catch { tally.excluded.trapDiffer++; }
    return { a, b };
  }
  tally.cases++;
  // NAMED EXCEPTION (owner decision, NOTES Fold 6): with no ctx.mt the original skips ring-misses, G7, G8, G9 and G10 (a fail-open by a missing input); the port falls back to the base's frame and runs them.
  // A run without mt may differ from the original ONLY at the first differing feature, and only where the port refuses a groove with one of those guards, or builds it with the sketch plane nudged (G7, full turn),
  // and the original built it; every feature before it is identical. Everything else must be identical.
  if (!cfg.useMt && !same([b.result, b.error], [a.result, a.error])) {
    const af = a.result?.features ?? []; const bf = b.result?.features ?? [];
    const k = bf.findIndex((x, j) => !same(x, af[j]));
    const refusedBefore = bf.slice(0, Math.max(k, 0)).filter((x) => x.status === 'refused').length;
    const code = bf[k]?.status === 'refused' ? b.guards[refusedBefore] : null;
    const skipped = ['G4', 'G7', 'G8', 'G9', 'G10'];
    const ok = !a.error && !b.error && k >= 0 && bf[k].kind === 'groove' && (af[k]?.status === 'built' || (cfg.fake.failEvery && af[k]?.status === 'refused')) // (with an injected failure the original's run may have been the one that failed)
      && ((bf[k].status === 'refused' && skipped.includes(code)) || (bf[k].status === 'built' && bf[k].guard?.nudgeDeg > 0)
        || (af[k]?.status === bf[k].status && same({ ...bf[k], guard: 0 }, { ...af[k], guard: 0 }))); // (or built the same, only the logged cost features differ: they are computed from the frame now)
    assert.ok(ok, `${name} [${cfg.name}] (${which}): differs from the original beyond the named missing-mt exception`);
    tally.noMt.runs++; tally.noMt.docs.add(name); bump(tally.noMt.by, bf[k].status === 'refused' && af[k]?.status !== 'refused' ? code : bf[k].status === 'built' && bf[k].guard?.nudgeDeg > 0 && af[k]?.status === 'built' && !same(bf[k].commands, af[k].commands) ? 'G7 nudge' : 'only the logged guard info');
    return { a, b };
  }
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}] (${which}): thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}] (${which}): translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}] (${which}): engine call sequence differs`);
  if (which === 'p4') assert.deepStrictEqual(b.soups, a.soups, `${name} [${cfg.name}]: ctx.soups differs`);
  checkOpts(name, cfg.name, b, item.doc);
  tally.identical++; tally.calls += a.log.length;
  if (which === 'p4') { if (a.error) { tally.thrown++; bump((tally.errors ??= {}), a.error); } note(a, b); }
  return { a, b };
}
async function runCorpus(label, items) {
  tally.byCorpus[label] = { docs: items.length, p0: 0 };
  for (const item of items) {
    tally.p4.docs++;
    for (const cfg of CONFIGS) await compareDoc(item.name, item, cfg, 'p4');
    // the phase 0 original: where phase 0 and phase 4 plan the other features the same way (and the bridge does not throw)
    const diff = differences(item.doc);
    if (diff.length) {
      tally.excluded.docs++;
      for (const d of new Set(diff)) bump(tally.excluded.kinds, d);
      const a = await runOrig('p0', item, CONFIGS[0]); const b = await runPort(RGSET, item, CONFIGS[0], 'p0');
      try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.error, a.error); tally.excluded.agree++; } catch { tally.excluded.differ++; }
      continue;
    }
    tally.p0.docs++; tally.byCorpus[label].p0++;
    for (const cfg of CONFIGS.filter((c) => !c.throws)) { await compareDoc(item.name, item, cfg, 'p0'); tally.p0.compared++; }
  }
}

test('the set exists, is a member of nothing else by accident, and the default stays base', () => {
  assert.equal(RGSET.planners, 'revolve-groove');
  assert.equal(port.tr.createTranslator().planners, 'base');
  assert.ok(Object.keys(port.tr.PROFILES).includes('revolve-groove'));
  assert.deepStrictEqual(port.rg.RG_KINDS, ['revolve', 'groove']);
  assert.deepStrictEqual(port.rg.RG_CROSS_KIND_GUARDS, ['RG-CHAIN']);
  assert.equal(port.g.COST_BUDGET_S, orig.RG.COST_BUDGET_S);
  assert.equal(port.rg.RG_BUDGET_S, 45);
});

test('(a) every case of the group that turns into a ModelDoc', { timeout: 3_000_000 }, async () => {
  assert.ok(caseDocs.length > 900, `only ${caseDocs.length} case docs`);
  await runCorpus('cases', caseDocs);
});
test('(b) aimed docs, the base hand docs, 160 base-generated docs and 600 generated docs', { timeout: 3_000_000 }, async () => {
  await runCorpus('aimed', aimedDocs);
  await runCorpus('hand', hand);
  await runCorpus('base-generated', baseGen);
  await runCorpus('generated', generated);
});

test('the time limit: a groove run past its budget is refused with the plain sentence and G-BUDGET; the budget is 45 s plus 1.5 x the last run; a host that ignores it changes nothing', { timeout: 600_000 }, async () => {
  const feats = [box('b1', [60, 60, 20], [30, 0, 0]), S('s1', R(-46, -42, -4, 4)), groove('g1', 's1', 'b1', 360)];
  const item = { doc: { version: 1, features: feats } };
  // a run that ends in a groove cut costs 50 s of CPU: past the 45 s of the first groove (the fake reports no CPU for the runs before it, so the last run was 0 s)
  const cfg = { name: 'cpu', fake: { boxBool: true, rgModel: true, cpuMs: (cmds) => (cmds[cmds.length - 1].command === 'solid.revolve' ? 50000 : 10) }, useMt: true };
  const b = await runPort(RGSET, item, cfg, 'p4', {}, true);
  const g1 = b.result.features.find((f) => f.id === 'g1');
  assert.equal(g1.status, 'refused');
  assert.equal(g1.refusal, port.rg.rgBudgetSentence('g1'));
  assert.match(g1.refusal, /took longer than 45 seconds to calculate, so it was stopped/);
  assert.ok(orig.RG.oneSentence(g1.refusal) && !orig.RG.JARGON.test(g1.refusal), g1.refusal);
  assert.equal(b.guards.filter(Boolean)[0], 'G-BUDGET');
  // a refused groove leaves its handle pointing at itself, as any refused groove does
  const after = await runPort(RGSET, { doc: { version: 1, features: [...feats, hole('h1', 'b1', {})] } }, cfg, 'p4', {}, true);
  assert.equal(after.result.features.find((f) => f.id === 'h1').status, 'refused');
  // the budget of a run is 45 s plus 1.5 x the CPU of the last run: after a 10 s run a groove of 55 s fits (60 s), one of 70 s does not
  for (const [cost, built] of [[55000, true], [70000, false]]) {
    const fake = makeFake({ boxBool: true, rgModel: true, cpuMs: (cmds) => (cmds[cmds.length - 1].command === 'solid.revolve' ? cost : 10000) });
    const seen = [];
    const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, skipFilletChain: true, mt, runSC: (c, o) => { seen.push(o?.budgetS ?? null); return fake.runSC(c, o); }, topologyOf: fake.topologyOf, soups: {} };
    const r = await RGSET.translateDoc({ version: 1, features: feats }, ctx);
    assert.equal(r.features.find((f) => f.id === 'g1').status, built ? 'built' : 'refused', `a groove run of ${cost} ms`);
    assert.deepStrictEqual(seen.filter((s) => s !== null), [60]);
  }
  // a host that ignores the option (the fake called without it) is not stopped: nothing is refused for time and the output is the original's
  for (const item2 of aimedDocs.slice(0, 8)) await compareDoc(`${item2.name} (host ignores budgetS)`, item2, CONFIGS[0], 'p4');
});

test('the guards are able to fail: switching one off (ctx.guardsOff, the original\'s RG_OFF) changes the result of the doc it guards', async () => {
  const docs = {
    G9: [box('b1', [40, 40, 40], [0, 0, 0]), S('s1', R(5, 10, -5, 5)), groove('g1', 's1', 'b1', 360)],
    G10: [box('b1', [40, 40, 20], [0, 0, 0]), S('s1', R(5, 10, -10, 9.9)), groove('g1', 's1', 'b1', 360)],
    G7: [box('b1', [40, 40, 20], [0, 0, 10]), S('s1', R(8, 14, 2, 10), { plane: 'xz' }), groove('g1', 's1', 'b1', 90)],
    G8: [...POST, S('s1', [[10, 0], [12, 0]], { shape: 'circle' }), groove('g1', 's1', 'c1', 360)],
    G5: [box('b1', [20, 20, 10], [30, 0, 0]), S('s1', R(-26, -22, -4, 4)), groove('g1', 's1', 'b1', 40)],
    G4: [S('s1', [[5, 0], [15, 10], [15, 0], [5, 10]]), revolve('v1', 's1', 90)],
  };
  for (const [g, features] of Object.entries(docs)) {
    const item = { doc: { version: 1, features } };
    const on = await runPort(RGSET, item, CONFIGS[0]);
    const off = await runPort(RGSET, item, CONFIGS[0], 'p4', { guardsOff: [g] });
    assert.ok(on.guards.includes(g), `${g} fires on its doc: ${JSON.stringify(on.guards)}`);
    assert.notDeepStrictEqual(off.result, on.result, `${g} off changes nothing`);
    assert.ok(!off.guards.includes(g));
  }
});

test('the pure guard and the sentences equal the original on random inputs', () => {
  const rnd = (k) => { let a = k; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; };
  const r = rnd(17);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const q = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 8) / 8;
  for (const k of ['MIN_TURN', 'MAX_SPIN', 'AXIS_TOL', 'GRAZE_MM', 'NUDGE_DEG', 'COST_BUDGET_S', 'COST_SUPPORT_S']) assert.equal(port.g[k], orig.RG[k], k);
  assert.deepStrictEqual(port.g.STARTER, orig.RG.STARTER);
  assert.equal(String(port.g.JARGON), String(orig.RG.JARGON));
  // sentences: scriptSentence and plainRefusal on every text the engine and the translator make
  const texts = ['', undefined, null, 'solid.revolve: no body named b_x came back', 'solidcraft ran the commands but no body named b_a, b_b came back', 'crosses the revolve axis', 'solid.revolve: came out empty', 'more than 0 and at most 360', 'Cut: failed', 'fallback used', 'implausible volume',
    'coincident faces', 'no result', 'not reliable', 'WASM TRAP: unreachable', 'trap', 'unreachable executed', 'out of memory', 'fake: boolean failed', 'bridge error: fake', 'x: y', 'TIME BUDGET: the run did not finish',
    'spin(): the angle is how far the sketch turns, and 0 degrees turns it nowhere', 'spin(): the angle is how far the sketch turns, and 800 degrees is more than 720', 'groove(): the angle is how far the sketch turns, more than 0 and at most 360 degrees -- got 400. A negative angle', 'something else entirely'];
  for (const t of texts) assert.equal(port.g.scriptSentence(t), orig.RG.scriptSentence(t), `scriptSentence ${t}`);
  for (const kind of ['revolve', 'groove', 'box', 'pocket']) for (const t of [...texts, { plain: 'a plain sentence.' }, { plain: '' }]) {
    const f = { id: 'f1', kind };
    assert.equal(port.g.plainRefusal(f, t), orig.RG.plainRefusal(f, t), `plainRefusal ${kind} / ${JSON.stringify(t)}`);
  }
  for (const s of [...texts, 'a. B', 'one sentence here.', 'x -- y', 'Z! Y']) { assert.equal(port.g.oneSentence(s), orig.RG.oneSentence(s)); }
  // geometry: random outlines, frames, measures
  const outlines = () => {
    const k = pick(['rect', 'rect', 'tri', 'pent', 'circle', 'bow', 'line', 'rounded', 'dup']);
    const sd = r() < 0.2 ? -1 : 1; const u0 = q(0, 25); const w = q(0.5, 12); const v0 = q(-8, 15); const h = q(1, 20);
    const base = { id: 's', kind: 'sketch', plane: pick(['xy', 'xz', 'yz']), offset: pick([0, 0, 2.5]) };
    if (k === 'rect') return { ...base, points: R(sd * u0, sd * (u0 + w), v0, v0 + h) };
    if (k === 'tri') return { ...base, points: [[sd * u0, v0], [sd * (u0 + w), v0], [sd * u0, v0 + h]] };
    if (k === 'pent') return { ...base, points: [[sd * u0, v0], [sd * (u0 + w), v0], [sd * (u0 + 1.4 * w), v0 + h / 2], [sd * (u0 + w), v0 + h], [sd * u0, v0 + h]] };
    if (k === 'circle') return { ...base, shape: 'circle', points: [[sd * u0, v0], [sd * (u0 + w), v0]] };
    if (k === 'bow') return { ...base, points: [[5, 0], [15, 10], [15, 0], [5, 10]] };
    if (k === 'line') return { ...base, points: [[1, 1], [2, 2], [3, 3]] };
    if (k === 'rounded') return { ...base, points: R(sd * u0, sd * (u0 + w), v0, v0 + h), rounds: { 1: Math.min(w, h) / 3 } };
    return { ...base, points: [[1, 1], [1, 1], [5, 5], [1, 5]] };
  };
  const frameOf = (sk) => mt.sketchFrameOf(sk);
  const meass = () => {
    const kind = pick(['box', 'cyl', 'any']);
    const c = [q(-10, 10), q(-10, 10), q(-10, 10)]; const d = [q(10, 50), q(10, 50), q(10, 50)];
    const bbox = [c[0] - d[0] / 2, c[1] - d[1] / 2, c[2] - d[2] / 2, c[0] + d[0] / 2, c[1] + d[1] / 2, c[2] + d[2] / 2];
    if (kind === 'box') return { volume: d[0] * d[1] * d[2], faces: 6, bbox, faceTypes: { plane: 6 }, bodies: ['b'], kernelFaces: 6, curved: false, com: c };
    if (kind === 'cyl') { const R2 = Math.min(d[0], d[1]) / 2; const bb = [c[0] - R2, c[1] - R2, c[2] - d[2] / 2, c[0] + R2, c[1] + R2, c[2] + d[2] / 2]; return { volume: Math.PI * R2 * R2 * d[2], faces: 4, bbox: bb, faceTypes: { plane: 2, cylinder: 2 }, bodies: ['b'], kernelFaces: 4, curved: true, com: c }; }
    return { volume: d[0] * d[1] * d[2] * 0.7, faces: 9, bbox, faceTypes: r() < 0.5 ? { plane: 8, cylinder: 1 } : { plane: 9 }, bodies: r() < 0.2 ? ['b', 'b (1)'] : ['b'], kernelFaces: 9, curved: false, com: c };
  };
  let reached = 0;
  for (let i = 0; i < 1500; i++) {
    const sk = outlines();
    const f = { id: 'g1', kind: pick(['groove', 'revolve']), target: 's', into: 'b', angle: pick([360, 90, 180, 45, 0.5, -90, 720, 0]) };
    assert.deepStrictEqual(port.g.profileProblem(f, sk, arc), orig.RG.profileProblem(f, sk, arc), `profileProblem ${JSON.stringify(sk)}`);
    assert.deepStrictEqual(port.g.profileProblem(f, undefined, arc), orig.RG.profileProblem(f, undefined, arc));
    const pa = orig.RG.profileInfo(sk, arc); const pb = port.g.profileInfo(sk, arc);
    if (!pa.ok) { assert.equal(pb.ok, false); assert.equal(pb.why, pa.why); continue; }
    assert.deepStrictEqual(norm(pb), norm(pa), 'profileInfo');
    assert.equal(port.g.sideOf(pb), orig.RG.sideOf(pa)); assert.equal(port.g.kernelAngle(f, orig.RG.sideOf(pa)), orig.RG.kernelAngle(f, orig.RG.sideOf(pa)));
    const fr = frameOf(sk); const meas = meass();
    assert.equal(port.g.ringMisses(pb, fr, meas.bbox), orig.RG.ringMisses(pa, fr, meas.bbox));
    assert.equal(port.g.ringSealed(pb, fr, meas), orig.RG.ringSealed(pa, fr, meas));
    assert.deepStrictEqual(port.g.certifiedShape(meas), orig.RG.certifiedShape(meas));
    assert.deepStrictEqual(port.g.profilePlaneOnFlatFace(fr, meas.bbox, meas.faceTypes), orig.RG.profilePlaneOnFlatFace(fr, meas.bbox, meas.faceTypes));
    const cmds = r() < 0.5 ? [{ command: 'solid.box', params: { length: 20, width: 20, height: 10, center: [0, 0, 0] } }, { command: 'solid.cylinder', params: { radius: 7, height: 12, base: [1, 2, 3], axis: 'Z' } }] : [{ command: 'solid.revolve', params: { angle: -90, sketch: 'x' } }];
    for (const s of [0.25, 0.5, 2]) assert.deepStrictEqual(norm(port.g.grazing(pb, fr, meas, s, cmds)), norm(orig.RG.grazing(pa, fr, meas, s, cmds)), `grazing ${s}`);
    assert.deepStrictEqual(norm(port.g.grazing(pb, fr, meas, 0.25, null)), norm(orig.RG.grazing(pa, fr, meas, 0.25, null)));
    const cfa = orig.RG.costFeatures(pa, sk, arc, fr, meas, f.angle); const cfb = port.g.costFeatures(pb, sk, arc, fr, meas, f.angle);
    assert.deepStrictEqual(norm(cfb), norm(cfa), 'costFeatures');
    assert.equal(port.g.costRefusal(cfb), orig.RG.costRefusal(cfa));
    assert.deepStrictEqual(norm(port.g.toolSurfaces(sk, arc)), norm(orig.RG.toolSurfaces(sk, arc)));
    assert.deepStrictEqual(port.g.candidatePlanes(cmds, i % 3), orig.RG.candidatePlanes(cmds, i % 3));
    const v = [q(-5, 5), q(-5, 5), q(-5, 5)]; const k = [q(0.1, 1), q(0, 1), q(-1, 1)];
    assert.deepStrictEqual(port.g.rotateAbout(v, k, 17), orig.RG.rotateAbout(v, k, 17));
    if (orig.RG.costRefusal(cfa)) reached++;
  }
  assert.equal(port.g.costRefusal(null), orig.RG.costRefusal(null));
  assert.ok(reached > 50, `${reached} random profiles reached the cost rule`);
  // the chain
  for (const f of [{ id: 'g1', kind: 'groove', into: 'b' }, { id: 'v1', kind: 'revolve' }, { id: 'p', kind: 'pocket', into: 'b' }, { id: 'g2', kind: 'groove' }]) {
    const sa = { head: { b: 'g0' } }; const sb = { head: { b: 'g0' } };
    orig.RG.onRefused(f, sa); port.g.onRefused(f, sb);
    assert.deepStrictEqual(sb, sa);
  }
});

test('the aggregate counts every piece of a split part and sums the surface area (G2)', () => {
  const body = (name, v, a) => ({ name, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, volume_mm3: v, area_mm2: a, faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [0.5, 0.5, 0.5] });
  const res = { ok: true, measure: { bodies: [body('b_g', 3, 10), body('b_g (1)', 2, 5), body('b_gx', 1, 1), body('other', 9, 9)] } };
  const m = port.rg.aggregateRG(res, ['b_g']);
  assert.deepStrictEqual(m.bodies, ['b_g', 'b_g (1)']);
  assert.equal(m.volume, 5); assert.equal(m.area, 15);
  assert.equal(port.rg.aggregateRG(res, ['zz']), null);
});

test('summary', () => {
  const reached = Object.keys(tally.guards).filter((g) => g !== '(none)').sort();
  const ALL = ['G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'RG-CHAIN'];
  const missing = ALL.filter((g) => !reached.includes(g));
  console.log(`# revolve-groove differential: ${tally.cases} comparisons (${tally.p4.docs} docs x ${CONFIGS.length} configs against the p4 original, ${tally.p0.docs} docs in the p0 equality set x ${CONFIGS.filter((c) => !c.throws).length} configs against the p0 original, plus the host-ignores-budget runs), ${tally.identical} identical, ${tally.thrown} thrown errors (the same on both), ${tally.calls} engine calls compared
# by corpus: ${JSON.stringify(tally.byCorpus)}; cases skipped (no ModelDoc): ${caseSkipped.length}
# built (p4 side): ${JSON.stringify(tally.built)}; groove/spin built on the -u side ${tally.side.neg}, +u side ${tally.side.pos}, with the sketch plane nudged ${tally.nudge}, a groove that left several pieces ${tally.split}
# refused (p4 side): ${JSON.stringify(tally.refused)}
# guard codes reached (the port's): ${JSON.stringify(tally.guards)}
# NOT reached by any doc under the fake: ${JSON.stringify(missing)} (G-BUDGET is reached by the time-limit test)
# runs with { budgetS }: ${tally.grooveRuns}, runs without: ${tally.otherRuns}
# distinct refusal sentences (numbers and ids folded): ${tally.sentences.size}
# p0-excluded docs (phase0 and phase 4 differ on a feature other than a spin / groove): ${tally.excluded.docs} ${JSON.stringify(tally.excluded.kinds)}; of them the port differs from the p0 original on ${tally.excluded.differ}, agrees on ${tally.excluded.agree}
# NAMED EXCEPTION, no ctx.mt (the original skips G4 ring-misses / G7 / G8 / G9 / G10; the port runs them): ${tally.noMt.runs} runs of ${tally.noMt.docs.size} docs, by the guard that now refuses: ${JSON.stringify(tally.noMt.by)}
# p0 runs not compared because the bridge threw (WASM TRAP vs bridge error wording): ${tally.excluded.trapRuns}; the port differs on ${tally.excluded.trapDiffer}, agrees on ${tally.excluded.trapAgree}`);
  assert.ok(tally.noMt.runs > 0, 'the missing-mt exception never fired');
  assert.ok(tally.identical + tally.noMt.runs === tally.cases);
  assert.deepStrictEqual(tally.optsBad, []);
  assert.deepStrictEqual(missing, [], 'a guard of the group was never reached');
  assert.ok(tally.side.neg > 10 && tally.nudge > 0 && tally.split > 0, 'the -u side, the nudge and the split are all reached');
  assert.ok(tally.p0.docs > 600, `the p0 equality set shrank: ${tally.p0.docs}`);
  assert.ok(tally.excluded.differ > 0, 'no excluded doc really differs: the exclusion rule is vacuous');
  assert.ok(tally.excluded.trapRuns === 0 || tally.excluded.trapDiffer > 0, 'the bridge-throw exclusion is vacuous');
  assert.ok(N_THEMES > 0);
});
