// REAL-KERNEL replay for fold 5 (booleans). Not part of `npm test`: needs the SolidCraft wasm rig. WRITTEN, NOT RUN (the rig is the lead's to schedule).
//
//   ulimit -v 2097152        # 2 GB memory cap; run under `systemd-run --user -p MemoryMax=1500M` like the group's own runs
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-booleans.mjs --all --out=<dir> [--only=id,id] [--timeout=90]
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-replay-booleans.mjs --case=<id>        (one case, prints one JSON line; what --all spawns)
//
// Runs every case of the booleans group (boolean-cases.mjs and the rounds r2 .. r6 that push onto it: the scripts run-booleans.mjs measured; a script the interpreter refuses is skipped)
// twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/bool-translate-r3.mjs translateDoc, wired as run-booleans.mjs wires it (test/booleans-original.mjs; synchronous, in-process)
//   layer    = packages/layer (compiled), createTranslator({ planners: 'booleans' })   (asynchronous)
// and requires the same translated commands, the same per-feature status, the same sentence, and the same scene measure (volume, faces, bodies, bbox).
// It does NOT score either against an oracle (that was run-booleans.mjs against OCCT / brep-rs / closed forms, and there is NO 0.21.0 measurement of the group: contract/measured-0.21.0 has no
// booleans file). It only shows that the port changes nothing on a real kernel.
//
// ONE CHILD PROCESS PER CASE, with a timeout (default 90 s), because the group's own measurements found cases that hang the kernel or trap its wasm (booleans-timing.json; the guards refuse
// most of them BEFORE the engine is called, but a case the guards miss would hang this script). A case that times out is recorded as HANG, for both sides alike: it is the child, not either
// translator, that is killed. The layer asks the host for a 45 s budget on every combine run ({ budgetS }); this script's runSC runs in-process and IGNORES it (the node rig has no cancel:
// the kernel is one synchronous wasm call), so the time limit of the layer is not exercised here. THAT IS THE ADVICE-ONLY CASE of NOTES.md, Fold 5: the replay shows nothing about it.
//
// Differences from the original that are NOT replayed: docs with a shell, fillet or draft (the original asks brep-rs for the point of a name, the layer reads the engine's topology, which the node
// rig does not return) and docs with a constrained sketch pulled/cut/spun (phase 4 maps it, phase 0 refuses): listed as `excluded` with the reason.
// A mismatch is run again once; if the second run agrees it is reported as `flaky` and not as `differ`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const imp = (p) => import(pathToFileURL(p).href);
const load = (p) => imp(path.join(REPO, p));

const { CASES } = await imp(path.join(CONTRACT, 'boolean-cases.mjs'));
for (const f of ['boolean-cases-r2.mjs', 'boolean-cases-r3.mjs', 'boolean-cases-r4.mjs', 'boolean-cases-r5.mjs', 'boolean-cases-r6.mjs']) await imp(path.join(CONTRACT, f));

const idsOut = arg('ids-out');
if (idsOut) { writeFileSync(idsOut, JSON.stringify([...new Set(CASES.map((c) => c.id))])); process.exit(0); }

if (process.argv.includes('--all')) {
  const OUT = path.resolve(arg('out') || '.');
  mkdirSync(path.join(OUT, 'cases'), { recursive: true });
  const only = arg('only').split(',').filter(Boolean);
  const timeout = Number(arg('timeout') || 90) * 1000;
  const rows = []; const seen = new Set();
  let same = 0, differ = 0, flaky = 0, noDoc = 0, excluded = 0, hang = 0;
  const t0 = Date.now();
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    const key = `${c.id}\u0000${c.script ?? JSON.stringify(c.features)}`; if (seen.has(key)) continue; seen.add(key);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${c.id}`], { encoding: 'utf8', timeout, maxBuffer: 64 << 20, env: process.env });
    const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@RESULT@@')).pop();
    let row;
    if (line) row = JSON.parse(line.slice(10));
    else row = { id: c.id, hang: r.error?.code === 'ETIMEDOUT' || !!r.signal, crashed: !(r.error?.code === 'ETIMEDOUT' || r.signal), detail: ((r.stderr ?? '').slice(-600) || String(r.error ?? '')) };
    writeFileSync(path.join(OUT, 'cases', `${c.id}.json`), JSON.stringify(row));
    rows.push(row);
    if (row.same) { same++; if (row.retried) flaky++; } else if (row.same === false) differ++; else if (row.excluded) excluded++; else if (row.skipped) noDoc++; else hang++;
    console.log(`${String(c.id).padEnd(44)} ${row.same ? 'same' : row.same === false ? 'DIFFER' : row.excluded ? 'excluded' : row.skipped ? 'skipped' : row.hang ? 'HANG' : 'CRASH'}`);
  }
  writeFileSync(path.join(OUT, 'live-replay-booleans.json'), JSON.stringify({ pkg: PKG, cases: same + differ, same, differ, flakyRetried: flaky, noDoc, excluded, hangOrCrash: hang, wallS: Math.round((Date.now() - t0) / 1000), rows }, null, 1));
  console.log(`DONE: ${same + differ} cases replayed, ${same} identical (${flaky} only after a re-run), ${differ} differ, ${noDoc} scripts with no doc, ${excluded} docs not compared (shell / fillet / draft / constrained sketch), ${hang} hung or crashed. Wrote ${path.join(OUT, 'live-replay-booleans.json')}`);
  process.exit(differ || hang ? 1 : 0);
}

// ---- one case, in this process --------------------------------------------------------------------------------------------------------------------
const id = arg('case');
const C = CASES.find((c) => c.id === id);
if (!C) { console.error('unknown case', id); process.exit(2); }
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { createTranslator } = await load('packages/layer/dist/index.js');
const { loadOriginal, origCtx } = await imp(path.join(HERE, 'booleans-original.mjs'));
const orig = await loadOriginal(CONTRACT);
const layer = createTranslator({ planners: 'booleans' });
const done = (row) => { console.log('@@RESULT@@' + JSON.stringify(row)); process.exit(0); };

const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'shell' || f.kind === 'fillet' || f.kind === 'draft') out.push(f.kind);
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch');
  }
  return [...new Set(out)];
}
const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
function sceneOf(commands) {
  const all = runSC(commands);
  if (!all.ok) return { ok: false };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
const feats = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.status === 'refused' ? x.refusal : null, pick: x.pick ?? null }));
async function outcome(isOriginal, doc) {
  let tr;
  try {
    tr = isOriginal
      ? orig.tr.translateDoc(structuredClone(doc), origCtx(orig, { arc, mt }, doc, (cmds) => runSC(cmds), true))
      : await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds /* , { budgetS }: ignored, see the header */) => runSC(cmds), soups: {} });
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: feats(tr), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));

let features;
if (C.script !== undefined) {
  const r = runScript(C.script);
  if (r.errors.length) done({ id: C.id, skipped: `script error: ${r.errors[0].message}` });
  features = r.doc.features;
} else features = C.features;
const doc = solveDoc({ version: 1, features });
const diff = differences(doc);
if (diff.length) done({ id: C.id, excluded: diff });
const t0 = Date.now();
let a = await outcome(true, doc);
let b = await outcome(false, doc);
let eq = canon(a) === canon(b);
let retried = false;
if (!eq) { retried = true; a = await outcome(true, doc); b = await outcome(false, doc); eq = canon(a) === canon(b); }
done(eq
  ? { id: C.id, same: true, retried, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, volume: a.scene?.volume ?? null, wallMs: Date.now() - t0, load1: +os.loadavg()[0].toFixed(1) }
  : { id: C.id, same: false, retried, original: a, layer: b });
