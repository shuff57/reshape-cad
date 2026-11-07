// DIFFERENTIAL TEST for the fillet-chamfer fold: the ORIGINAL group translator (docs/spikes/solidcraft-referee/contract/fillet-chamfer-evidence/live/lib/translate-fc.mjs with fc-guard.mjs and fc-sentences.mjs, all untouched,
// switched on exactly as the group's host switches it: ctx.fc = { guard: true, group: true, lib }, and its refusals mapped to the group's plain sentences the way live/fc-page.mjs maps them) against the compiled TypeScript
// port in 'fillet-chamfer' mode (createTranslator({ planners: 'fillet-chamfer' })). Both are fed the same ModelDocs through the same deterministic FAKE engine (test/fake-engine.mjs, no kernel, no wasm; its opt-in fcModel makes
// a blend add a face and puts the measure in the topology reply, as the group's host does) and must produce IDENTICAL output: the translateDoc result (features, commands), the ordered list of engine calls (runSC AND topologyOf, with
// their commands) and a thrown error.
//
// HOW THE NOTES ARE COMPARED. The original keeps a raw refusal text and its host maps it; the port's refusal IS the mapped sentence, so the original's notes are mapped first (the test does what fc-page.mjs does: guardSentence for a
// guard's verdict, plainSentence for any other text, and a whole-shape round that was refused is a refused note with the plain primitive standing). The original's `guard` object is the port's `fc`; the port's `guard` is the CODE
// (FC-...), checked apart. A group's notes are in document order in the port; the original emits them component by component, so the original's are put in document order first.
//
// ONE NAMED EXCEPTION (owner decision: a guard that skips its check because an input is missing must refuse or run instead). The original skips the post-build face count when the topology reply carries no measure
// (`facesBefore != null`); the port takes the count from the measure it holds for the part. In a configuration whose topology reply has no measure, the port may therefore differ at the FIRST differing feature, and only where it
// refuses a straight planar blend with FC-FACE-COUNT and the original built it. Everything before is identical; the test fails if the exception never fires and fails on any other difference.
//
// This shows the port equals the original on the inputs below. It does NOT show that a built solid is right: the fake has no geometry kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFake } from './fake-engine.mjs';
import { handDocs, generatedDoc } from './docs.mjs';
import { box, cyl, rect, pocket, fillet, shell, move, between, prim, hole } from './docs.mjs';
import { fcDoc, N_THEMES } from './fc-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const contract = path.join(root, 'docs/spikes/solidcraft-referee/contract');
const fcDir = path.join(contract, 'fillet-chamfer-evidence');
const imp = (p) => import(pathToFileURL(p).href);
const orig = { tr: await imp(path.join(fcDir, 'live/lib/translate-fc.mjs')), guard: await imp(path.join(fcDir, 'fc-guard.mjs')), sent: await imp(path.join(fcDir, 'fc-sentences.mjs')) };
const dist = (f) => imp(path.join(here, '../dist', f));
const port = { tr: await dist('translator.js'), fc: await dist('fillet-chamfer.js'), g: await dist('fc-guard.js'), s: await dist('fc-sentences.js') };
const FCSET = port.tr.createTranslator({ planners: 'fillet-chamfer' });
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
const { runScript } = await imp(path.join(root, 'packages/script/dist/reshape-script.js'));
const { solveDoc } = await imp(path.join(root, 'packages/script/dist/model-codegen.js'));

// ---- engine configurations ------------------------------------------------------------------------------------------------------------------
const ALL = { boxBool: true, holeModel: true, shellDraft: true, pmModel: true, boolModel: true, rgModel: true };
const CONFIGS = [
  { name: 'fcModel (a blend adds a face, the topology reply carries the measure), mt', fake: { fcModel: true }, useMt: true },
  { name: 'default fake (no measure in the topology reply), mt', fake: {}, useMt: true, noMeasure: true },
  { name: 'fcModel noface (a blend that adds no face), mt', fake: { fcModel: 'noface' }, useMt: true },
  { name: 'fcModel, every 5th call fails, no mt', fake: { fcModel: true, failEvery: 5 }, useMt: false },
  { name: 'all models + fcModel, mt', fake: { ...ALL, fcModel: true }, useMt: true },
  { name: 'fcModel, the bridge dies on every 7th call (bridge error path), mt', fake: { fcModel: true, throwWhen: (cmds, k) => k % 7 === 0 }, useMt: true },
  { name: 'fcModel, the topology is down on every 3rd topology call, mt', fake: { fcModel: true }, useMt: true, topoDown: 3 },
];

const same = (x, y) => { try { assert.deepStrictEqual(x, y); return true; } catch { return false; } };
const errOf = (e) => `${e?.constructor?.name}: ${e?.message}`;
const norm = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const withTopoDown = (fake, k) => {
  if (!k) return fake.topologyOf;
  let n = 0;
  return async (cmds) => (++n % k === 0 ? { ok: false, error: 'fake: topology down' } : fake.topologyOf(cmds));
};

/** the original's result as the group's host (fc-page.mjs) shows it, in document order */
function viewOrig(tr, doc) {
  const at = (id) => doc.features.findIndex((x) => x.id === id);
  const feats = tr.features.map((f) => {
    const { partialGuard, guard, ...rest } = f;
    const st = /^bevel|^chamfer/.test(f.id) ? 'bevel' : 'round';
    if (partialGuard) return { ...rest, status: 'refused', refusal: orig.sent.guardSentence(partialGuard, f.id, st) ?? `${f.id} (${f.kind}): GUARD ${partialGuard.code}`, fc: partialGuard, partial: true };
    if (f.status !== 'refused') return rest;
    let sentence;
    if (guard) sentence = orig.sent.guardSentence(guard, f.id, st);
    else {
      const sctx = {};
      const m = (f.refusal ?? '').match(/an operation after (\S+) changed or removed it/);
      const i = at(f.id);
      if (m && i >= 0) {
        const from = at(m[1]);
        sctx.causes = doc.features.slice(from + 1, i).filter((x) => !['sketch', 'extrude', 'datum'].includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, style: x.style, size: x.size }));
        sctx.self = { style: doc.features[i].style, size: doc.features[i].size };
      }
      sentence = orig.sent.plainSentence(f.refusal ?? '', sctx).sentence;
    }
    return { ...rest, refusal: sentence ?? f.refusal, ...(guard ? { fc: guard } : {}) };
  });
  const order = (f) => at(f.id);
  return { features: feats.map((f, i) => [f, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map((x) => x[0]), commands: tr.commands };
}
async function runOrig(item, cfg) {
  const fake = makeFake({ ...cfg.fake });
  const doc = structuredClone(item.doc);
  let result; let error = null; const soups = {};
  try {
    const ctx = { arc, skipSketchVolume: true, ...(cfg.useMt ? { mt } : {}), runSC: fake.runSC, topologyOf: withTopoDown(fake, cfg.topoDown), soups, fc: { guard: true, group: true, lib: orig.guard } };
    const res = await orig.tr.translateDoc(doc, ctx);
    result = norm(viewOrig(res, item.doc));
  } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, soups };
}
/** the port's result: `guard` (the code) taken out */
function viewPort(rest) {
  const guards = []; const feats = rest.features.map((f) => { const { guard, ...r } = f; guards.push(guard ?? null); return r; });
  return { view: { features: feats, commands: rest.commands }, guards };
}
async function runPort(tr, item, cfg, extra = {}) {
  const fake = makeFake({ ...cfg.fake });
  const optsLog = [];
  const runSC = (cmds, opts) => { optsLog.push(opts ?? null); return fake.runSC(cmds, opts); };
  const soups = {};
  const ctx = { arc, skipSketchVolume: true, runSC, topologyOf: withTopoDown(fake, cfg.topoDown), soups, ...(cfg.useMt ? { mt } : {}), ...extra };
  let result; let error = null; let guards = [];
  try {
    const { _state, ...rest } = await tr.translateDoc(structuredClone(item.doc), ctx);
    assert.ok(_state);
    const v = viewPort(rest); guards = v.guards; result = norm(v.view);
  } catch (e) { error = errOf(e); }
  return { result, error, log: fake.log, guards, optsLog, soups };
}

// ---- corpora ------------------------------------------------------------------------------------------------------------------------------------
const caseFiles = ['cases.mjs', 'cases-r2.mjs', 'cases-r2b.mjs', 'cases-r2c.mjs', 'cases-r3.mjs', 'cases-r3f.mjs', 'cases-seq.mjs', 'cases-fc.mjs', 'live/fc4-cases-a.mjs', 'live/fc4-cases-b.mjs', 'live/fc4-cases-c.mjs', 'live/fc4-cases-regress.mjs'];
const caseDocs = []; const caseSkipped = []; const seenCase = new Set();
const addCase = (c) => {
  const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.doc)}`; if (seenCase.has(key)) return; seenCase.add(key);
  if (c.doc) { caseDocs.push({ name: `case ${c.id}`, doc: solveDoc({ version: 1, features: c.doc.features ?? c.doc }) }); return; }
  if (typeof c.script !== 'string') return;
  const r = runScript(c.script);
  if (r.errors.length) { caseSkipped.push([c.id, r.errors[0].message]); return; }
  caseDocs.push({ name: `case ${c.id}`, doc: solveDoc(r.doc) });
};
for (const f of caseFiles) { try { for (const c of (await imp(path.join(fcDir, f))).CASES) addCase(c); } catch (e) { caseSkipped.push([f, String(e.message).slice(0, 80)]); } }
// the three fuzz kinds of the group's own generator (read from the environment at load: three copies of the module)
{
  const keep = { FZ: process.env.FZ, SEED: process.env.SEED, N: process.env.N };
  for (const fz of ['single', 'group', 'pocket']) { process.env.FZ = fz; process.env.SEED = '2027'; process.env.N = '100'; for (const c of (await import(`${pathToFileURL(path.join(fcDir, 'live/fc4-cases-fuzz.mjs')).href}?fz=${fz}`)).CASES) addCase(c); }
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
const N_GEN = 600;
const generated = Array.from({ length: N_GEN }, (_, i) => ({ name: `fc seed ${i}`, doc: fcDoc(i) }));
const hand = handDocs().map(([name, doc]) => ({ name: `hand ${name}`, doc }));
const baseGen = Array.from({ length: 160 }, (_, i) => ({ name: `generated seed ${1000 + i}`, doc: generatedDoc(1000 + i) }));

// hand-written docs aimed at single guards
const B = (id, d = [40, 30, 20]) => box(id, d, [0, 0, 0]);
const E = (host, a, b) => between(host, prim(host, a), prim(host, b));
const F = (id, target, host, a, b, size, style = 'fillet') => fillet(id, target, E(host, a, b), size, style);
const aimed = [
  ['too-small: a blend of 0.005, a bevel of 0', [B('b1'), F('round1', 'b1', 'b1', '+z', '+x', 0.005), B('b2'), F('bevel1', 'b2', 'b2', '+z', '+x', 0, 'chamfer')]],
  ['too-big: a blend as big as the face, the neighbour, past the cylinder radius and height', [B('b1', [40, 30, 6]), F('round1', 'b1', 'b1', '+z', '-y', 6), B('b2', [40, 30, 6]), F('round2', 'b2', 'b2', '+y', '+z', 3.5), cyl('c1', 5, 3), fillet('round3', 'c1', E('c1', '+z', 'side'), 4.5), cyl('c2', 5, 3), fillet('round4', 'c2', E('c2', '+z', 'side'), 3)]],
  ['crowded: two edges of one face that do not touch, the edges of a group, the same edge twice', [B('b1', [40, 20, 30]), F('round1', 'b1', 'b1', '+z', '-y', 12), F('round2', 'round1', 'b1', '+z', '+x', 12), F('round3', 'round2', 'b1', '+z', '+y', 12), B('b2'), F('round4', 'b2', 'b2', '+z', '-y', 2), F('round5', 'round4', 'b2', '+z', '-y', 2)]],
  ['corner3: three bevels meeting at a corner, and as a fillet', [B('b1'), F('bevel1', 'b1', 'b1', '+z', '-y', 2, 'chamfer'), F('bevel2', 'bevel1', 'b1', '+z', '+x', 2, 'chamfer'), F('bevel3', 'bevel2', 'b1', '-y', '+x', 2, 'chamfer'), B('b2'), F('round1', 'b2', 'b2', '+z', '-y', 2), F('round2', 'round1', 'b2', '+z', '+x', 2), F('round3', 'round2', 'b2', '-y', '+x', 2)]],
  ['knife-edge rim: a hollow after a round as big as the wall, a bevel as big as the wall, a smaller round', [B('b1'), F('round1', 'b1', 'b1', '+z', '+x', 2), shell('s1', 'round1', prim('b1', '+z'), 2), B('b2'), F('bevel1', 'b2', 'b2', '+z', '+x', 2, 'chamfer'), shell('s2', 'bevel1', prim('b2', '+z'), 2), B('b3'), F('round2', 'b3', 'b3', '+z', '+x', 1), shell('s3', 'round2', prim('b3', '+z'), 2)]],
  ['whole-shape round: a bevelled box, a negative, a zero, a tiny, a valid, on a cylinder and a sphere', [box('b1', [20, 20, 10], [0, 0, 0], { round: 2, roundStyle: 'chamfer' }), box('b2', [20, 20, 10], [0, 0, 0], { round: -1 }), box('b3', [20, 20, 10], [0, 0, 0], { round: 0 }), box('b4', [20, 20, 10], [0, 0, 0], { round: 0.005 }), box('b5', [20, 20, 10], [0, 0, 0], { round: 2 }), cyl('c1', 8, 12, [0, 0, 0], { round: 1, roundStyle: 'chamfer' }), { id: 's1', kind: 'sphere', radius: 6, center: [0, 0, 0], round: 0 }]],
  ['a blend after a refused blend, after a hole, after a pocket, after a move, of a sketch', [B('b1'), F('round1', 'b1', 'b1', '+z', '+x', 9), F('round2', 'round1', 'b1', '+z', '+y', 1), B('b2', [30, 30, 10]), hole('h1', 'b2', {}), F('round3', 'b2', 'b2', '+z', '+x', 1), B('b3', [30, 30, 10]), rect('sk', 5, 5), pocket('pk1', 'sk', 'b3', 3), F('round4', 'b3', 'b3', '+z', '+x', 1), B('b4'), move('m1', 'b4', [3, 0, 0]), F('round5', 'b4', 'b4', '+z', '+x', 1), rect('sk2', 5, 5), fillet('round6', 'sk2', E('b4', '+z', '+x'), 1)]],
  ['malformed: a blend with no edge, no target, a text size, a NaN size', [B('b1'), { id: 'round1', kind: 'fillet', target: 'b1', size: 1, style: 'fillet' }, { id: 'round2', kind: 'fillet', edge: E('b1', '+z', '+x'), size: 1, style: 'fillet' }, F('round3', 'b1', 'b1', '+z', '+x', 'big'), F('round4', 'b1', 'b1', '+z', '+x', NaN)]],
  ['a group whose target was refused, a group of a bad name, a group after a move', [B('b1'), F('round1', 'b1', 'b1', '+z', '+x', 9), F('round2', 'round1', 'b1', '+z', '+y', 9), B('b2'), fillet('round3', 'b2', E('zz', '+z', '+x'), 1), fillet('round4', 'round3', E('zz', '+z', '+y'), 1), B('b3'), move('m1', 'b3', [2, 0, 0]), F('round5', 'm1', 'b3', '+z', '+x', 1), F('round6', 'round5', 'b3', '+z', '+y', 1)]],
];
const aimedDocs = aimed.map(([name, features]) => ({ name: `aimed ${name}`, doc: { version: 1, features } }));

const tally = {
  cases: 0, identical: 0, thrown: 0, built: {}, refused: {}, guards: {}, sentences: new Set(), calls: 0, groups: 0, grouped: 0, partial: 0,
  noMeasure: { runs: 0, docs: new Set() }, byCorpus: {}, optsBad: [], errors: {},
};
const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const shape = (s) => String(s).replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#').replace(/\b(sk|e|p|b|c|s|h|m|r|x|f|d|pk|pa|mi|u|sph|cyl|ghost|t|v|k|n|w|j|z|g|round|bevel)\d*\b/g, '$1');
function note(a, b) {
  for (const f of a.result?.features ?? []) {
    if (f.status === 'built') bump(tally.built, f.kind);
    if (f.status === 'built' && f.group) tally.grouped++;
    if (f.partial) tally.partial++;
    if (f.status === 'refused') { bump(tally.refused, f.kind); tally.sentences.add(shape(f.refusal)); }
  }
  tally.groups += new Set((a.result?.features ?? []).filter((f) => f.group).map((f) => f.group.join(','))).size;
  for (const g of b.guards) bump(tally.guards, g ?? '(none)');
}
async function compareDoc(name, item, cfg) {
  const a = await runOrig(item, cfg);
  const b = await runPort(FCSET, item, cfg);
  tally.cases++;
  // NAMED EXCEPTION: no measure in the topology reply, the original skips the face count and the port runs it.
  if (cfg.noMeasure && !same([b.result, b.error], [a.result, a.error])) {
    const af = a.result?.features ?? []; const bf = b.result?.features ?? [];
    const k = bf.findIndex((x, j) => !same(x, af[j]));
    const ok = !a.error && !b.error && k >= 0 && bf[k].status === 'refused' && bf[k].fc?.code === 'face-count' && b.guards[k] === 'FC-FACE-COUNT' && af[k]?.status === 'built';
    assert.ok(ok, `${name} [${cfg.name}]: differs from the original beyond the named missing-measure exception: ${JSON.stringify([bf[k], af[k]]).slice(0, 600)}`);
    tally.noMeasure.runs++; tally.noMeasure.docs.add(name);
    return { a, b };
  }
  assert.deepStrictEqual(b.error, a.error, `${name} [${cfg.name}]: thrown error differs`);
  assert.deepStrictEqual(b.result, a.result, `${name} [${cfg.name}]: translateDoc result differs`);
  assert.deepStrictEqual(b.log, a.log, `${name} [${cfg.name}]: engine call sequence differs`);
  assert.deepStrictEqual(b.soups, a.soups, `${name} [${cfg.name}]: ctx.soups differs`);
  assert.ok(b.optsLog.every((o) => o === null), `${name} [${cfg.name}]: the set passed options to the engine`);
  tally.identical++; tally.calls += a.log.length;
  if (a.error) { tally.thrown++; bump(tally.errors, a.error); }
  note(a, b);
  return { a, b };
}
async function runCorpus(label, items) {
  tally.byCorpus[label] = items.length;
  for (const item of items) for (const cfg of CONFIGS) await compareDoc(item.name, item, cfg);
}

test('the set exists, is a member of nothing else by accident, and the default stays base', () => {
  assert.equal(FCSET.planners, 'fillet-chamfer');
  assert.equal(port.tr.createTranslator().planners, 'base');
  assert.ok(Object.keys(port.tr.PROFILES).includes('fillet-chamfer'));
  assert.deepStrictEqual(port.fc.FC_KINDS, ['fillet']);
  assert.deepStrictEqual(port.fc.FC_CROSS_KIND_GUARDS, ['FC-KNIFE-RIM', 'FC-WHOLE-CHAMFER', 'FC-NEGATIVE', 'FC-TOO-SMALL']);
  // a fillet is planned asynchronously (the guard reads the topology): planFeature must not fall back to the unguarded planner
  assert.throws(() => FCSET.planFeature({ id: 'f1', kind: 'fillet', target: 'b1', edge: {}, size: 1, style: 'fillet' }, { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, accLen: {} }, { arc, skipSketchVolume: true, runSC: () => ({ ok: true }), resolve: () => null }), /plans a fillet asynchronously/);
});

test('(a) every case of the group that turns into a ModelDoc', { timeout: 3_000_000 }, async () => {
  assert.ok(caseDocs.length > 1000, `only ${caseDocs.length} case docs`);
  await runCorpus('cases', caseDocs);
});
test('(b) aimed docs, the base hand docs, 160 base-generated docs and 600 generated docs', { timeout: 3_000_000 }, async () => {
  await runCorpus('aimed', aimedDocs);
  await runCorpus('hand', hand);
  await runCorpus('base-generated', baseGen);
  await runCorpus('generated', generated);
});

test('the guards are able to fail: the fake with no face added is refused by the post-build net, and the fail-open is closed', async () => {
  const feats = [B('b1'), F('round1', 'b1', 'b1', '+z', '+x', 1)];
  const item = { doc: { version: 1, features: feats } };
  const ok = await runPort(FCSET, item, CONFIGS[0]);
  assert.equal(ok.result.features[1].status, 'built');
  const noFace = await runPort(FCSET, item, CONFIGS[2]);
  assert.equal(noFace.result.features[1].status, 'refused');
  assert.equal(noFace.guards[1], 'FC-FACE-COUNT');
  assert.match(noFace.result.features[1].refusal, /did not give the part the new face it should/);
  // the missing-measure fail-open: with no measure in the topology reply the port still runs the count (from its own measure of the part)
  const noMeasure = await runPort(FCSET, item, CONFIGS[1]);
  assert.equal(noMeasure.guards[1], 'FC-FACE-COUNT', 'the face count runs without a measure in the reply');
  const orgNoMeasure = await runOrig(item, CONFIGS[1]);
  assert.equal(orgNoMeasure.result.features[1].status, 'built', 'the original skips the check (the fail-open)');
});

// ---- the pure guard and the sentences equal the original on real and random inputs ----------------------------------------------------------------
const rnd = (k) => { let a = k; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; };
test('the guard equals the original on the 705 real topologies of the group (every edge, several sizes, both styles, random groups)', { timeout: 1_800_000 }, () => {
  const topoAll = JSON.parse(fs.readFileSync(path.join(fcDir, 'fc-topo.json'), 'utf8'));
  const r = rnd(4242);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const codes = {}; let verdicts = 0; let groups = 0;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  for (const key of Object.keys(topoAll)) {
    for (const body of topoAll[key].bodies) {
      if (body.error || !body.edges.length) continue;
      const ta = { faces: body.faces, edges: body.edges }; const tb = clone(ta);
      for (const e of body.edges) {
        for (const size of [0.005, 0.3, 1, 2.5, 6, 20]) for (const style of ['fillet', 'chamfer']) {
          const ga = orig.guard.guardBlend(ta, e.mid, size, style); const gb = port.g.guardBlend(tb, e.mid, size, style);
          assert.deepStrictEqual(norm(gb), norm(ga), `guardBlend ${key} ${e.name} ${size} ${style}`);
          verdicts++; bump(codes, ga.ok ? `ok:${ga.rule}` : ga.code);
        }
      }
      for (let g = 0; g < 8 && body.edges.length > 1; g++) {
        const picks = Array.from({ length: 2 + Math.floor(r() * 4) }, () => pick(body.edges).mid);
        const size = pick([0.3, 1, 2.5, 6]); const style = pick(['fillet', 'chamfer']);
        const ga = orig.guard.guardBatch(ta, picks, size, style); const gb = port.g.guardBatch(tb, picks, size, style);
        assert.deepStrictEqual(norm(gb), norm(ga), `guardBatch ${key}`);
        groups++; bump(codes, ga.ok ? `ok:${ga.rule}` : `batch:${ga.code}`);
      }
      // a pick off the edge, near it and far
      for (const off of [0.001, 0.4, 50]) { const p = body.edges[0].mid.map((v) => v + off); assert.deepStrictEqual(norm(port.g.guardBlend(tb, p, 1, 'fillet')), norm(orig.guard.guardBlend(ta, p, 1, 'fillet'))); }
    }
  }
  console.log(`# fc-guard on real topologies: ${verdicts} single verdicts and ${groups} groups equal; codes reached ${JSON.stringify(codes)}`);
  for (const c of ['too-small', 'too-big', 'in-the-way', 'ok:planar', 'ok:rim']) assert.ok(codes[c] > 0, `${c} never reached on the real topologies`);
});
test('the guard equals the original on perturbed topologies (extra boundary edges, curved faces, cut edges, pieces) so the rules R1-R7 are all reached', () => {
  const topoAll = JSON.parse(fs.readFileSync(path.join(fcDir, 'fc-topo.json'), 'utf8'));
  const r = rnd(99);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const codes = {};
  const keys = Object.keys(topoAll);
  for (let i = 0; i < 3000; i++) {
    const body = pick(topoAll[pick(keys)].bodies);
    if (body.error || body.edges.length < 3) continue;
    const t0 = { faces: clone(body.faces), edges: clone(body.edges) };
    // perturb: move an edge, make a face curved (no plane normal), split an edge into pieces ("~2"), shorten a neighbour, add a loose edge on a face
    const k = Math.floor(r() * 5);
    const e = pick(t0.edges);
    if (k === 0) { const d = [0, 1, 2].map(() => (r() - 0.5) * 6); for (const f of ['start', 'mid', 'end']) e[f] = e[f].map((v, q) => v + d[q]); }
    else if (k === 1) { const f = pick(t0.faces); f.plane_normal = null; }
    else if (k === 2) { const cut = { ...clone(e), name: `${e.name}~2` }; const mid = e.mid; cut.start = mid.map((v, q) => v + (e.end[q] - e.start[q]) * 0.05); cut.mid = cut.start.map((v, q) => (v + cut.end[q]) / 2); e.end = mid.map((v, q) => v - (e.end[q] - e.start[q]) * 0.05); e.mid = e.start.map((v, q) => (v + e.end[q]) / 2); t0.edges.push(cut); }
    else if (k === 3) { const x = pick(t0.edges); const y = pick(t0.edges); t0.edges.push({ ...clone(y), name: x.name, index: t0.edges.length }); }
    else { for (const f of ['start', 'mid', 'end']) e[f] = e[f].map((v) => v * (0.5 + r())); }
    const ta = clone(t0); const tb = clone(t0);
    const p = pick(t0.edges).mid; const size = pick([0.1, 0.5, 1, 2, 4, 8, 15]); const style = pick(['fillet', 'chamfer']);
    const ga = orig.guard.guardBlend(ta, p, size, style); const gb = port.g.guardBlend(tb, p, size, style);
    assert.deepStrictEqual(norm(gb), norm(ga), `guardBlend perturbed ${i}`);
    bump(codes, ga.ok ? `ok:${ga.rule}` : ga.code);
    const picks = Array.from({ length: 2 + Math.floor(r() * 3) }, () => pick(t0.edges).mid);
    const ba = orig.guard.guardBatch(ta, picks, size, style); const bb = port.g.guardBatch(tb, picks, size, style);
    assert.deepStrictEqual(norm(bb), norm(ba), `guardBatch perturbed ${i}`);
    bump(codes, ba.ok ? `ok:${ba.rule}` : `batch:${ba.code}`);
  }
  console.log(`# fc-guard on perturbed topologies: codes reached ${JSON.stringify(codes)}`);
  for (const c of ['too-big', 'in-the-way', 'split', 'orientation', 'curved-face', 'ok:planar', 'batch:crowded', 'batch:twice']) assert.ok(codes[c] > 0, `${c} never reached on the perturbed topologies`);
});
test('guardShellRim, guardPrimitiveRound, postCheck, edgePoints equal the original', () => {
  const r = rnd(7);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const nm = (f, p) => ({ cause: pick(['primitive', 'primitive', 'carried']), feature: f, part: p });
  for (let i = 0; i < 3000; i++) {
    const feats = [{ id: 'b1', kind: 'box' }];
    let prev = 'b1';
    for (let k = 0; k < Math.floor(r() * 4); k++) { const id = `f${k}`; feats.push({ id, kind: pick(['fillet', 'fillet', 'move']), target: prev, style: pick(['fillet', 'chamfer']), size: pick([1, 2, 3, 0.5]), edge: { of: [nm('b1', '+z'), nm('b1', pick(['+x', '+y', '-x']))] } }); prev = id; }
    const sh = { id: 's1', kind: pick(['shell', 'shell', 'hole']), target: prev, thickness: pick([2, 1, 0, -1, 3]), open: r() < 0.9 ? nm('b1', pick(['+z', '+z', '-z'])) : undefined };
    feats.push(sh);
    assert.deepStrictEqual(norm(port.g.guardShellRim(feats, feats.length - 1)), norm(orig.guard.guardShellRim(feats, feats.length - 1)));
    assert.deepStrictEqual(norm(port.g.guardShellRim(feats, 99)), norm(orig.guard.guardShellRim(feats, 99)));
    const pf = { kind: pick(['box', 'cylinder', 'sphere']), round: pick([undefined, 0, -1, 0.005, 0.01, 1, 2.5]), roundStyle: pick([undefined, 'chamfer', 'fillet']) };
    assert.deepStrictEqual(norm(port.g.guardPrimitiveRound(pf)), norm(orig.guard.guardPrimitiveRound(pf)));
    const a = Math.floor(r() * 20); const b2 = Math.floor(r() * 20); const rule = pick(['planar', 'rim', 'group']);
    assert.deepStrictEqual(norm(port.g.postCheck(a, b2, rule)), norm(orig.guard.postCheck(a, b2, rule)));
    const ed = { start: [r() * 9, r() * 9, 0], mid: [r() * 9, r() * 9, 0], end: [r() * 9, r() * 9, 0] };
    assert.deepStrictEqual(norm(port.g.edgePoints(ed)), norm(orig.guard.edgePoints(ed)));
    const loop = { start: [5, 0, 0], mid: [0, 5, 0], end: [5, 0, 0] };
    assert.deepStrictEqual(norm(port.g.edgePoints(loop)), norm(orig.guard.edgePoints(loop)));
  }
});
test('the sentences equal the original: every recorded refusal text, every guard verdict, the lint', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(fcDir, 'fc-sentences-all.json'), 'utf8')).rows;
  const texts = rows.map((x) => x.raw);
  const ids = ['round1', 'bevel2', 'chamfer3', 'fillet4', 'x9'];
  const wrap = (t) => [t, ...ids.map((id) => `${id} (fillet): ${t}`), ...ids.map((id) => `${id} (fillet): its target round1 was refused (${t})`), `SCRIPT ERROR (line 3): ${t}`];
  const more = ['', undefined, null, 5, 'round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than the neighbouring faces',
    'round1 (fillet): solidcraft refused it -- solid.chamfer: not supported yet: the blend is taller than the walls', 'round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than a corner radius',
    'bevel1 (fillet): solidcraft refused it -- solid.chamfer: invalid input: chamfer size must be positive', 'round1 (fillet): solidcraft refused it -- no edge near [1,2,3]',
    'b.edge[x] resolves to F1:+x|F1:+z on b1, but that edge is no longer present whole on b_b1 (an operation after m1 changed or removed it); nothing is picked',
    'round2 (fillet): fillet1.edge[x] resolves to F1:+x|F1:+z on b1, but part of that edge is no longer present whole on b_b1 (an operation after f0 changed or removed it); nothing is picked',
    'a prism has no +x face', 'a cylinder has no -z face', 'faces of a wedge are not resolved', 'faces of a torus are not resolved', 'faces of a sphere are not resolved', 'faces of a cone are not resolved',
    'Rounding works on a shape you build with a tool like Box or Cylinder, not one pulled from a sketch', 'Rounding works on a shape you build with a tool like Box or Cylinder, not one spun from a sketch',
    'A well formed one sentence text.', 'Two sentences here. And the second.', 'has solid.fillet in it.'];
  let n = 0; const cls = {};
  for (const t of [...texts, ...more].flatMap((x) => (typeof x === 'string' ? wrap(x) : [x]))) {
    for (const ctx of [{}, { shape: 'box', limit: 3.5 }, { causes: [{ id: 'f1', kind: 'fillet', style: 'fillet', size: 2 }], self: { style: 'fillet', size: 2 } }, { causes: [{ id: 'f1', kind: 'fillet', style: 'chamfer', size: 2 }, { id: 'p1', kind: 'pocket' }], self: { style: 'fillet', size: 3 } }, { causes: [{ id: 'h1', kind: 'hole' }, { id: 'm1', kind: 'move' }], self: {} }, { causes: [{ id: 'f1', kind: 'fillet', style: 'chamfer', size: 3 }], self: { style: 'fillet', size: 3 } }]) {
      const a = orig.sent.plainSentence(t, ctx); const b = port.s.plainSentence(t, ctx);
      assert.deepStrictEqual(b, a, `plainSentence ${JSON.stringify(t)}`); n++; bump(cls, a.cls);
    }
    assert.deepStrictEqual(port.s.lintSentence(t), orig.sent.lintSentence(t), 'lintSentence');
  }
  const verdicts = [];
  for (const code of ['too-big', 'in-the-way', 'corner', 'split', 'too-small', 'whole-chamfer', 'twice', 'crowded', 'corner3', 'knife-rim', 'negative', 'no-topology', 'face-count', 'no-edge', 'unknown-edge', 'orientation', 'curved-face', 'curved-edge', 'nonsense']) {
    for (const args of [{}, { face: 'cap', extent: 7.123, margin: 0.1 }, { face: 'side', extent: 3.456 }, { face: 'f', extent: 3 }, { ofGroup: 2, gap: 4.567 }, { ofGroup: 5, gap: 1 }, { size: 2, wall: 2.5 }]) verdicts.push({ code, args });
  }
  for (const v of verdicts) for (const id of ids) for (const st of ['round', 'bevel']) assert.equal(port.s.guardSentence(v, id, st), orig.sent.guardSentence(v, id, st), `guardSentence ${JSON.stringify(v)}`);
  assert.equal(port.s.guardSentence({ code: 'too-small' }, 'r1', 'round'), orig.sent.guardSentence({ code: 'too-small' }, 'r1', 'round'));
  console.log(`# fc-sentences: ${n} plainSentence calls equal; classes reached ${JSON.stringify(cls)}`);
  assert.ok(cls['too-big'] && cls.dependent && cls['edge-touched'] && cls.UNMAPPED && cls.verbatim && cls['whole-other'], 'a class of the mapper was never reached');
});

test('the layer\'s refusal sentences are plain (the lint of the group): every guard verdict sentence passes', () => {
  for (const code of ['too-big', 'in-the-way', 'corner', 'split', 'too-small', 'whole-chamfer', 'twice', 'crowded', 'corner3', 'knife-rim', 'negative', 'no-topology', 'face-count', 'no-edge', 'curved-face']) {
    const s = port.s.guardSentence({ code, args: { face: 'cap', extent: 5, margin: 0.1, gap: 3, ofGroup: 3, size: 2, wall: 2 } }, 'round1', 'round');
    assert.deepStrictEqual(port.s.lintSentence(s), [], `${code}: ${s}`);
  }
});

test('summary', () => {
  const reached = Object.keys(tally.guards).filter((g) => g !== '(none)').sort();
  const ALLG = ['FC-TOO-SMALL', 'FC-TOO-BIG', 'FC-CROWDED', 'FC-CORNER3', 'FC-TWICE', 'FC-KNIFE-RIM', 'FC-WHOLE-CHAMFER', 'FC-NEGATIVE', 'FC-FACE-COUNT', 'FC-NO-TOPOLOGY'];
  const missing = ALLG.filter((g) => !reached.includes(g));
  console.log(`# fillet-chamfer differential: ${tally.cases} comparisons (${Object.values(tally.byCorpus).reduce((a, b) => a + b, 0)} docs x ${CONFIGS.length} configs), ${tally.identical} identical, ${tally.thrown} thrown errors (the same on both), ${tally.calls} engine calls compared (runSC and topologyOf)
# by corpus: ${JSON.stringify(tally.byCorpus)}; cases skipped (no ModelDoc): ${caseSkipped.length}
# built (original side): ${JSON.stringify(tally.built)}, of them in a group: ${tally.grouped}; groups of blends: ${tally.groups}; whole-shape rounds refused with the plain primitive standing: ${tally.partial}
# refused (original side): ${JSON.stringify(tally.refused)}
# guard codes reached (the port's): ${JSON.stringify(tally.guards)}
# NOT reached by any doc under the fake: ${JSON.stringify(missing)} (the other codes are reached by the pure-guard tests on real and perturbed topologies)
# distinct refusal sentences (numbers and ids folded): ${tally.sentences.size}
# NAMED EXCEPTION, no measure in the topology reply (the original skips the face count, the port runs it): ${tally.noMeasure.runs} runs of ${tally.noMeasure.docs.size} docs
# thrown errors (the same text on both sides): ${JSON.stringify(tally.errors)}`);
  assert.ok(tally.noMeasure.runs > 0, 'the missing-measure exception never fired');
  assert.ok(tally.identical + tally.noMeasure.runs === tally.cases);
  assert.deepStrictEqual(tally.optsBad, []);
  assert.deepStrictEqual(missing, [], 'a guard of the group was never reached');
  assert.ok(tally.groups > 100 && tally.grouped > 100 && tally.partial > 20, 'groups, grouped builds and whole-shape rounds are all reached');
  assert.ok(N_THEMES > 0);
});
