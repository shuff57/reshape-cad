// DIFFERENTIAL TEST for the shell-draft fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/shell-draft-translate.mjs, which imports
// phase0/translate.mjs; both untouched) against the compiled TypeScript port in 'shell-draft' mode (createTranslator({ planners: 'shell-draft' })). Both are fed the
// same ModelDocs through the same deterministic FAKE engine (test/fake-engine.mjs, no kernel, no wasm) and must produce IDENTICAL output: the translateDoc result
// (features, commands), the ordered list of engine calls (the guards' probe re-runs included) and a thrown error.
//
// WHAT "IDENTICAL" CAN MEAN HERE, in two parts (NOTES.md "Fold 3" has the long version).
//  1. The original is phase0 + the group's shell and draft planners; the layer's base is the phase 4 translator. Where phase0 and phase 4 plan a feature OTHER than
//     shell and draft differently (a fillet's edge, a constrained-sketch (soup) pull / spin / blend) the two cannot be equal: such a doc is EXCLUDED from the equality
//     requirement (counted, with the kind that differs, and shown to really differ).
//  2. The original takes the face a shell opens / a draft tilts from `ctx.resolveAt` (brep-rs resolve, the primitive's own frame) and carries it through the moves of the
//     history (G-PICK). The layer has no such resolver. The port supports that path when the host supplies `ctx.resolveAt` (this test gives BOTH sides the same
//     deterministic fake resolver, so every named pick of the group is compared), and otherwise takes the point from the base's name resolution (the engine's own
//     topology). The second path is NOT the original's; it is run on the same docs and REPORTED (agree / differ, by cause), not asserted equal.
//
// The original's result has no `_state`; the port's does (the base translator's public surface). `_state` is removed before the comparison.
// This shows the port equals the original on the inputs below. It does NOT show the built solids are right: the fake has no geometry kernel (its shell/draft model is a
// few lines on bounding boxes, see the notes above shellModel / draftModel in fake-engine.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs } from './docs.mjs';
import { holeDoc } from './holes-docs.mjs';
import { epDoc, mulberry32 } from './ep-docs.mjs';
import { sdDoc, sdFromUsage, N_CATEGORIES } from './sd-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const imp = (p) => import(pathToFileURL(p).href);

const orig = {
  sd: await imp(path.join(contract, 'shell-draft-translate.mjs')),
  p0: await imp(path.join(root, 'docs/spikes/solidcraft-referee/phase0/translate.mjs')),
  p4: await imp(path.join(root, 'docs/spikes/solidcraft-referee/phase7/pane/lib/translate-p4.mjs')),
  poly: await imp(path.join(contract, 'shell-draft-polytope.mjs')),
};
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), sd: await dist('shell-draft.js'), t: await dist('translate.js') };
const SD = port.tr.createTranslator({ planners: 'shell-draft' });
const BASE = port.tr.createTranslator();
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- the fake pick source: what brep-rs `resolve` gives, crudely (the primitive's OWN frame: rotate about the origin, then its center; no later move) --------------------
const DIRV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
function rotPt(p, r) {
  let [x, y, z] = p;
  const R = (a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
  if (r?.[0]) { const [c, s] = R(r[0]); [y, z] = [c * y - s * z, s * y + c * z]; }
  if (r?.[1]) { const [c, s] = R(r[1]); [x, z] = [c * x + s * z, -s * x + c * z]; }
  if (r?.[2]) { const [c, s] = R(r[2]); [x, y] = [c * x - s * y, s * x + c * y]; }
  return [x, y, z];
}
function fakeResolveAt(prefix, name) {
  const f = prefix.find((x) => x.id === name.feature);
  if (!f) return null;
  const c = f.center ?? [0, 0, 0];
  const dir = DIRV[name.part];
  const world = (p) => { const q = rotPt(p, f.rotate); return [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; };
  const best = (centres) => { // the face whose centre is furthest along the word, first on a tie (the resolver's scoring)
    if (!dir) return null;
    let bi = 0; let bs = -Infinity;
    centres.forEach((p, i) => { const s = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; if (s > bs + 1e-9) { bs = s; bi = i; } });
    return { kind: 'face', centroid: world(centres[bi]) };
  };
  if (name.kind === 'edge' && name.cause === 'between') { // an edge between two primitive faces of a box: the middle of the edge, and its length
    if (f.kind !== 'box') return null;
    const [a, b] = name.of.map((n) => DIRV[n.part]);
    if (!a || !b || a.every((v, i) => v === b[i])) return null;
    const h = f.size.map((v) => v / 2);
    const mid = [0, 1, 2].map((i) => (a[i] + b[i]) * h[i]);
    const free = [0, 1, 2].find((i) => a[i] === 0 && b[i] === 0);
    return free === undefined ? null : { kind: 'edge', centroid: world(mid), length: f.size[free] };
  }
  switch (f.kind) {
    case 'box': { if (!dir) return null; const h = f.size.map((v) => v / 2); return { kind: 'face', centroid: world(dir.map((d, i) => d * h[i])) }; }
    case 'cylinder': return name.part === '+z' || name.part === '-z' ? { kind: 'face', centroid: world([0, 0, dir[2] * f.height / 2]) } : null;
    case 'cone': return name.part === '-z' ? { kind: 'face', centroid: world([0, 0, -f.height / 2]) } : null;
    case 'prism': case 'wedge': {
      const poly = f.kind === 'prism'
        ? (() => { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]); })()
        : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
      const centres = poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]; });
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length; const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      centres.push([cx, cy, f.height / 2], [cx, cy, -f.height / 2]);
      return best(centres);
    }
    case 'extrude': {
      const sk = prefix.find((x) => x.id === f.target);
      if (!sk || sk.shape === 'circle') return dir && Math.abs(dir[2]) === 1 ? { kind: 'face', centroid: world([0, 0, dir[2] > 0 ? f.height : 0]) } : null;
      const o = arc.outlineOf(sk); if (!o.ok) return null;
      const fr = mt.sketchFrameOf(sk);
      const sw = [fr.u[1] * fr.v[2] - fr.u[2] * fr.v[1], fr.u[2] * fr.v[0] - fr.u[0] * fr.v[2], fr.u[0] * fr.v[1] - fr.u[1] * fr.v[0]];
      const to3 = (p, h) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1] + sw[i] * h);
      const P = o.points;
      const centres = P.map((a, i) => { const b = P[(i + 1) % P.length]; return to3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f.height / 2); });
      const cc = [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
      centres.push(to3(cc, f.height), to3(cc, 0));
      if (!dir) return null;
      let bi = 0; let bs = -Infinity;
      centres.forEach((p, i) => { const s = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; if (s > bs + 1e-9) { bs = s; bi = i; } });
      return { kind: 'face', centroid: centres[bi] }; // already in the world: an extrude is not built in a local frame
    }
    default: return null;
  }
}

// ---- corpus (a): every case of the group, exactly as the runner turns it into a ModelDoc (runScript, the case's patch, solveDoc) ---------------------------------------
const { CASES_FN } = await imp(path.join(contract, 'shell-draft-cases.mjs'));
const { STEEP_FN } = await imp(path.join(contract, 'shell-draft-cases-steep.mjs'));
const { R2_FN } = await imp(path.join(contract, 'shell-draft-cases-r2.mjs'));
const env = { P: orig.poly, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) }; // sigma -1 is what the committed run measured (shell-draft-runs.json)
const CASES = [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)];
const caseDocs = []; const caseSkipped = [];
for (const c of CASES) {
  const r = runScript(c.script);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); continue; }
  const doc0 = r.doc; if (c.patch) c.patch(doc0);
  caseDocs.push({ name: `case ${c.id}`, doc: solveDoc(doc0), fromUsage: orig.sd.draftFromUsage(c.script), script: c.script });
}
// ---- corpus (b): generated shell / draft docs, and the base hand docs through the group translator ------------------------------------------------------------------
const N_GEN = 420;
const generated = Array.from({ length: N_GEN }, (_, i) => { const doc = sdDoc(i); return { name: `sd seed ${i}`, doc, fromUsage: sdFromUsage(i, doc) }; });
const hand = handDocs().map(([name, doc]) => ({ name: `hand ${name}`, doc, fromUsage: undefined }));

// ---- where phase0 and phase 4 plan a feature other than shell / draft differently (NOTES.md has the table) ----------------------------------------------------------
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'fillet') out.push('fillet (edge name resolution and candidates)');
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch (soup)`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch (soup)');
  }
  return out;
}
/** does the doc ask for a named face (the pick source matters)? */
const namedPicks = (doc) => doc.features.filter((f) => (f.kind === 'shell' && f.open) || (f.kind === 'draft' && f.face && !f.whole)).length;

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const CONFIGS = [
  { name: 'shellDraft+boxBool, mt, resolver', fake: { shellDraft: true, boxBool: true }, useMt: true, resolver: fakeResolveAt },
  { name: 'default fake, mt, resolver', fake: {}, useMt: true, resolver: fakeResolveAt },
  { name: 'shellDraft+boxBool, every 5th call fails, no mt, resolver', fake: { shellDraft: true, boxBool: true, failEvery: 5 }, useMt: false, resolver: fakeResolveAt },
  { name: 'shellDraft+boxBool+holeModel, mt, resolver down (always null)', fake: { shellDraft: true, boxBool: true, holeModel: true }, useMt: true, resolver: () => null },
];
const CFG0 = CONFIGS[0];

const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
function runOrig(item, cfg, off = []) {
  const fake = makeFake({ sync: true, ...cfg.fake });
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, runSC: fake.runSC, resolveAt: cfg.resolver, ...(cfg.useMt ? { mt } : {}) };
  let result; let error = null;
  try { result = orig.sd.translateDocGuarded(structuredClone(item.doc), ctx, { fromUsage: item.fromUsage, off }); } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log };
}
async function runPort(tr, item, cfg, off = [], { resolver = cfg.resolver, asyncFake = false, tweak = null } = {}) {
  const fake = makeFake({ sync: !asyncFake, ...cfg.fake });
  const runSC = tweak ? (cmds, o) => tweak(fake.runSC(cmds, o)) : fake.runSC;
  const ctx = {
    arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, runSC, topologyOf: fake.topologyOf, soups: {}, ...(cfg.useMt ? { mt } : {}), ...(resolver ? { resolveAt: resolver } : {}),
    ...(item.fromUsage ? { fromUsage: item.fromUsage } : {}), ...(off.length ? { guardsOff: off } : {}),
  };
  let result; let error = null;
  try { const { _state, ...rest } = await tr.translateDoc(structuredClone(item.doc), ctx); result = rest; assert.ok(_state); } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log };
}

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), calls: 0, picks: { named: 0 },
  inSet: { docs: 0, cases: 0 }, excluded: { docs: 0, kinds: {}, differ: 0, agree: 0, sdChecked: 0, sdAgree: 0, sharedGuards: {} }, offDiffer: {}, pathB: { docs: 0, same: 0, differ: 0 },
  byCorpus: { cases: { docs: 0, inSet: 0 }, generated: { docs: 0, inSet: 0 }, hand: { docs: 0, inSet: 0 } },
};
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const shape = (s) => String(s).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f|d|pk|pa|mi|u|sph|cyl|ghost)\d*\b/g, '$1');
function note(a) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'refused') { bump(tally.refused, f.kind); bump(tally.guards, f.guard ?? '(none)'); tally.sentences.add(shape(f.refusal)); }
  }
}
async function compareDoc(name, item, cfg, off = []) {
  const a = runOrig(item, cfg, off);
  const b = await runPort(SD, item, cfg, off);
  tally.cases++;
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  tally.identical++; tally.calls += a.log.length;
  if (a.error) { tally.thrown++; bump((tally.errors ??= {}), a.error); }
  note(a);
  return { a, b };
}
/** run the (a)/(b)/hand corpora: in-set docs are compared under every config, the others are counted by cause and shown to differ */
async function runCorpus(label, items, configs = CONFIGS) {
  let inSet = 0; let excl = 0;
  for (const item of items) {
    const diff = differences(item.doc);
    tally.byCorpus[label].docs++;
    if (diff.length) {
      excl++; tally.excluded.docs++;
      for (const d of new Set(diff)) bump(tally.excluded.kinds, d);
      const a = runOrig(item, CFG0); const b = await runPort(SD, item, CFG0);
      try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.error, a.error); tally.excluded.agree++; } catch { tally.excluded.differ++; }
      // not asserted: do the shell and draft decisions (status, guard) still agree when only the fillet's pick differs?
      const sd = (r) => (r.result?.features ?? []).filter((f) => f.kind === 'shell' || f.kind === 'draft').map((f) => [f.id, f.status, f.guard ?? null]);
      tally.excluded.sdChecked++;
      if (JSON.stringify(sd(a)) === JSON.stringify(sd(b))) tally.excluded.sdAgree++;
      for (const [x, y] of sd(a).map((v, i) => [v, sd(b)[i]])) if (x[2] && x[2] === y?.[2]) bump(tally.excluded.sharedGuards, x[2]);
      continue;
    }
    inSet++; tally.inSet.docs++; tally.byCorpus[label].inSet++;
    tally.picks.named += namedPicks(item.doc);
    for (const cfg of configs) { await compareDoc(item.name, item, cfg); tally.inSet.cases++; }
  }
  return { inSet, excl };
}

test('createTranslator: the shell-draft set exists, the default stays base, unknown sets throw, lists compose', () => {
  assert.equal(SD.planners, 'shell-draft');
  assert.equal(BASE.planners, 'base');
  assert.throws(() => port.tr.createTranslator({ planners: 'nope' }), /unknown planner set/);
  assert.throws(() => port.tr.createTranslator({ planners: ['shell-draft', 'shell-draft'] }), /listed twice/);
  assert.deepStrictEqual(SD.FEATURE_KINDS, orig.p4.FEATURE_KINDS);
  assert.deepStrictEqual(Object.keys(port.tr.PROFILES).sort(), ['base', 'booleans', 'extrude-pocket', 'fillet-chamfer', 'holes', 'patterns-mirror', 'revolve-groove', 'shell-draft']);
  for (const list of [['shell-draft'], ['holes', 'shell-draft'], ['shell-draft', 'holes'], ['extrude-pocket', 'holes', 'shell-draft'], ['extrude-pocket', 'shell-draft']]) {
    assert.deepStrictEqual(port.tr.createTranslator({ planners: list }).planners, list);
  }
  // planFeature cannot plan a shell or a draft synchronously under this set: it must not fall back to the unguarded base planner
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} };
  for (const f of [{ id: 's1', kind: 'shell', target: 'b1', thickness: 1 }, { id: 'd1', kind: 'draft', target: 'b1', angle: 3, pull: 'z', neutral: 0, whole: true }]) {
    assert.throws(() => SD.planFeature(f, st, { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, runSC: () => ({ ok: true }), resolve: () => null }), /plans a shell and a draft asynchronously/);
  }
});

test('the closed-hollow sentence: the original file passes the reason (no "undefined"), and so does the port', () => {
  const f = { id: 's1', kind: 'shell', target: 'b1', thickness: 2 };
  const doc = { features: [{ id: 'b1', kind: 'torus', ringRadius: 10, tubeRadius: 2, center: [0, 0, 0] }, f] };
  return (async () => {
    const a = runOrig({ doc }, CFG0); const b = await runPort(SD, { doc }, CFG0);
    assert.deepStrictEqual(b.result, a.result);
    const sentence = a.result.features[1].refusal;
    assert.ok(!/undefined/.test(sentence), sentence);
    assert.match(sentence, /is made from a ring/);
    assert.equal(orig.sd.SENTENCE.closed.length, 2);
  })();
});

test('base, extrude-pocket and holes are untouched: base mode is still exactly the phase 4 translator on every corpus doc', async () => {
  let n = 0;
  for (const { name, doc } of [...hand, ...generated.slice(0, 60)]) {
    const fa = makeFake({ boxBool: true }); const fb = makeFake({ boxBool: true });
    const ca = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, mt, runSC: fa.runSC, topologyOf: fa.topologyOf, resolveAt: () => null };
    const cb = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, mt, runSC: fb.runSC, topologyOf: fb.topologyOf, soups: {} };
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

test('(a) every case of the group that turns into a ModelDoc: identical where phase0 and phase 4 plan every other feature the same (all configs, named picks from the shared fake resolver)', async () => {
  assert.equal(CASES.length, 1100, 'the group has 1100 cases');
  assert.ok(caseDocs.length >= 1090, `only ${caseDocs.length} case docs (${caseSkipped.length} scripts failed to run)`);
  const { inSet } = await runCorpus('cases', caseDocs);
  tally.cases_ = { cases: CASES.length, docs: caseDocs.length, noDoc: caseSkipped.length, inSet };
  assert.ok(inSet >= 1000, `only ${inSet} case docs are in the equality set`);
});

test('(b) generated shell / draft docs (hollows open every side, walls near the limit, closed hollows, prisms, L / notched / boss parts, moves, turns, mirrors, patterns, drafts of faces and of whole shapes, draft then hollow, after holes and fillets, malformed)', async () => {
  assert.ok(generated.length >= 300);
  const { inSet } = await runCorpus('generated', generated);
  tally.generated = { docs: generated.length, inSet };
  assert.ok(inSet >= 300, `only ${inSet} generated docs are in the equality set`);
});

test('the base hand docs through the group translator (in-set ones identical)', async () => {
  const { inSet } = await runCorpus('hand', hand, CONFIGS.slice(0, 3));
  assert.ok(inSet > 25, `only ${inSet} hand docs in the set`);
});

test('the port gives the same result with an ASYNC engine as with a synchronous one (the original is synchronous)', async () => {
  let n = 0;
  for (const item of [...generated.slice(0, 120)]) {
    if (differences(item.doc).length) continue;
    for (const cfg of [CONFIGS[0], CONFIGS[2]]) {
      const s = await runPort(SD, item, cfg); const a = await runPort(SD, item, cfg, [], { asyncFake: true });
      assert.deepStrictEqual(a.result, s.result, item.name); assert.deepStrictEqual(a.error, s.error, item.name); assert.deepStrictEqual(a.log, s.log, item.name);
      n++;
    }
  }
  assert.ok(n > 150);
});

test('G-SWEEP and G-REACH switched OFF (the runner\'s SD_OFF negative-control mode) are translated identically, and the switch really changes results', async () => {
  const pool = [...caseDocs, ...generated].filter((it) => !differences(it.doc).length);
  for (const g of ['G-SWEEP', 'G-REACH']) {
    let fired = 0; let differs = 0;
    for (const item of pool) {
      const on = runOrig(item, CFG0);
      const firedHere = on.result?.features.some((f) => f.guard === g || (f.guard === 'G-SWEEP' && g === 'G-SWEEP'));
      if (!firedHere && fired > 40) continue;
      const { a } = await compareDoc(`${item.name} [off ${g}]`, item, CFG0, [g]);
      if (firedHere) { fired++; try { assert.deepStrictEqual(a.result, on.result); } catch { differs++; } }
    }
    tally.offDiffer[g] = { fired, differs };
    assert.ok(fired > 0 && differs > 0, `${g}: fired on ${fired}, changed on ${differs}`);
  }
});

test('named picks without a resolver (the layer\'s own path): runs on every named-pick doc and is REPORTED against the original, not asserted equal', async () => {
  // pickedFrom names where the point came from ('brep-rs resolve + moves in the history' / 'solidcraft topology (browser) + moves in the history'); it differs by design and is ignored here
  const noPickedFrom = (r) => (r ? { ...r, features: r.features.map(({ pickedFrom, ...f }) => f) } : r);
  const bucket = (corpus) => (tally.pathB[corpus] ??= { docs: 0, same: 0, differ: 0, withMove: { docs: 0, differ: 0 }, withoutMove: { docs: 0, differ: 0 }, causes: {} });
  const pools = { cases: caseDocs, generated };
  for (const [corpus, items] of Object.entries(pools)) {
    const bk = bucket(corpus);
    for (const item of items.filter((it) => !differences(it.doc).length && namedPicks(it.doc) > 0)) {
      const a = runOrig(item, CFG0);
      const b = await runPort(SD, item, CFG0, [], { resolver: null });
      tally.pathB.docs++; bk.docs++;
      const moved = item.doc.features.some((f) => ['move', 'rotate', 'mirror', 'pattern'].includes(f.kind) || (f.kind === 'combine'));
      (moved ? bk.withMove : bk.withoutMove).docs++;
      let same = false;
      try { assert.deepStrictEqual(noPickedFrom(b.result), noPickedFrom(a.result)); assert.deepStrictEqual(b.error, a.error); same = true; } catch { /* reported below */ }
      if (same) { tally.pathB.same++; bk.same++; continue; }
      tally.pathB.differ++; bk.differ++; (moved ? bk.withMove : bk.withoutMove).differ++;
      const fa = a.result?.features ?? []; const fb = b.result?.features ?? [];
      const i = fa.findIndex((x, k) => JSON.stringify([x.status, x.refusal, x.commands, x.measure]) !== JSON.stringify([fb[k]?.status, fb[k]?.refusal, fb[k]?.commands, fb[k]?.measure]));
      const x = fa[i]; const y = fb[i];
      let cause;
      if (a.error !== b.error) cause = 'a thrown error on one side';
      else if (!x || !y) cause = 'results differ only in a field other than status, sentence, commands and measure';
      else if (x.status === 'built' && y.status === 'built') cause = JSON.stringify(x.measure) === JSON.stringify(y.measure) ? 'both built with the SAME measure; only the pick point (the command) differs' : 'both built with a DIFFERENT measure (another face was opened or tilted)';
      else if (x.status === 'built' && y.status === 'refused') cause = `original built, topology path refused (${y.guard ?? 'no guard'})`;
      else if (x.status === 'refused' && y.status === 'built') cause = `original refused (${x.guard ?? 'no guard'}), topology path built`;
      else cause = `both refused with a different sentence or guard (${x.guard ?? 'none'} / ${y.guard ?? 'none'})`;
      bump(bk.causes, cause);
      ((tally.pathB.examples ??= {})[cause] ??= []).length < 4 && tally.pathB.examples[cause].push({ name: item.name, id: x?.id, a: x && { status: x.status, guard: x.guard, refusal: x.refusal, cmd: x.commands?.[0]?.params?.faces, vol: x.measure?.volume }, b: y && { status: y.status, guard: y.guard, refusal: y.refusal, raw: y.raw, cmd: y.commands?.[0]?.params?.faces, vol: y.measure?.volume } });
      // the topology path asks nothing of a resolver that is not there
      assert.ok(b.log.every((l) => l[0] === 'runSC' || l[0] === 'topologyOf'));
    }
  }
  assert.ok(tally.pathB.docs > 500, `${tally.pathB.docs} named-pick docs`);
});

test('without a resolver and without a topology: a named pick is refused in the group\'s own sentence, not thrown', async () => {
  const doc = { features: [{ id: 'b1', kind: 'box', size: [20, 20, 10], center: [0, 0, 0] }, { id: 's1', kind: 'shell', target: 'b1', thickness: 2, open: { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' } }] };
  const fake = makeFake({ shellDraft: true, boxBool: true });
  const { _state, ...r } = await SD.translateDoc(structuredClone(doc), { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, mt, runSC: fake.runSC });
  assert.equal(r.features[1].status, 'refused');
  assert.equal(r.features[1].guard, 'G-PICK');
  assert.match(r.features[1].refusal, /^s1 \(hollow\): the top face of b1 could not be found on the part as it is now, so s1 is shown without it/);
  assert.match(r.features[1].raw, /no resolution/);
});

test('coverage: the corpus reaches the group paths (not a vacuous pass)', () => {
  const must = ['G-CONVEX', 'G-PICK', 'G-TIE', 'G-THICK', 'G-VANISH', 'G-SWEEP', 'G-REACH', 'G-BLIND', 'G-FROM', 'G-CLOSED', 'G-TWICE', 'G-VOID', 'G-CAP', 'G-ANGLE', 'G-HOLE', 'G-RIM', 'G-ROUND', 'G-CONE', 'G-FLAT', 'G-CHAMFER', 'G-WHOLE-AXIS', 'G-WHOLE-HISTORY', 'G-WHOLE-HOLLOW', 'G-WHOLE-SHAPE', 'engine'];
  const missing = must.filter((g) => !tally.guards[g]);
  tally.guardsNotReached = missing;
  // G-RIM needs a fillet of the open face's edge, and a fillet is planned differently by phase0 and phase 4, so those docs are outside the equality set; it is reached on them (not asserted equal)
  const stillMissing = missing.filter((g) => !(g === 'G-RIM' && tally.excluded.sharedGuards['G-RIM'] > 0));
  assert.deepStrictEqual(stillMissing, [], `guards that never fired in the corpus: ${missing}`);
  assert.ok((tally.built.shell ?? 0) > 300 && (tally.refused.shell ?? 0) > 300, `shells built ${tally.built.shell}, refused ${tally.refused.shell}`);
  assert.ok((tally.built.draft ?? 0) > 300 && (tally.refused.draft ?? 0) > 300, `drafts built ${tally.built.draft}, refused ${tally.refused.draft}`);
  assert.ok(tally.excluded.differ > 0, 'no excluded doc really differs: the exclusion rule is vacuous');
});

// ---- negative controls: the comparison must be able to fail -----------------------------------------------------------------------------------------------------------
test('negative controls: a different engine, a 1e-9 and a 1e-12 tamper, base mode, one guard off on one side, no resolver on the port are all detected', async () => {
  const pool = [...caseDocs, ...generated].filter((it) => !differences(it.doc).length);
  const ran = pool.map((it) => [it, runOrig(it, CFG0).result]);
  const builtDocs = ran.filter(([, r]) => r?.features.some((f) => (f.kind === 'shell' || f.kind === 'draft') && f.status === 'built')).map(([it]) => it).slice(0, 40);
  const sweepDocs = ran.filter(([, r]) => r?.features.some((f) => f.guard === 'G-SWEEP' || f.guard === 'G-REACH')).map(([it]) => it).slice(0, 20);
  const built = [...builtDocs, ...sweepDocs];
  assert.ok(built.length >= 30, `only ${built.length} docs with a built shell or draft`);
  const detect = async (label, mutate) => {
    let hit = 0;
    for (const it of built) { const a = runOrig(it, CFG0); const b = await mutate(it); try { assert.deepStrictEqual(b.result, a.result); assert.deepStrictEqual(b.log, a.log); } catch { hit++; } }
    assert.ok(hit > 0, `negative control '${label}' was NOT detected on ${built.length} docs`);
    return hit;
  };
  const res = {};
  res.differentEngine = await detect('different engine', (it) => runPort(SD, it, { ...CFG0, fake: { shellDraft: false, boxBool: true } }));
  const tamper = (k) => (r) => { if (r?.ok && r.measure) r.measure.bodies.forEach((b) => { b.volume_mm3 *= 1 + k; }); return r; };
  res.tamper1e9 = await detect('1e-9 tamper', (it) => runPort(SD, it, CFG0, [], { tweak: tamper(1e-9) }));
  res.tamper1e12 = await detect('1e-12 tamper', (it) => runPort(SD, it, CFG0, [], { tweak: tamper(1e-12) }));
  res.baseMode = await detect('base mode', async (it) => {
    const fake = makeFake({ ...CFG0.fake }); let result; let error = null;
    try { const { _state, ...rest } = await BASE.translateDoc(structuredClone(it.doc), { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, mt, runSC: fake.runSC, topologyOf: fake.topologyOf, soups: {} }); result = rest; } catch (e) { error = errOf(e); }
    return { result, error, log: fake.log };
  });
  res.guardOffOneSide = await detect('G-SWEEP off on the port only', (it) => runPort(SD, it, CFG0, ['G-SWEEP', 'G-REACH']));
  res.noResolver = await detect('no resolver on the port', (it) => runPort(SD, it, CFG0, [], { resolver: null }));
  tally.negctl = res;
});

// ---- the pure guards, no engine at all: original .mjs against the port, same inputs ------------------------------------------------------------------------------------
function attempt(fn) { try { return { v: fn() }; } catch (e) { return { thrown: errOf(e) }; } }

test('constants and every SENTENCE builder agree (all of them, on varied arguments)', () => {
  assert.deepStrictEqual(port.sd.SWEEP_TOL, orig.sd.SWEEP_TOL);
  assert.equal(port.sd.SC_SIGMA, orig.sd.SC_SIGMA);
  assert.deepStrictEqual(Object.keys(port.sd.SENTENCE), Object.keys(orig.sd.SENTENCE));
  const fs_ = [
    { id: 's1', kind: 'shell', target: 'b1', thickness: 2, open: { feature: 'b1', part: '+z' } }, { id: 'd2', kind: 'draft', target: 'b1', angle: 7.123456, face: { feature: 'b1', part: '-x' }, pull: 'y' },
    { id: 's3', kind: 'shell', target: 'p1', thickness: 0.0005 }, { id: 'd4', kind: 'draft', target: 'e1', angle: -30, whole: true, pull: 'x' }, { id: 'x5', kind: 'other', target: 'q', angle: 89 },
  ];
  const argSets = [[], ['top'], ['left', { id: 'd9' }], ['front', 'cylinder'], ['box', 3], [2, 5, 'the part'], ['hex', 'side', 6], ['a join', 'x'], ['h9', 'h8'], [1.5, 2.25, 3],
    ['bottom', 'was tilted by d3'], ['sphere'], ['cone'], ['top', 'cone'], ['x', 'y', 'z'], ['right', { pull: 'x', fromWord: 'bottom' }], ['front', { pull: 'y' }], ['top', { pull: 'z', fromWord: null }], [89], [45, 7, 'chamfer'], ['top', 'sphere'], [12, 3, 'fillet'], ['bottom', 12.5, 3]];
  let n = 0;
  for (const key of Object.keys(orig.sd.SENTENCE)) for (const f of fs_) for (const a of argSets) {
    const x = attempt(() => orig.sd.SENTENCE[key](f, ...a)); const y = attempt(() => port.sd.SENTENCE[key](f, ...a));
    assert.deepStrictEqual(y, x, `${key} ${JSON.stringify(a)}`); n++;
  }
  assert.ok(n > 3000);
});

test('plainEngineText: identical on every engine text the corpus produced and on constructed ones', () => {
  const raws = new Set(['', 'x', 'solid.shell: invalid parameters for `solid.shell`: `faces` must be a list of points', 'no face at (1,2,3)', 'select at least one face', 'implausible result volume', 'shell would collapse',
    'a round of radius 2 mm is larger than the shell is 1.5 mm', 'round of radius 2.5 mm; shell is 2 mm', 'corner whose faces', 'draft angle must be between -89 and 89', 'face is parallel to the pull', 'a face square to the pull direction',
    'no faces to draft', 'no face at the given point', 'fake: draft angle too steep', 'fake: shell wall too thick', 'WASM TRAP: unreachable', 'not oriented and closed', 'enclose a solid', 'the result has no thickness']);
  for (const it of [...caseDocs, ...generated]) for (const f of runOrig(it, CFG0).result?.features ?? []) if (f.raw) raws.add(f.raw);
  const feats = [
    { id: 's1', kind: 'shell', target: 'b1', thickness: 2, open: { feature: 'b1', part: '+z' } }, { id: 's2', kind: 'shell', target: 'b1', thickness: 2 }, { id: 'd1', kind: 'draft', target: 'b1', angle: 5, face: { feature: 'b1', part: '+x' }, pull: 'z' },
    { id: 'd2', kind: 'draft', target: 'b1', angle: 5, whole: true, pull: 'x' }, { id: 'f1', kind: 'fillet', target: 'b1' }, { id: 'b1', kind: 'box' },
  ];
  let n = 0;
  for (const raw of raws) for (const f of feats) for (const c of [undefined, {}, { drafted: { id: 'd7' } }]) {
    assert.deepStrictEqual(attempt(() => port.sd.plainEngineText(raw, f, c)), attempt(() => orig.sd.plainEngineText(raw, f, c)), `${raw}`); n++;
  }
  assert.ok(raws.size > 25 && n > 400);
});

test('draftFromUsage: identical on every case script and on constructed texts', () => {
  const texts = CASES.map((c) => c.script).concat([
    '', 'draft(', 'draft(b.face("left"), 5, { from: "bottom" })', "draft(b.face('left'), 5, { from: 'top', neutral: 3 })", 'draft (x, { neutral : 2 }); draft(y, { from : "front" })',
    'draft(f(g(1)), { from: "left" })', 'draft(a, { from: "bottom"', 'x.draft(1)', 'redraft(1)', 'draft(\n  b.face("x"),\n  3,\n  { from: "back" }\n)',
  ]);
  for (const t of texts) assert.deepStrictEqual(attempt(() => port.sd.draftFromUsage(t)), attempt(() => orig.sd.draftFromUsage(t)), t);
  assert.ok(texts.some((t) => orig.sd.draftFromUsage(t).some((u) => u.from)), 'no script uses from:');
});

const byIdOf = (doc) => Object.fromEntries(doc.features.map((f) => [f.id, f]));
test('convexity and wordTie: identical on every feature of every corpus doc, with real and with random hole extents, and without arc / mt (thrown errors compared)', () => {
  const r = mulberry32(2024);
  let nc = 0; let nt = 0; let ties = 0; let convex = 0; const whys = new Set();
  const pool = [...caseDocs.map((c) => c.doc), ...generated.map((g) => g.doc)];
  for (const doc of pool) {
    const byId = byIdOf(doc);
    const holeExt = {}; for (const f of doc.features) if (f.kind === 'hole') holeExt[f.id] = [10 + r() * 30, 10 + r() * 30, 5 + r() * 20].map((v) => Math.round(v));
    for (const f of doc.features) {
      for (const he of [{}, holeExt, undefined]) {
        const x = attempt(() => orig.sd.convexity(f.id, byId, arc, he)); const y = attempt(() => port.sd.convexity(f.id, byId, arc, he));
        assert.deepStrictEqual(y, x, `convexity ${f.id}`); nc++;
        if (x.v) { if (x.v.convex) convex++; else whys.add(x.v.why); }
      }
      assert.deepStrictEqual(attempt(() => port.sd.convexity(f.id, byId, { outlineOf() { throw new Error('boom'); } }, {})), attempt(() => orig.sd.convexity(f.id, byId, { outlineOf() { throw new Error('boom'); } }, {})));
      for (const part of ['+x', '-x', '+y', '-y', '+z', '-z', 'side', 'bogus']) {
        const root = f;
        for (const m of [mt, undefined]) {
          const x = attempt(() => orig.sd.wordTie(root, part, byId, arc, m)); const y = attempt(() => port.sd.wordTie(root, part, byId, arc, m));
          assert.deepStrictEqual(y, x, `wordTie ${f.id} ${part}`); nt++;
          if (x.v) ties++;
        }
      }
    }
  }
  assert.ok(nc > 5000 && nt > 10000 && ties > 20 && convex > 100 && whys.size >= 8, `${nc} convexity calls, ${nt} wordTie calls, ${ties} ties, ${convex} convex, ${whys.size} reasons`);
  // wordTie on constructed roots that make ties (even prisms, turned boxes, a wedge, an extruded polygon)
  const mk = (extra) => ({ id: 'p1', center: [1, 2, 3], height: 10, ...extra });
  const roots = [mk({ kind: 'prism', sides: 4, radius: 8 }), mk({ kind: 'prism', sides: 6, radius: 8, rotate: [0, 0, 15] }), mk({ kind: 'prism', sides: 5, radius: 8 }), mk({ kind: 'prism', sides: 40, radius: 8 }), mk({ kind: 'prism', sides: 2, radius: 8 }),
    mk({ kind: 'box', size: [20, 20, 10], rotate: [0, 0, 45] }), mk({ kind: 'box', size: [20, 20, 10] }), mk({ kind: 'wedge', width: 12, depth: 8 }), mk({ kind: 'cylinder', radius: 4 })];
  for (const root of roots) for (const part of ['+x', '-x', '+y', '-y', '+z', '-z']) assert.deepStrictEqual(attempt(() => port.sd.wordTie(root, part, {}, arc, mt)), attempt(() => orig.sd.wordTie(root, part, {}, arc, mt)), `${root.kind} ${part}`);
});

// The original does not export its helpers. They are pure functions of their arguments, so they are compared one-to-one by reading the ORIGINAL file's text, pointing its one
// relative import at an absolute URL, appending an export list, and importing that copy from a temp directory. The original file on disk is not touched.
const internals = await (async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const file = path.join(contract, 'shell-draft-translate.mjs');
  const text = fs.readFileSync(file, 'utf8').replace("from '../phase0/translate.mjs'", `from '${pathToFileURL(path.join(root, 'docs/spikes/solidcraft-referee/phase0/translate.mjs')).href}'`)
    + '\nexport { polyConvex, hops, rootOf, rotPt, polyCentroid, simplePolygon, isPlainBox, onlyBoxJoins, tieOf, wholeFaces, sweepIn };\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-internals-'));
  const copy = path.join(dir, 'shell-draft-translate.copy.mjs');
  fs.writeFileSync(copy, text);
  try { return await imp(copy); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

test('the helpers the original does not export (hops, rootOf, rotPt, polyCentroid, polyConvex, simplePolygon, isPlainBox, onlyBoxJoins, wholeFaces, sweepIn), read from a copy of its text, agree with the port on generated inputs', () => {
  const r = mulberry32(777);
  const R = (lo, hi) => lo + r() * (hi - lo);
  const pickR = (a) => a[Math.floor(r() * a.length)];
  const O = internals; const S = port.sd;
  assert.equal(typeof O.simplePolygon, 'function');
  let n = 0;
  // polygons: convex, concave, bow-tie, collinear, repeated points, too short, with and without bulges
  const polys = [];
  for (let i = 0; i < 400; i++) {
    const k = pickR([2, 3, 4, 5, 6, 8]);
    const kind = pickR(['convex', 'random', 'star', 'collinear', 'dup']);
    let P;
    if (kind === 'convex') P = Array.from({ length: k }, (_, j) => [Math.round(10 * Math.cos(2 * Math.PI * j / k) * 4) / 4, Math.round(10 * Math.sin(2 * Math.PI * j / k) * 4) / 4]);
    else if (kind === 'star') P = Array.from({ length: k * 2 }, (_, j) => [(j % 2 ? 4 : 10) * Math.cos(Math.PI * j / k), (j % 2 ? 4 : 10) * Math.sin(Math.PI * j / k)]);
    else if (kind === 'collinear') P = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]].slice(0, Math.max(3, k));
    else if (kind === 'dup') P = [[0, 0], [0, 0], [10, 0], [10, 10]];
    else P = Array.from({ length: k }, () => [Math.round(R(-10, 10)), Math.round(R(-10, 10))]);
    polys.push(P);
  }
  for (const P of polys) {
    for (const bulges of [undefined, {}, { 0: 0 }, { 1: 0.4 }]) { assert.deepStrictEqual(attempt(() => S.polyConvex(P, bulges)), attempt(() => O.polyConvex(P, bulges))); n++; }
    assert.deepStrictEqual(attempt(() => S.simplePolygon(P)), attempt(() => O.simplePolygon(P))); n++;
    assert.deepStrictEqual(attempt(() => S.polyCentroid(P)), attempt(() => O.polyCentroid(P))); n++;
  }
  for (const bad of [undefined, null, [], [[0, 0]], [[0, 0], [1, 1]]]) { assert.deepStrictEqual(attempt(() => S.polyConvex(bad)), attempt(() => O.polyConvex(bad))); assert.deepStrictEqual(attempt(() => S.polyCentroid(bad)), attempt(() => O.polyCentroid(bad))); }
  for (let i = 0; i < 400; i++) {
    const p = [R(-20, 20), R(-20, 20), R(-20, 20)];
    const rot = pickR([undefined, [0, 0, 0], [90, 0, 0], [0, 45, 0], [0, 0, 30], [10, 20, 30], [180, 90, 270], [0.5, 0, -7]]);
    assert.deepStrictEqual(attempt(() => S.rotPt(p, rot)), attempt(() => O.rotPt(p, rot))); n++;
    const ang = R(-95, 95); const neutral = R(-10, 10); const lo = R(-20, 0); const hi = lo + R(0, 30);
    assert.deepStrictEqual(attempt(() => S.sweepIn(ang, neutral, lo, hi)), attempt(() => O.sweepIn(ang, neutral, lo, hi))); n++;
  }
  // isPlainBox: random measures
  for (let i = 0; i < 400; i++) {
    const bb = [0, 0, 0, R(1, 20), R(1, 20), R(1, 20)]; const bv = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]);
    const m = pickR([undefined, null, { faces: 6, faceTypes: { plane: 6 }, bbox: bb, volume: bv }, { faces: 6, faceTypes: { plane: 6 }, bbox: bb, volume: bv * (1 - 1e-8) }, { faces: 6, faceTypes: { plane: 5 }, bbox: bb, volume: bv }, { faces: 7, faceTypes: { plane: 6 }, bbox: bb, volume: bv }, { faces: 6, bbox: bb, volume: bv }, { faces: 6, faceTypes: { plane: 6 }, bbox: bb, volume: bv * (1 + 1e-12) }]);
    assert.deepStrictEqual(attempt(() => S.isPlainBox(m)), attempt(() => O.isPlainBox(m))); n++;
  }
  // histories and roots: every feature of every corpus doc as the start, and as the end of a hops() walk
  for (const doc of [...caseDocs.map((c) => c.doc), ...generated.map((g) => g.doc)]) {
    const byId = byIdOf(doc);
    const ids = [...doc.features.map((f) => f.id), 'nope', undefined];
    for (const id of ids) {
      assert.deepStrictEqual(attempt(() => S.rootOf(id, byId)), attempt(() => O.rootOf(id, byId))); n++;
      assert.deepStrictEqual(attempt(() => S.onlyBoxJoins(id, byId)), attempt(() => O.onlyBoxJoins(id, byId))); n++;
      for (const from of [doc.features[0]?.id, 'nope', undefined]) { assert.deepStrictEqual(attempt(() => S.hops(from, id, byId)), attempt(() => O.hops(from, id, byId))); n++; }
    }
    for (const f of doc.features) for (const m of [mt, undefined]) {
      assert.deepStrictEqual(attempt(() => S.wholeFaces(f, byId, { arc, mt: m })), attempt(() => O.wholeFaces(f, byId, { arc, mt: m }))); n++;
    }
  }
  assert.ok(n > 30000, `${n} comparisons`);
  // a cyclic history terminates identically
  const loop = { a: { id: 'a', kind: 'move', target: 'b' }, b: { id: 'b', kind: 'move', target: 'a' } };
  assert.deepStrictEqual(attempt(() => S.hops('zz', 'a', loop)), attempt(() => O.hops('zz', 'a', loop)));
  assert.deepStrictEqual(attempt(() => S.onlyBoxJoins('a', loop)), attempt(() => O.onlyBoxJoins('a', loop)));
  assert.deepStrictEqual(attempt(() => S.rootOf('a', loop)), attempt(() => O.rootOf('a', loop)));
  tally.internals = n;
});

// ---- composition: the three sets together ----------------------------------------------------------------------------------------------------------------------------
// The question: does adding 'shell-draft' to ['extrude-pocket', 'holes'] change a result of those two sets on their own corpora? The baseline is therefore the existing
// composition ['extrude-pocket', 'holes'] (fold 2 listed what that composition itself changes against each set alone), and the candidate adds the third entry.
const COMP3 = port.tr.createTranslator({ planners: ['extrude-pocket', 'holes', 'shell-draft'] });
const COMP2 = port.tr.createTranslator({ planners: ['extrude-pocket', 'holes'] });
const strip = (r) => { if (!r) return r; const { _state, spentS, ...rest } = r; return rest; };
async function runSet(tr, item, fake, withResolver) {
  const f = makeFake(fake);
  const ctx = { arc, skipSketchVolume: true, skipOpenOutline: true, skipMoveTurn: true, skipPrimitives: true, mt, runSC: f.runSC, topologyOf: f.topologyOf, soups: {}, ...(withResolver ? { resolveAt: fakeResolveAt } : {}), ...(item.fromUsage ? { fromUsage: item.fromUsage } : {}) };
  let result = null; let error = null;
  try { result = strip(await tr.translateDoc(structuredClone(item.doc), ctx)); } catch (e) { error = errOf(e); }
  return { result, error, log: f.log };
}
const conflicts = { ep: { docs: 0, withShellDraft: 0, differ: [] }, holes: { docs: 0, withShellDraft: 0, differ: [] }, sd: { docs: 0, shellDraftFeatures: 0, shellDraftDiffer: [], otherKindsDiffer: 0, otherKindsStatusDiffer: [], causes: {} }, plainDocsUnchanged: 0 };
const isSD = (k) => k === 'shell' || k === 'draft';

/** `a` = ['extrude-pocket','holes'], `b` = the same plus 'shell-draft', one doc: results of kinds the earlier sets own that differ, and whether a shell/draft result before it differs */
function earlierKindDiffs(a, b) {
  const out = [];
  if (a.error !== b.error) { out.push({ why: `thrown: ${a.error} / ${b.error}`, downstream: false }); return out; }
  const fa = a.result?.features ?? []; const fb = b.result?.features ?? [];
  let sdBefore = false;
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const x = fa[i]; const y = fb[i];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const kind = x?.kind ?? y?.kind;
    if (isSD(kind)) { sdBefore = true; continue; }
    out.push({ why: `${x?.id} (${kind}): ${x?.status}/${x?.guard ?? '-'} vs ${y?.status}/${y?.guard ?? '-'}`, downstream: sdBefore });
  }
  return out;
}

test('composition [extrude-pocket, holes, shell-draft] against [extrude-pocket, holes] on THEIR corpora: a doc without shell or draft is untouched; every changed result of an earlier set in the others is listed', async () => {
  const epItems = [...Array.from({ length: 120 }, (_, i) => ({ name: `ep seed ${5000 + i}`, doc: epDoc(5000 + i) })), ...hand];
  const holeItems = Array.from({ length: 300 }, (_, i) => ({ name: `hole seed ${i}`, doc: holeDoc(i) }));
  for (const [label, items, fake] of [['ep', epItems, { boxBool: true }], ['holes', holeItems, { holeModel: true, boxBool: true }]]) {
    for (const item of items) {
      const a = await runSet(COMP2, item, fake, false); const b = await runSet(COMP3, item, fake, false);
      conflicts[label].docs++;
      const hasSd = item.doc.features.some((f) => isSD(f.kind));
      if (!hasSd) {
        assert.deepStrictEqual(b.error, a.error, item.name); assert.deepStrictEqual(b.result, a.result, `${item.name}: adding shell-draft changed a doc without shell or draft`); assert.deepStrictEqual(b.log, a.log, item.name);
        conflicts.plainDocsUnchanged++;
        continue;
      }
      conflicts[label].withShellDraft++;
      for (const d of earlierKindDiffs(a, b)) conflicts[label].differ.push({ name: item.name, ...d });
    }
  }
  assert.ok(conflicts.plainDocsUnchanged > 400, `${conflicts.plainDocsUnchanged} plain docs`);
  assert.ok(conflicts.ep.withShellDraft + conflicts.holes.withShellDraft > 5);
});

test('composition on the shell-draft corpus: where the earlier sets\' hooks change a shell-draft result or the guard\'s bookkeeping (listed, not resolved)', async () => {
  const items = [...generated, ...caseDocs.filter((_, i) => i % 3 === 0)].filter((it) => !differences(it.doc).length);
  for (const item of items) {
    const a = await runSet(SD, item, CFG0.fake, true); const b = await runSet(COMP3, item, CFG0.fake, true);
    conflicts.sd.docs++;
    if (a.error !== b.error) { bump(conflicts.sd.causes, `thrown: ${a.error} / ${b.error}`); continue; }
    const fa = a.result?.features ?? []; const fb = b.result?.features ?? [];
    const norm = (f) => JSON.stringify({ ...f, measure: f.measure ? { ...f.measure, shells: undefined } : undefined });
    for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
      const x = fa[i]; const y = fb[i];
      if (isSD(x?.kind)) {
        conflicts.sd.shellDraftFeatures++;
        if (norm(x) !== norm(y)) { const c = `${x.kind} ${x.status}${x.guard ? '/' + x.guard : ''} (shell-draft alone) vs ${y?.status}${y?.guard ? '/' + y.guard : ''} (composition)`; bump(conflicts.sd.causes, c); conflicts.sd.shellDraftDiffer.push({ name: item.name, id: x.id, cause: c }); }
      } else if (JSON.stringify(x) !== JSON.stringify(y)) {
        conflicts.sd.otherKindsDiffer++; // by the order rule: an unlisted kind is planned and worded by the FIRST entry (extrude-pocket), so its note carries other fields
        if (x?.status !== y?.status || x?.guard !== y?.guard) conflicts.sd.otherKindsStatusDiffer.push({ name: item.name, id: x?.id, kind: x?.kind, a: `${x?.status}/${x?.guard ?? '-'}`, b: `${y?.status}/${y?.guard ?? '-'}` });
      }
    }
  }
  assert.ok(conflicts.sd.docs > 600);
});

// ---- the numbers, printed once the whole run is done --------------------------------------------------------------------------------------------------------------------
test('summary', () => {
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((x, y) => y[1] - x[1]));
  const lines = [
    `corpus (a): ${tally.cases_?.cases} cases, ${tally.cases_?.docs} become ModelDocs (${tally.cases_?.noDoc} scripts do not run), ${tally.byCorpus.cases.inSet} in the equality set`,
    `corpus (b): ${generated.length} generated docs, ${tally.byCorpus.generated.inSet} in the set; hand docs: ${hand.length}, ${tally.byCorpus.hand.inSet} in the set`,
    `in-set docs ${tally.inSet.docs}, translateDoc comparisons ${tally.cases}, all identical (${tally.identical}); ${tally.thrown} end in the same thrown error; ${tally.calls} engine calls compared`,
    `thrown errors (same on both sides): ${JSON.stringify(tally.errors ?? {})}`,
    `named picks (a shell's open face, a draft's face) in the equality set: ${tally.picks.named}`,
    `built ${JSON.stringify(sortObj(tally.built))}  refused ${JSON.stringify(sortObj(tally.refused))}`,
    `guards fired (refusals): ${JSON.stringify(sortObj(tally.guards))}`,
    `excluded docs (phase0 and phase 4 differ on a feature other than shell/draft): ${tally.excluded.docs} ${JSON.stringify(tally.excluded.kinds)}; of them the port differs from the original on ${tally.excluded.differ}, agrees on ${tally.excluded.agree}`,
    `switching a guard off: ${JSON.stringify(tally.offDiffer)}`,
    `negative controls detected on (docs of 60): ${JSON.stringify(tally.negctl)}`,
    `topology path (no resolver) on ${tally.pathB.docs} named-pick docs: identical to the original (pickedFrom ignored) on ${tally.pathB.same}, differs on ${tally.pathB.differ}`,
    `  by corpus: ${JSON.stringify({ cases: { ...tally.pathB.cases, causes: undefined }, generated: { ...tally.pathB.generated, causes: undefined } })}`,
    `  causes, group cases: ${JSON.stringify(sortObj(tally.pathB.cases?.causes ?? {}))}`,
    `  causes, generated: ${JSON.stringify(sortObj(tally.pathB.generated?.causes ?? {}))}`,
    `composition [extrude-pocket, holes, shell-draft] vs [extrude-pocket, holes]: extrude-pocket corpus ${conflicts.ep.docs} docs (${conflicts.ep.withShellDraft} with a shell or draft), holes corpus ${conflicts.holes.docs} docs (${conflicts.holes.withShellDraft} with a shell or draft); docs without shell/draft identical in full: ${conflicts.plainDocsUnchanged}; changed results of an earlier set in the others: ep ${conflicts.ep.differ.length}, holes ${conflicts.holes.differ.length}`,
    `composition vs shell-draft alone on ${conflicts.sd.docs} shell-draft docs: ${conflicts.sd.shellDraftFeatures} shell/draft features compared, ${conflicts.sd.shellDraftDiffer.length} differ ${JSON.stringify(conflicts.sd.causes)}; features of other kinds whose note differs (first-entry rule): ${conflicts.sd.otherKindsDiffer}, of which a different status or guard: ${conflicts.sd.otherKindsStatusDiffer.length}`,
    `excluded fillet/soup docs: shell and draft decisions (status, guard) agree on ${tally.excluded.sdAgree} of ${tally.excluded.sdChecked}; guards shared there: ${JSON.stringify(tally.excluded.sharedGuards)}`,
    `pure helpers compared one-to-one: ${tally.internals} comparisons`,
    `sentences seen (shape-normalised): ${tally.sentences.size}`,
  ];
  console.log('\n' + lines.join('\n'));
  for (const [label, c] of [['extrude-pocket', conflicts.ep], ['holes', conflicts.holes]]) for (const d of c.differ) console.log(`CONFLICT in the ${label} corpus: ${d.name}: ${d.why}${d.downstream ? ' [after a shell/draft result that differs]' : ' [DIRECT]'}`);
  if (process.env.SD_SHOW_PATHB) for (const [c, ex] of Object.entries(tally.pathB.examples ?? {})) for (const e of ex) console.log(`PATHB ${c}: ${JSON.stringify(e)}`);
  for (const d of conflicts.sd.shellDraftDiffer) console.log(`CONFLICT on a shell/draft in the shell-draft corpus: ${d.name}: ${d.id}: ${d.cause}`);
  for (const d of conflicts.sd.otherKindsStatusDiffer) console.log(`CONFLICT in the shell-draft corpus: ${d.name}: ${d.id} (${d.kind}) ${d.a} (shell-draft alone) vs ${d.b} (composition)`);
  assert.equal(tally.cases, tally.identical);
  assert.ok(N_CATEGORIES > 0);
});
