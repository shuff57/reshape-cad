// REAL-KERNEL replay for fold 7 (fillet-chamfer). Not part of `npm test`: needs the SolidCraft wasm rig AND a wasm built from wrapper2 (a wrapper that returns every command's output, so model.faces / model.edges can be read;
// test/topology-upstream.mjs). WRITTEN, NOT RUN (the rig is the lead's to schedule).
//
//   ulimit -v 2097152        # 2 GB memory cap; run under `systemd-run --user -p MemoryMax=1500M` like the group's own runs
//   SOLIDCRAFT_TOPOLOGY_PKG=<wrapper2 pkg dir, default $HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology> \
//     node packages/layer/test/live-replay-fillet-chamfer.mjs --all --out=<dir> [--only=id,id] [--timeout=120] [--generated=0] [--measure=1|0]
//   SOLIDCRAFT_TOPOLOGY_PKG=<pkg dir> node packages/layer/test/live-replay-fillet-chamfer.mjs --case=<id>        (one case, prints one JSON line; what --all spawns)
//
// Runs every case of the fillet-chamfer group (the case files of fillet-chamfer-evidence/ and live/, the three fuzz kinds of fc4-cases-fuzz.mjs; a script the interpreter refuses is skipped), and --generated=N of the generated docs of
// test/fc-docs.mjs (default 0), twice on the SAME kernel and the SAME ModelDoc:
//   original = fillet-chamfer-evidence/live/lib/translate-fc.mjs translateDoc with ctx.fc = { guard: true, group: true, lib: fc-guard.mjs } (the group's host), its refusals mapped to the plain sentences by fc-sentences.mjs as fc-page.mjs does
//   layer    = packages/layer (compiled), createTranslator({ planners: 'fillet-chamfer' })
// and requires the same translated commands, the same per-feature status, the same sentence, the same guard verdict (the original's `guard` object is the layer's `fc`) and the same scene measure (volume, faces, bodies, bbox).
//
// WHAT THE TOPOLOGY REPLY CARRIES. The upstream adapter (topology-upstream.mjs) puts no measure in a topology reply. --measure=1 (the default) adds the measure of the same run, as the group's own host did (the original reads the face count before a
// blend from it); both sides get the same reply. --measure=0 leaves it out: the original then SKIPS the post-build face count (the fail-open), the layer runs it from its own measure, and a difference that is a straight planar blend
// refused by the layer with FC-FACE-COUNT where the original built it is the named exception (listed as `missingMeasure`, not as `differ`); anything else still fails.
//
// SCORING AGAINST A SECOND ORACLE (new in this replay, the only one in the layer's replays that has one for the group): a case that carries a closed form (`closedForm: { volume, faces }`, the group's own cases a1/a2/a3 ...) and that the
// layer BUILDS entirely (no refused blend) is compared with it: volume to 1e-8 relative for planar blends and 3e-4 for curved ones (the group's bars, fc-eval.mjs). A built result off the closed form is `builtWrong` (a stop). The
// closed forms are the group's, measured against OCCT and FreeCAD in its own rounds; nothing here re-derives them.
//
// ONE CHILD PROCESS PER CASE, with a timeout (default 120 s): a case that times out is recorded as HANG for both sides alike (it is the child that is killed). The layer asks the host for no time limit in this set.
// A mismatch is run again once; if the second run agrees it is reported as `flaky` and not as `differ`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadUpstream } from './topology-upstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const FC = path.join(CONTRACT, 'fillet-chamfer-evidence');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const imp = (p) => import(pathToFileURL(p).href);
const load = (p) => imp(path.join(REPO, p));
const WITH_MEASURE = arg('measure') !== '0';

// ---- the cases (as test/fillet-chamfer.differential.test.mjs selects them) and the generated docs ----------------------------------------------------------------
const CASE_FILES = ['cases.mjs', 'cases-r2.mjs', 'cases-r2b.mjs', 'cases-r2c.mjs', 'cases-r3.mjs', 'cases-r3f.mjs', 'cases-seq.mjs', 'cases-fc.mjs', 'live/fc4-cases-a.mjs', 'live/fc4-cases-b.mjs', 'live/fc4-cases-c.mjs', 'live/fc4-cases-regress.mjs'];
const N_GEN = Number(arg('generated') || 0);
const CASES = []; const seen = new Set();
const addCase = (c) => { const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.doc)}`; if (seen.has(key)) return; seen.add(key); if (c.doc || typeof c.script === 'string') CASES.push({ id: c.id, script: c.script, doc: c.doc, closedForm: c.closedForm }); };
for (const f of CASE_FILES) { try { for (const c of (await imp(path.join(FC, f))).CASES) addCase(c); } catch { /* a case file that does not load is skipped */ } }
{
  const keep = { FZ: process.env.FZ, SEED: process.env.SEED, N: process.env.N };
  for (const fz of ['single', 'group', 'pocket']) { process.env.FZ = fz; process.env.SEED = '2027'; process.env.N = '100'; for (const c of (await import(`${pathToFileURL(path.join(FC, 'live/fc4-cases-fuzz.mjs')).href}?fz=${fz}`)).CASES) addCase(c); }
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
for (let i = 0; i < N_GEN; i++) CASES.push({ id: `fc seed ${i}`, gen: i });

if (process.argv.includes('--all')) {
  const OUT = path.resolve(arg('out') || '.');
  mkdirSync(path.join(OUT, 'cases'), { recursive: true });
  const only = arg('only').split(',').filter(Boolean);
  const timeout = Number(arg('timeout') || 120) * 1000;
  const rows = [];
  let same = 0, differ = 0, flaky = 0, noDoc = 0, hang = 0, missing = 0, wrong = 0, scored = 0;
  const t0 = Date.now();
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${c.id}`, `--measure=${WITH_MEASURE ? 1 : 0}`, ...(N_GEN ? [`--generated=${N_GEN}`] : [])], { encoding: 'utf8', timeout, maxBuffer: 64 << 20, env: process.env });
    const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@RESULT@@')).pop();
    let row;
    if (line) row = JSON.parse(line.slice(10));
    else row = { id: c.id, hang: r.error?.code === 'ETIMEDOUT' || !!r.signal, crashed: !(r.error?.code === 'ETIMEDOUT' || r.signal), detail: ((r.stderr ?? '').slice(-600) || String(r.error ?? '')) };
    writeFileSync(path.join(OUT, 'cases', `${String(c.id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`), JSON.stringify(row));
    rows.push(row);
    if (row.missingMeasure) missing++; else if (row.same) { same++; if (row.retried) flaky++; } else if (row.same === false) differ++; else if (row.skipped) noDoc++; else hang++;
    if (row.score) { scored++; if (row.score.builtWrong) wrong++; }
    console.log(`${String(c.id).padEnd(52)} ${row.missingMeasure ? 'missing-measure' : row.same ? 'same' : row.same === false ? 'DIFFER' : row.skipped ? 'skipped' : row.hang ? 'HANG' : 'CRASH'}${row.score?.builtWrong ? '  BUILT WRONG' : ''}`);
  }
  writeFileSync(path.join(OUT, 'live-replay-fillet-chamfer.json'), JSON.stringify({ topologyPkg: process.env.SOLIDCRAFT_TOPOLOGY_PKG ?? null, measureInReply: WITH_MEASURE, cases: same + differ + missing, same, differ, missingMeasure: missing, flakyRetried: flaky, noDoc, hangOrCrash: hang, scoredAgainstClosedForm: scored, builtWrong: wrong, wallS: Math.round((Date.now() - t0) / 1000), rows }, null, 1));
  console.log(`DONE: ${same + differ + missing} cases replayed, ${same} identical (${flaky} only after a re-run), ${missing} through the named missing-measure exception, ${differ} differ, ${noDoc} scripts with no doc, ${hang} hung or crashed; ${scored} built results scored against a closed form, ${wrong} BUILT WRONG. Wrote ${path.join(OUT, 'live-replay-fillet-chamfer.json')}`);
  process.exit(differ || hang || wrong ? 1 : 0);
}

// ---- one case, in this process --------------------------------------------------------------------------------------------------------------------
const id = arg('case');
const C = CASES.find((c) => c.id === id);
if (!C) { console.error('unknown case', id); process.exit(2); }
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { createTranslator } = await load('packages/layer/dist/index.js');
const { fcDoc } = await imp(path.join(HERE, 'fc-docs.mjs'));
const orig = { tr: await imp(path.join(FC, 'live/lib/translate-fc.mjs')), guard: await imp(path.join(FC, 'fc-guard.mjs')), sent: await imp(path.join(FC, 'fc-sentences.mjs')) };
const layer = createTranslator({ planners: 'fillet-chamfer' });
const done = (row) => { console.log('@@RESULT@@' + JSON.stringify(row)); process.exit(0); };

const up = loadUpstream();
// the topology reply of the upstream adapter has no measure; with --measure=1 it gets the measure of the same run (both sides, the same reply)
const topologyOf = async (cmds) => {
  const t = await up.topologyOf(cmds);
  if (!t.ok || !WITH_MEASURE) return t;
  const m = await up.runSC(cmds);
  return m.ok ? { ...t, measure: m.measure } : t;
};
function sceneOf(commands) {
  const all = up.runSC(commands);
  return all.then((r) => {
    if (!r.ok) return { ok: false };
    const bs = r.measure.bodies;
    return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]), curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')) };
  });
}
/** the original's notes as the group's host (fc-page.mjs) shows them, in document order */
function viewOrig(tr, doc) {
  const at = (fid) => doc.features.findIndex((x) => x.id === fid);
  return tr.features.map((f) => {
    const st = /^bevel|^chamfer/.test(f.id) ? 'bevel' : 'round';
    if (f.partialGuard) return { f, status: 'refused', refusal: orig.sent.guardSentence(f.partialGuard, f.id, st) ?? `${f.id} (${f.kind}): GUARD ${f.partialGuard.code}`, fc: f.partialGuard };
    if (f.status !== 'refused') return { f, status: f.status, refusal: null, fc: null };
    let sentence;
    if (f.guard) sentence = orig.sent.guardSentence(f.guard, f.id, st);
    else {
      const sctx = {};
      const m = (f.refusal ?? '').match(/an operation after (\S+) changed or removed it/);
      const i = at(f.id);
      if (m && i >= 0) { const from = at(m[1]); sctx.causes = doc.features.slice(from + 1, i).filter((x) => !['sketch', 'extrude', 'datum'].includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, style: x.style, size: x.size })); sctx.self = { style: doc.features[i].style, size: doc.features[i].size }; }
      sentence = orig.sent.plainSentence(f.refusal ?? '', sctx).sentence;
    }
    return { f, status: 'refused', refusal: sentence ?? f.refusal, fc: f.guard ?? null };
  }).sort((a, b) => at(a.f.id) - at(b.f.id)).map(({ f, status, refusal, fc }) => ({ id: f.id, kind: f.kind, status, refusal, fc, commands: f.commands, pick: f.pick ?? null, group: f.group ?? null }));
}
const viewLayer = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.status === 'refused' ? x.refusal : null, fc: x.fc ?? null, commands: x.commands, pick: x.pick ?? null, group: x.group ?? null }));
async function outcome(isOriginal, doc) {
  let tr;
  const ctx = { arc, mt, runSC: async (cmds) => up.runSC(cmds), topologyOf, soups: {} };
  try {
    tr = isOriginal ? await orig.tr.translateDoc(structuredClone(doc), { ...ctx, fc: { guard: true, group: true, lib: orig.guard } }) : await layer.translateDoc(structuredClone(doc), ctx);
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: isOriginal ? viewOrig(tr, doc) : viewLayer(tr), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = await sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));
/** the one named exception: the first differing feature is a straight planar blend the layer refuses with FC-FACE-COUNT and the original built (it skipped the count: no measure in the reply) */
function missingMeasureException(a, b) {
  if (WITH_MEASURE || a.threw || b.threw) return false;
  const k = b.feats.findIndex((x, j) => canon(x) !== canon(a.feats[j]));
  return k >= 0 && b.feats[k].status === 'refused' && b.feats[k].fc?.code === 'face-count' && a.feats[k]?.status === 'built';
}
/** the closed form of the case, when the layer built every blend of it */
function score(C0, b) {
  if (!C0.closedForm || b.threw || !b.scene?.ok || b.feats.some((f) => f.status === 'refused')) return null;
  const bar = b.scene.curved ? 3e-4 : 1e-8;
  const rel = Math.abs(b.scene.volume - C0.closedForm.volume) / Math.max(Math.abs(C0.closedForm.volume), 1);
  return { closedFormVolume: C0.closedForm.volume, volume: b.scene.volume, rel, bar, facesClosedForm: C0.closedForm.faces ?? null, faces: b.scene.faces, builtWrong: rel > bar };
}

let doc;
if (C.gen !== undefined) doc = fcDoc(C.gen);
else if (C.doc) doc = solveDoc({ version: 1, features: C.doc.features ?? C.doc });
else {
  const r = runScript(C.script);
  if (r.errors.length) done({ id: C.id, skipped: `script error: ${r.errors[0].message}` });
  doc = solveDoc(r.doc);
}
const t0 = Date.now();
let a = await outcome(true, doc);
let b = await outcome(false, doc);
let eq = canon(a) === canon(b);
let retried = false;
if (!eq) { retried = true; a = await outcome(true, doc); b = await outcome(false, doc); eq = canon(a) === canon(b); }
const sc = score(C, b);
if (!eq && missingMeasureException(a, b)) done({ id: C.id, missingMeasure: true, same: false, score: sc, wallMs: Date.now() - t0 });
done(eq
  ? { id: C.id, same: true, retried, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, volume: a.scene?.volume ?? null, score: sc, wallMs: Date.now() - t0, load1: +os.loadavg()[0].toFixed(1) }
  : { id: C.id, same: false, retried, score: sc, original: a, layer: b });
