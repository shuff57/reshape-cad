// DIFFERENTIAL TEST for the holes fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/holes4-translate.mjs, ROUND 4, with
// holes4-volume.mjs, holes4-sc.mjs, shell-draft-translate.mjs and phase0/translate.mjs, all untouched) against the compiled TypeScript port in 'holes'
// mode (createTranslator({ planners: 'holes' })). Both are fed the same ModelDocs through the same deterministic FAKE engine (test/fake-engine.mjs, no
// kernel, no wasm) and must produce IDENTICAL output: the translateDoc result (features, commands, spentS), the ordered list of engine calls (the
// guards' probe cuts included, with the { budgetS } option) and a thrown error.
//
// WHAT "IDENTICAL" CAN MEAN HERE. The original is phase0/translate.mjs with the hole planner replaced; the layer's base is the phase 4 translator. Where
// phase0 and phase 4 plan a non-hole feature differently (a shell's opened face, a fillet's edge, a draft's face, a constrained-sketch (soup) pull) the
// two cannot be equal, and a doc that contains such a feature is EXCLUDED from the equality requirement (counted, with the kind that differs, and shown
// to really differ). NOTES.md has the kind-by-kind table. Equality is required on every other doc.
//
// The original's result has no `_state`; the port's does (the base translator's public surface). `_state` is removed before the comparison.
// This shows the port equals the original on the inputs below. It does NOT show the built solids are right: the fake has no geometry kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs } from './docs.mjs';
import { holeDoc } from './holes-docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);

// the original reads these from the environment; the port has the constants. Make sure the originals run with their defaults.
assert.equal(process.env.H4_BUDGET_S, undefined, 'H4_BUDGET_S is set: the original would use another budget than the port');
assert.equal(process.env.H4_DOC_BUDGET_S, undefined, 'H4_DOC_BUDGET_S is set');
// holes4-sc.mjs makes a temp dir when it is imported; keep it out of the repo and remove it afterwards
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-holes-'));
process.env.H4_TMP = SCRATCH;
test.after(() => { fs.rmSync(SCRATCH, { recursive: true, force: true }); });

const orig = {
  h4: await imp(path.join(contract, 'holes4-translate.mjs')),
  vol: await imp(path.join(contract, 'holes4-volume.mjs')),
  sc: await imp(path.join(contract, 'holes4-sc.mjs')),
  p4: await imp(path.join(root, 'docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs')),
  ep: await imp(path.join(contract, 'translate-ep.mjs')),
};
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), h: await dist('holes.js'), hv: await dist('holes-volume.js'), t: await dist('translate.js') };
const HOLES = port.tr.createTranslator({ planners: 'holes' });
const EP = port.tr.createTranslator({ planners: 'extrude-pocket' });
const BASE = port.tr.createTranslator();
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- corpus (a): every case of the group (holes4-cases.mjs is the round-4 set and contains holes3-cases.mjs; holes-cases.mjs is round 1) ---------------
const caseFiles = ['holes4-cases.mjs', 'holes3-cases.mjs', 'holes-cases.mjs'];
const caseDocs = []; const caseSkipped = []; const caseSeen = new Set();
for (const file of caseFiles) {
  const { CASES } = await imp(path.join(contract, file));
  for (const c of CASES) {
    const key = `${c.id}\u0000${c.script}`;
    if (caseSeen.has(key)) continue;
    caseSeen.add(key);
    const r = runScript(c.script);
    if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message, file]); continue; }
    caseDocs.push([`case ${c.id}`, solveDoc(r.doc), file]);
  }
}
// ---- corpus (b): generated hole docs, and the base hand docs through the group translator ----------------------------------------------------
const N_GEN = 300;
const generated = Array.from({ length: N_GEN }, (_, i) => [`hole seed ${i}`, holeDoc(i)]);
const hand = handDocs();

// ---- where phase0 and phase 4 plan a non-hole feature differently (see NOTES.md) -------------------------------------------------------------
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'shell' && f.open) out.push('shell with an open face (name resolution)');
    if (f.kind === 'fillet') out.push('fillet (edge name resolution)');
    if (f.kind === 'draft' && f.face && !f.whole) out.push('draft with a face (name resolution)');
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch (soup)`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch (soup)');
  }
  return out;
}

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const cutCount = (cmds) => cmds.filter((c) => c.command === 'solid.hole' || (c.command === 'solid.cylinder' && c.params?.operation === 'cut')).length;
const CONFIGS = [
  { name: 'holeModel+boxBool, mt', fake: { holeModel: true, boxBool: true }, useMt: true },
  { name: 'default fake, mt', fake: {}, useMt: true },
  { name: 'holeModel+boxBool, every 5th call fails, no mt', fake: { holeModel: true, boxBool: true, failEvery: 5 }, useMt: false },
  { name: 'holeModel+boxBool, cpu budget (20 s per cut command)', fake: { holeModel: true, boxBool: true, cpuMs: (cmds) => 50 + 20000 * cutCount(cmds) }, useMt: true },
];

const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
async function runOrig(doc, cfg, off = []) {
  const fake = makeFake({ sync: true, ...cfg.fake });
  const ctx = { arc, runSC: fake.runSC, resolveAt: () => null, ...(cfg.useMt ? { mt } : {}) };
  let result; let error = null;
  try { result = orig.h4.translateDocGuarded(structuredClone(doc), ctx, { off }); } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log };
}
async function runPort(tr, doc, cfg, off = [], asyncFake = false) {
  const fake = makeFake({ sync: !asyncFake, ...cfg.fake });
  const soups = {};
  const ctx = { arc, runSC: fake.runSC, topologyOf: fake.topologyOf, soups, ...(cfg.useMt ? { mt } : {}), ...(off.length ? { guardsOff: off } : {}) };
  let result; let error = null;
  try { const { _state, ...rest } = await tr.translateDoc(structuredClone(doc), ctx); result = rest; assert.ok(_state); } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, soups };
}

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), runSCcalls: 0, budgetOpts: 0, timedOut: 0, spent: 0,
  inSet: { cases: 0, docs: 0 }, excluded: { docs: 0, kinds: {}, differ: 0, agree: 0, byCorpus: { cases: 0, generated: 0, hand: 0 } }, offDiffer: {},
};
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const shape = (s) => s.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f)\d*\b/g, '$1');

function note(a) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'refused') { bump(tally.refused, f.kind); if (f.guard) bump(tally.guards, f.guard); tally.sentences.add(shape(f.refusal)); }
    if (f.cpuMs !== undefined) tally.timedOut++;
  }
  tally.spent += a.result?.spentS ?? 0;
  for (const l of a.log) if (l.length === 3) tally.budgetOpts++;
}

// Named exception (owner-approved): the original's closed-hollow sentence prints "undefined"; the port words it without a reason. Everything else about the row (guard, status) must still match.
const closedText = (id) => `${id} (hollow): a hollow with no open side is not built here, so ${id} is shown without it -- add open:'top' (or 'bottom', 'front', 'back', 'left', 'right') to leave one side open.`;
function closedHollowException(a) {
  for (const f of a.result?.features ?? []) {
    if (f.guard !== 'G-CLOSED') continue;
    assert.ok(/and undefined, so/.test(f.refusal), 'G-CLOSED original sentence changed shape');
    f.refusal = closedText(f.id);
    tally.closedExceptions = (tally.closedExceptions ?? 0) + 1;
  }
}

async function compareDoc(name, doc, cfg, off = []) {
  const a = await runOrig(doc, cfg, off);
  const b = await runPort(HOLES, doc, cfg, off);
  tally.cases++;
  closedHollowException(a);
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  assert.deepStrictEqual(b.soups, {}, `${name}: a soup was mapped in an in-set doc`);
  tally.identical++; tally.runSCcalls += a.log.length;
  if (a.error) tally.thrown++;
  note(a);
  return { a, b };
}

test('createTranslator: the holes set exists, the default stays base, unknown sets throw', () => {
  assert.equal(HOLES.planners, 'holes');
  assert.equal(BASE.planners, 'base');
  assert.throws(() => port.tr.createTranslator({ planners: 'nope' }), /unknown planner set/);
  assert.throws(() => port.tr.createTranslator({ planners: ['holes', 'holes'] }), /listed twice/);
  assert.throws(() => port.tr.createTranslator({ planners: [] }), /empty list/);
  assert.deepStrictEqual(HOLES.FEATURE_KINDS, orig.p4.FEATURE_KINDS);
  assert.deepStrictEqual(port.h.ALL_GUARDS, orig.h4.ALL_GUARDS);
  // planFeature cannot plan a hole synchronously under this set (the guards cut probe pieces on the engine): it must not fall back to the unguarded planner
  assert.throws(() => HOLES.planFeature({ id: 'h1', kind: 'hole', target: 'b1', diameter: 2, depth: 5, center: [0, 0, 0], axis: 'z' }, { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} }, { arc, runSC: () => ({ ok: true }), resolve: () => null }), /plans a hole asynchronously/);
});

test('base and extrude-pocket are untouched: base mode is still exactly the phase 4 translator on every corpus doc', async () => {
  const cfg = CONFIGS[0];
  let n = 0;
  for (const [name, doc] of [...hand, ...generated.slice(0, 60)]) {
    const fa = makeFake({ ...cfg.fake }); const fb = makeFake({ ...cfg.fake });
    const ca = { arc, mt, runSC: fa.runSC, topologyOf: fa.topologyOf, resolveAt: () => null };
    const cb = { arc, mt, runSC: fb.runSC, topologyOf: fb.topologyOf, soups: {} };
    let ra, rb, ea = null, eb = null;
    try { ra = await orig.p4.translateDoc(structuredClone(doc), ca); } catch (e) { ea = errOf(e); }
    try { rb = await BASE.translateDoc(structuredClone(doc), cb); } catch (e) { eb = errOf(e); }
    assert.deepStrictEqual(eb, ea, name);
    assert.deepStrictEqual(rb?.features, ra?.features, name);
    assert.deepStrictEqual(fb.log, fa.log, name);
    n++;
  }
  assert.ok(n > 100);
});

test('(a) every case of the group that turns into a ModelDoc: identical where phase0 and phase 4 plan every non-hole feature the same (all configs)', async () => {
  assert.ok(caseDocs.length >= 330, `only ${caseDocs.length} case docs (${caseSkipped.length} scripts failed to run)`);
  for (const [name, doc] of caseDocs) {
    const diff = differences(doc);
    if (diff.length) {
      tally.excluded.docs++; tally.excluded.byCorpus.cases++;
      for (const d of new Set(diff)) bump(tally.excluded.kinds, d);
      // the exclusion is real: record whether the two translators nevertheless agree, and make sure the port at least runs
      const a = await runOrig(doc, CONFIGS[0]); const b = await runPort(HOLES, doc, CONFIGS[0]);
      try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.error, a.error); tally.excluded.agree++; } catch { tally.excluded.differ++; }
      continue;
    }
    tally.inSet.docs++;
    for (const cfg of CONFIGS) { await compareDoc(name, doc, cfg); tally.inSet.cases++; }
  }
});

test('(b) generated hole docs (through, blind, counterbore, countersink, patterns, near edges, wider than the part, tangent, sealed, several bodies, after shell / fillet / combine, curved hosts, sequences, malformed)', async () => {
  assert.ok(generated.length >= 200);
  let inSet = 0; let skipped = 0;
  for (const [name, doc] of generated) {
    if (differences(doc).length) { skipped++; tally.excluded.docs++; tally.excluded.byCorpus.generated++; for (const d of new Set(differences(doc))) bump(tally.excluded.kinds, d); continue; }
    inSet++;
    for (const cfg of CONFIGS) { await compareDoc(name, doc, cfg); tally.inSet.cases++; }
  }
  tally.inSet.docs += inSet;
  tally.generated = { docs: generated.length, inSet, skipped };
  assert.ok(inSet >= 200, `only ${inSet} generated hole docs are in the equality set`);
});

test('the base hand docs through the holes translator (in-set ones identical)', async () => {
  let n = 0;
  for (const [name, doc] of hand) {
    if (differences(doc).length) { tally.excluded.docs++; tally.excluded.byCorpus.hand++; for (const d of new Set(differences(doc))) bump(tally.excluded.kinds, d); continue; }
    for (const cfg of CONFIGS.slice(0, 3)) await compareDoc(`hand ${name}`, doc, cfg);
    n++;
  }
  tally.hand = { docs: hand.length, inSet: n };
  assert.ok(n > 25, `only ${n} hand docs in the set`);
});

test('the port gives the same result with an ASYNC engine as with a synchronous one (the original is synchronous)', async () => {
  let n = 0;
  for (const [name, doc] of [...generated.slice(0, 90)]) {
    if (differences(doc).length) continue;
    for (const cfg of [CONFIGS[0], CONFIGS[3]]) {
      const s = await runPort(HOLES, doc, cfg); const a = await runPort(HOLES, doc, cfg, [], true);
      assert.deepStrictEqual(a.result, s.result, name); assert.deepStrictEqual(a.error, s.error, name); assert.deepStrictEqual(a.log, s.log, name);
      n++;
    }
  }
  assert.ok(n > 100);
});

test('each guard switched OFF (the group\'s negative-control mode) is translated identically, and the switch really changes results', async () => {
  const pool = [...caseDocs.map(([n, d]) => [n, d]), ...generated].filter(([, d]) => !differences(d).length);
  const cfg = CONFIGS[3];
  // per guard: the docs where the guard fires with all guards on, plus a fixed sample of others
  const onRuns = [];
  for (const [name, doc] of pool) onRuns.push([name, doc, (await runOrig(doc, cfg)).result]);
  for (const g of orig.h4.ALL_GUARDS) {
    const fired = onRuns.filter(([, , r]) => r?.features.some((f) => f.guard === g)).slice(0, 25);
    const others = onRuns.filter((_, i) => i % 37 === 0).slice(0, 8);
    let differs = 0;
    for (const [name, doc, on] of [...fired, ...others]) {
      const { a, b } = await compareDoc(`${name} [off ${g}]`, doc, cfg, [g]);
      try { assert.deepStrictEqual(a.result, on); } catch { differs++; }
    }
    tally.offDiffer[g] = { fired: fired.length, differs };
  }
  const silent = Object.entries(tally.offDiffer).filter(([, v]) => v.fired > 0 && v.differs === 0).map(([g]) => g);
  assert.deepStrictEqual(silent, [], `switching these guards off changed nothing on the docs where they fire: ${silent}`);
});

test('coverage: the corpus reaches the group paths (not a vacuous pass)', () => {
  const must = ['G-BODIES', 'G-SHELLS', 'G-NOOP', 'G-TOP', 'G-CORNERS', 'G-CROSS', 'G-TORUS', 'G-TANGENT', 'G-RECESS', 'G-CSBAND', 'G-BUDGET', 'G-REVOLVE', 'G-CURVED', 'G-WIDE', 'G-CSOVERLAP', 'G-CSEDGE', 'G-TINY', 'G-CSFLAT', 'G-NEST', 'G-RECESSMIN', 'G-ENGINE', 'translator-error', 'dependency', 'G-CLOSED'];
  const missing = must.filter((g) => !tally.guards[g]);
  tally.guardsNotReached = missing;
  assert.deepStrictEqual(missing, [], `guards that never fired in the corpus: ${missing}`);
  assert.ok((tally.built.hole ?? 0) > 400, `built holes ${tally.built.hole}`);
  assert.ok((tally.refused.hole ?? 0) > 400, `refused holes ${tally.refused.hole}`);
  assert.ok(tally.budgetOpts > 100 && tally.timedOut > 10, `budget options ${tally.budgetOpts}, time-outs ${tally.timedOut}`);
  assert.ok(tally.excluded.differ > 0, 'no excluded doc really differs: the exclusion rule is vacuous');
});

// ---- the pure guards, no engine at all: original .mjs against the port, same inputs ------------------------------------------------------------
function attempt(fn) { try { return { v: fn() }; } catch (e) { return { thrown: errOf(e) }; } }

test('constants and sentence builders agree (every SENTENCE function, on varied arguments)', () => {
  for (const k of ['CS_MARGIN', 'RECESS_TOL', 'MIN_ACROSS', 'CS_MAX_ANGLE']) assert.equal(port.h[k], orig.h4[k], k);
  assert.deepStrictEqual(port.h.COVER_TOL, orig.h4.COVER_TOL); assert.deepStrictEqual(port.h.CB_MIN, orig.h4.CB_MIN); assert.deepStrictEqual(port.h.CS_MIN, orig.h4.CS_MIN);
  assert.equal(port.h.BUDGET_S, orig.sc.BUDGET_S); assert.equal(port.h.DOC_BUDGET_S, orig.sc.DOC_BUDGET_S);
  assert.deepStrictEqual(port.h.AXI, orig.h4.AXI);
  assert.deepStrictEqual(Object.keys(port.h.SENTENCE), Object.keys(orig.h4.SENTENCE));
  const fs_ = [{ id: 'h1', axis: 'x', diameter: 4 }, { id: 'hh2', axis: 'z', diameter: 2.123456789 }, { id: 'h3', diameter: 0.0005 }];
  const argSets = [[], ['counterbore'], ['countersink', 'x'], ['hole', 'sibling'], ['recess', 'earlier'], [3, 4], [2, 5, 'the part'], [7.77777, 1, 'cyl', 'fix it'], ['h9', 'h8'], [{ id: 'h2' }], [1.5, 2.25]];
  let n = 0;
  for (const key of Object.keys(orig.h4.SENTENCE)) for (const f of fs_) for (const a of argSets) {
    const x = attempt(() => orig.h4.SENTENCE[key](f, ...a)); const y = attempt(() => port.h.SENTENCE[key](f, ...a));
    assert.deepStrictEqual(y, x, `${key} ${JSON.stringify(a)}`); n++;
  }
  assert.ok(n > 1000);
  // lint + engine sentences over every sentence the corpus produced and over junk
  const texts = [...tally.sentences, '', 'a. b', 'ok.', 'uses truck.', 'e.g. fine.', '😀 done.', 'x', 'Two. Sentences here.', 'it said undefined.', 'b_h1 was refused.'];
  for (const t of texts) assert.deepStrictEqual(port.h.lintSentence(t), orig.h4.lintSentence(t), t);
  for (const raw of [null, undefined, '', 'exact fallback was needed', 'planar faces only', 'shallow angle', 'solid.cylinder: no body named b_h1', 'something else', 42, 'solidcraft ran the commands but no body named b_h1 came back']) {
    for (const f of fs_) assert.deepStrictEqual(attempt(() => port.h.engineSentence(f, raw)), attempt(() => orig.h4.engineSentence(f, raw)), String(raw));
  }
});

test('plainScriptError: identical on every script error of the group\'s cases and on constructed messages', () => {
  const raws = new Set();
  for (const [, msg] of caseSkipped) raws.add(msg);
  const shapes = [
    'hole() has no option called "foo". It takes across, at, deep and along.', 'holes has no option called "k". It takes a, b, c.',
    `hole's "along" has to be 'x', 'y' or 'z'. You gave it the text "w".`, `holes's "along" has to be 'x', 'y' or 'z'. You gave it 7.`,
    'hole() does not know the size the text "M7". Sizes are M3, M4, M5 (clearance holes), or give { across: <number> }.', 'holes() does not know the size 6. Sizes are M3, M4 (clearance holes), or give { across: <number> }.',
    'hole needs at as [u, v], got a list of 2.', "hole's at needs two numbers, like [across, up]. You gave it a list of 2.", "holes's apart needs two numbers, like [across, up]. You gave it a list of 3.", "hole's at needs two numbers, like [across, up]. You gave it the text \"x\".",
    'hole() cannot find how thick this combine is along z yet, so it cannot drill all the way through. Give it a depth: deep: 10.', 'holes() cannot find how thick this widget is along x yet, so it cannot drill all the way through. Give it a depth: deep: 4.',
    'hole() cannot find where the top of this pocket is along z exactly, so a hole that stops short of the other side cannot start at the top. Make it go all the way through (leave out deep:, or give a deep: at least 12.5), or drill the shape before it is cut.',
    'hole() cannot find where the top of this torus is along y exactly, so a hole that stops short of the other side cannot start at the top. Make it go all the way through (leave out deep:, or give a deep: at least 3), or drill the shape before it is cut.',
    'something else entirely', '', 'extrude() needs a sketch.',
  ];
  for (const s of shapes) raws.add(s);
  let changed = 0;
  for (const raw of raws) {
    const a = attempt(() => orig.h4.plainScriptError(raw, 'script')); const b = attempt(() => port.h.plainScriptError(raw, 'script'));
    assert.deepStrictEqual(b, a, raw);
    if (a.v !== raw) changed++;
  }
  assert.ok(raws.size > 40 && changed >= 8, `${raws.size} messages, ${changed} rewritten`);
});

test('closed forms and the removed-volume integral agree (cbRem, csRem, csToolDepth, csConeDepth, holeProfile, sectionArea, removedVolume)', () => {
  const r = mulberry32(99);
  const R = (lo, hi) => lo + r() * (hi - lo);
  for (let i = 0; i < 400; i++) {
    const d = R(0.5, 8); const D = d + R(0, 12); const a = R(20, 178); const bl = R(0.2, 20); const cbd = R(0.1, 10);
    for (const [name, args] of [['cbRem', [d, D, cbd, bl]], ['csRem', [d, D, a, bl]], ['csToolDepth', [d, D, a]], ['csConeDepth', [d, D, a]]]) {
      assert.deepStrictEqual(attempt(() => port.h[name](...args)), attempt(() => orig.h4[name](...args)), name);
    }
  }
  const holes = [];
  for (let i = 0; i < 120; i++) {
    const d = R(1, 5); const depth = R(2, 20);
    const h = { diameter: d, depth };
    if (r() < 0.4) h.counterbore = { diameter: d + R(1, 6), depth: R(0.5, 6) }; else if (r() < 0.5) h.countersink = { diameter: d + R(1, 8), angleDeg: R(40, 170) };
    holes.push([h, R(8, 15), R(-5, 5), R(-6, 6)]);
  }
  for (const [h, top, lo, c0z] of holes) assert.deepStrictEqual(attempt(() => port.hv.holeProfile(h, top, lo, c0z)), attempt(() => orig.vol.holeProfile(h, top, lo, c0z)));
  const tools = (n) => Array.from({ length: n }, () => { const [h, top, lo, c0z] = holes[Math.floor(r() * holes.length)]; return { cx: R(-8, 8), cy: R(-6, 6), prof: orig.vol.holeProfile(h, top, lo, c0z) }; });
  let areas = 0;
  for (let i = 0; i < 150; i++) {
    const news = tools(1 + Math.floor(r() * 2)); const olds = r() < 0.5 ? tools(1 + Math.floor(r() * 2)) : [];
    const box = [-10, 10, -8, 8]; const z = R(-4, 12);
    assert.deepStrictEqual(attempt(() => port.hv.sectionArea(news, olds, box, z, 300)), attempt(() => orig.vol.sectionArea(news, olds, box, z, 300)));
    areas++;
  }
  let vols = 0;
  for (let i = 0; i < 12; i++) {
    const news = tools(1 + Math.floor(r() * 2)); const olds = r() < 0.5 ? tools(1) : [];
    const box3 = [-12, 12, -9, 9, -3, 10];
    const a = attempt(() => orig.vol.removedVolume(news, olds, box3)); const b = attempt(() => port.hv.removedVolume(news, olds, box3));
    assert.deepStrictEqual(b, a); if (typeof a.v === 'number' && a.v > 0) vols++;
  }
  assert.ok(areas === 150 && vols >= 6, `vols ${vols}`);
});

test('curvedAxis and aggregateOf: original and port take identical decisions (rootOf and flatTopCurved are not exported by the original; the engine tests cover them)', () => {
  let curved = 0; let agg = 0; let roots = 0;
  const docs = [...caseDocs.map(([, d]) => d), ...generated.map(([, d]) => d), ...hand.map(([, d]) => d)];
  for (const doc of docs) {
    const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
    const G = { byId };
    for (const f of doc.features) {
      if (f.kind === 'hole') {
        const a = attempt(() => orig.h4.curvedAxis(f, G)); const b = attempt(() => port.h.curvedAxis(f, G));
        assert.deepStrictEqual(b, a);
        const ra = attempt(() => { const x = orig.h4.curvedAxis(byId[f.target], G); return x; }); const rb = attempt(() => port.h.curvedAxis(byId[f.target], G));
        assert.deepStrictEqual(rb, ra); roots++;
      }
      if (['cylinder', 'cone', 'extrude'].includes(f.kind)) { const a = attempt(() => orig.h4.curvedAxis(f, G)); assert.deepStrictEqual(attempt(() => port.h.curvedAxis(f, G)), a); if (a.v) curved++; }
    }
  }
  // aggregateOf on synthetic replies:
  const rr = mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const nb = 1 + Math.floor(rr() * 3);
    const bodies = Array.from({ length: nb }, (_, k) => ({ name: `b_${k}`, bbox: { min: [rr(), rr(), rr()], max: [5 + rr(), 5 + rr(), 5 + rr()] }, volume_mm3: 10 + rr() * 90, faces: 6 + Math.floor(rr() * 4), kernel: rr() < 0.5 ? { faces: 6 } : { faces: 7, shells: 1 + Math.floor(rr() * 2) }, face_types: rr() < 0.5 ? { plane: 6 } : { plane: 4, cylinder: 2 }, center_of_mass: [rr(), rr(), rr()] }));
    const res = { measure: { bodies } };
    for (const names of [['b_0'], ['b_0', 'b_1'], ['nope'], []]) { const a = attempt(() => orig.h4.aggregateOf(res, names)); assert.deepStrictEqual(attempt(() => port.h.aggregateOf(res, names)), a); agg++; }
  }
  assert.ok(curved > 30 && roots > 300 && agg === 800, JSON.stringify({ curved, roots, agg }));
});

// ---- composition ---------------------------------------------------------------------------------------------------------------------------
const EP_OWNED = new Set(['extrude', 'pocket', 'combine']);
const epRows = JSON.parse(fs.readFileSync(path.join(contract, 'ep-results.json'), 'utf8'));
const { epDoc } = await imp(path.join(here, 'ep-docs.mjs'));
const epCaseDocs = []; for (const c of epRows) { const r = runScript(c.script); if (!r.errors.length) epCaseDocs.push([`ep case ${c.id}`, solveDoc(r.doc)]); }
const epGenerated = Array.from({ length: 240 }, (_, i) => [`ep seed ${5000 + i}`, epDoc(5000 + i)]);
const EP_H = port.tr.createTranslator({ planners: ['extrude-pocket', 'holes'] });
const H_EP = port.tr.createTranslator({ planners: ['holes', 'extrude-pocket'] });

/** `drop`: the state keys of the OTHER member of a composition (bookkeeping that exists only because the other set is also a member) */
async function runTr(tr, doc, cfg, drop = ['holes']) {
  const fake = makeFake({ sync: true, ...cfg.fake });
  const ctx = { arc, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {}, ...(cfg.useMt ? { mt } : {}) };
  let result; let error = null;
  try { const r = await tr.translateDoc(structuredClone(doc), ctx); const { _state, spentS, ...rest } = r; result = { ...rest, accepted: _state.accepted, st: Object.fromEntries(Object.entries(_state.st).filter(([k]) => !drop.includes(k))) }; } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log.map((l) => l.slice(0, 2)), soups: ctx.soups };
}
const compo = { epHoleDiffer: 0, epAfterHole: [], epDocs: 0, epFull: 0, epPrefix: 0, epDiffer: [], hDocs: 0, hFull: 0, hHoleOnly: 0, hDiffer: [], hOrderFull: 0, hOrderDocs: 0 };

test('composition: ["extrude-pocket","holes"] does not change any extrude / pocket / combine result against "extrude-pocket" on the extrude-pocket corpus', async () => {
  const cfgs = [{ name: 'boxBool, mt', fake: { boxBool: true }, useMt: true }, { name: 'default fake', fake: {}, useMt: true }];
  const docs = [...epCaseDocs.filter((_, i) => i % 3 === 0), ...epGenerated.filter((_, i) => i % 3 === 0), ...hand];
  for (const [name, doc] of docs) {
    const firstHole = doc.features.findIndex((f) => f.kind === 'hole');
    for (const cfg of cfgs) {
      const a = await runTr(EP, doc, cfg); const b = await runTr(EP_H, doc, cfg);
      compo.epDocs++;
      assert.deepStrictEqual(b.error, a.error, `${name} thrown`);
      if (a.error) continue;
      if (firstHole < 0) {
        assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]`); assert.deepStrictEqual(b.log, a.log, `${name} log`); assert.deepStrictEqual(b.soups, a.soups);
        compo.epFull++;
      } else {
        // a hole is planned by the holes set, so a hole result may differ by design, and a feature that builds on a hole whose result differs may follow it. Anything else must not change.
        let diverged = false;
        a.result.features.forEach((x, i) => {
          const y = b.result.features[i];
          const same = (() => { try { assert.deepStrictEqual(y, x); return true; } catch { return false; } })();
          if (x.kind === 'hole') { if (!same) { diverged = true; compo.epHoleDiffer++; } return; }
          if (!same) { assert.ok(diverged, `${name} [${cfg.name}]: ${x.id} (${x.kind}) changed by composing, and no earlier hole result differs`); compo.epAfterHole.push(`${name}:${x.id}:${x.kind}`); }
        });
        compo.epPrefix++;
        let full = true; try { assert.deepStrictEqual(b.result, a.result); } catch { full = false; }
        if (!full) compo.epDiffer.push(name);
      }
    }
  }
  assert.ok(compo.epFull > 200 && compo.epPrefix > 20, JSON.stringify({ full: compo.epFull, prefix: compo.epPrefix }));
});

test('composition: ["extrude-pocket","holes"] does not change any hole result against "holes" on the holes corpus; ["holes","extrude-pocket"] is "holes" on docs without extrude / pocket / combine', async () => {
  const cfg = CONFIGS[0];
  const docs = [...caseDocs.map(([n, d]) => [n, d]), ...generated, ...hand];
  for (const [name, doc] of docs) {
    if (differences(doc).length) continue;
    const owned = doc.features.findIndex((f) => EP_OWNED.has(f.kind));
    const DROP = ['scene', 'curvedSlant'];
    const a = await runTr(HOLES, doc, { ...cfg }, DROP);
    const b = await runTr(EP_H, doc, { ...cfg }, DROP);
    compo.hDocs++;
    assert.deepStrictEqual(b.error, a.error, `${name} thrown`);
    if (a.error) { compo.hThrew = (compo.hThrew ?? 0) + 1; continue; }
    const holesOf = (r, upto) => r.result.features.slice(0, upto < 0 ? undefined : upto).filter((f) => f.kind === 'hole');
    // hole results (on docs without an extrude / pocket / combine: all of them; otherwise those before the first)
    assert.deepStrictEqual(holesOf(b, owned), holesOf(a, owned), `${name}: a hole result changed by composing`);
    assert.deepStrictEqual(b.log.slice(0, owned < 0 ? undefined : 0), a.log.slice(0, owned < 0 ? undefined : 0));
    if (owned < 0) {
      assert.deepStrictEqual(b.result.commands, a.result.commands, `${name}: accepted commands`);
      assert.deepStrictEqual(b.log, a.log, `${name}: engine calls`);
      compo.hHoleOnly++;
      // the other order: kinds nobody lists follow the first entry (holes), so the whole result is the holes set's
      const c = await runTr(H_EP, doc, { ...cfg }, DROP);
      assert.deepStrictEqual(c.result, a.result, `${name}: ['holes','extrude-pocket'] differs from 'holes'`);
      assert.deepStrictEqual(c.log, a.log);
      compo.hOrderDocs++; compo.hOrderFull++;
    } else {
      let full = true; try { assert.deepStrictEqual(holesOf(b, -1), holesOf(a, -1)); } catch { full = false; }
      if (!full) compo.hDiffer.push(name);
      compo.hFull += full ? 1 : 0;
    }
  }
  assert.ok(compo.hHoleOnly > 250, `docs without an extrude / pocket / combine: ${compo.hHoleOnly}`);
});

test('composition: ownership and bookkeeping rules', () => {
  const { composeProfiles, ownerOf, membersOf } = port.t;
  const P = port.tr.PROFILES;
  const c = composeProfiles([P['extrude-pocket'], P.holes]);
  assert.equal(c.name, 'extrude-pocket+holes');
  for (const k of ['extrude', 'pocket', 'combine']) assert.equal(ownerOf(c, k), P['extrude-pocket']);
  assert.equal(ownerOf(c, 'hole'), P.holes);
  for (const k of ['box', 'shell', 'move', 'sketch', 'whatever']) assert.equal(ownerOf(c, k), P['extrude-pocket'], `unlisted kinds follow the first entry (${k})`);
  const d = composeProfiles([P.holes, P['extrude-pocket']]);
  for (const k of ['box', 'shell', 'move']) assert.equal(ownerOf(d, k), P.holes);
  assert.equal(ownerOf(d, 'extrude'), P['extrude-pocket']);
  // a later entry overrides an earlier one per kind
  const e = composeProfiles([P.holes, { ...P['extrude-pocket'], name: 'x', planners: { hole: P['extrude-pocket'].planners.extrude } }]);
  assert.equal(ownerOf(e, 'hole').name, 'x');
  assert.deepStrictEqual(membersOf(c).map((p) => p.name), ['extrude-pocket', 'holes']);
  assert.equal(composeProfiles([P.holes]), P.holes);
  assert.throws(() => composeProfiles([]), /at least one/);
  // state: both members set theirs up
  const st = {}; c.initState(st);
  assert.ok(st.scene && st.curvedSlant && st.holes);
});

test('NEGATIVE CONTROLS: the comparison fails when it should', async () => {
  const cfg = CONFIGS[0];
  const bored = generated.filter(([, d]) => !differences(d).length && d.features.some((f) => f.kind === 'hole'));
  // 1. different engines on the two sides
  let seen = 0;
  for (const [, doc] of bored.slice(0, 20)) {
    const a = await runOrig(doc, cfg); const b = await runPort(HOLES, doc, { ...cfg, fake: {} });
    try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.log, a.log); } catch { seen++; }
  }
  assert.ok(seen >= 8, `a different engine was noticed on only ${seen} of 20 docs`);
  // 2. a one-number change in an emitted command
  const hit = bored.find(([, d]) => d.features.some((f) => f.kind === 'hole' && !f.counterbore && !f.countersink))[1];
  const r0 = await runOrig(hit, cfg);
  const tampered = structuredClone(r0.result);
  const bf = tampered.features.find((x) => x.status === 'built' && x.kind === 'hole');
  assert.ok(bf, 'no built hole to tamper with');
  bf.commands[0].params.radius += 1e-9;
  assert.throws(() => assert.deepStrictEqual(tampered, r0.result));
  // 3. the base and extrude-pocket planner sets are NOT the group's: run over the group's corpus they must be caught by the same comparison
  for (const [label, tr] of [['base', BASE], ['extrude-pocket', EP]]) {
    let differing = 0; let n = 0;
    for (const [, d] of bored.slice(0, 60)) { n++; const x = await runOrig(d, cfg); const y = await runPort(tr, d, cfg); try { assert.deepStrictEqual(y.result, x.result); assert.deepStrictEqual(y.log, x.log); } catch { differing++; } }
    assert.ok(differing > 40, `${label} mode only differed on ${differing} of ${n} docs: the comparison is not discriminating`);
  }
  // 4. a port with ONE changed number (a wrong radius by 1e-12 relative) is caught on the corpus
  const wrapped = { ...HOLES, translateDoc: async (d, c) => { const res = await HOLES.translateDoc(d, c); for (const ft of res.features) for (const cmd of ft.commands) if (cmd.command === 'solid.cylinder' && typeof cmd.params.radius === 'number') cmd.params.radius *= 1 + 1e-12; return res; } };
  let caught = 0;
  for (const [, d] of bored.slice(0, 40)) { const x = await runOrig(d, cfg); const y = await runPort(wrapped, d, cfg); try { assert.deepStrictEqual(y.result, x.result); } catch { caught++; } }
  assert.ok(caught > 15, `the 1e-12 mutation was caught on only ${caught} docs`);
  // 5. a guard with a changed threshold: the original with MIN_ACROSS-ish change is modelled by switching a guard off on one side only
  let g = 0;
  for (const [, d] of bored.slice(0, 80)) { const x = await runOrig(d, cfg); const y = await runPort(HOLES, d, cfg, ['G-TOP']); try { assert.deepStrictEqual(y.result, x.result); } catch { g++; } }
  assert.ok(g >= 5, `switching G-TOP off on one side was noticed on only ${g} docs`);
  // 6. the pure comparison catches a changed closed form
  const bad = (d, D, a, bl) => port.h.csRem(d, D, a + 1, bl);
  let c6 = 0; for (let i = 1; i < 30; i++) if (bad(2, 3 + i, 90, 4) !== orig.h4.csRem(2, 3 + i, 90, 4)) c6++;
  assert.ok(c6 > 20);
});

test.after(() => {
  const s = tally;
  const top = (o, n = 12) => JSON.stringify(Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n)));
  console.log(`\nHOLES DIFFERENTIAL SUMMARY
  corpus (a): ${caseDocs.length} ModelDocs from the group's cases (${caseSkipped.length} scripts do not run: no ModelDoc; files ${caseFiles.join(', ')})
  corpus (b): ${generated.length} generated hole docs (seeds 0..${N_GEN - 1}), ${s.generated?.inSet} in the equality set; ${hand.length} base hand docs (${s.hand?.inSet} in the set)
  equality set: ${s.inSet.docs} docs, ${CONFIGS.length} configs: ${CONFIGS.map((c) => c.name).join('; ')}
  translateDoc comparisons (incl. guard-off runs): ${s.cases}, identical: ${s.identical}, threw: ${s.thrown}, engine calls compared: ${s.runSCcalls} (${s.budgetOpts} with a { budgetS } option)
  EXCLUDED from equality (phase0 and phase 4 plan a non-hole feature differently): ${s.excluded.docs} docs (by corpus ${JSON.stringify(s.excluded.byCorpus)}); by cause ${top(s.excluded.kinds)}; of the case docs, ${s.excluded.differ} really differ and ${s.excluded.agree} happen to agree
  built: ${JSON.stringify(s.built)}; refused: ${JSON.stringify(s.refused)}
  guards that fired (refusals): ${top(s.guards, 40)}
  guards not reached: ${JSON.stringify(s.guardsNotReached)}; distinct refusal sentence shapes: ${s.sentences.size}; time-outs: ${s.timedOut}
  guard switched off: ${JSON.stringify(s.offDiffer)}
  composition [extrude-pocket, holes] vs extrude-pocket: ${compo.epDocs} runs, ${compo.epFull} fully identical (no hole in the doc), ${compo.epPrefix} with a hole (identical up to the first hole), whole result differs after a hole in ${compo.epDiffer.length} runs (${compo.epHoleDiffer} hole results differ; non-hole results that follow a differing hole: ${JSON.stringify(compo.epAfterHole)})
  composition [extrude-pocket, holes] vs holes: ${compo.hDocs} docs; no extrude / pocket / combine: ${compo.hHoleOnly} (hole results, accepted commands and engine calls identical; [holes, extrude-pocket] identical in full: ${compo.hOrderFull}/${compo.hOrderDocs}); with one: ${compo.hDocs - compo.hHoleOnly}, of which a hole result after the first extrude / pocket / combine differs in ${compo.hDiffer.length}: ${compo.hDiffer.slice(0, 12).join(', ')}`);
});
