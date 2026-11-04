// REAL-KERNEL replay for fold 6 (revolve-groove). Not part of `npm test`: needs the SolidCraft wasm rig. WRITTEN, NOT RUN (the rig is the lead's to schedule).
//
//   ulimit -v 2097152        # 2 GB memory cap; run under `systemd-run --user -p MemoryMax=1500M` like the group's own runs
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-revolve-groove.mjs --all --out=<dir> [--only=id,id] [--timeout=120] [--generated=0]
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/live-replay-revolve-groove.mjs --case=<id>        (one case, prints one JSON line; what --all spawns)
//
// Runs every case of the revolve-groove group (rg-cases.mjs allCases + cases-r3 .. r5 and the extra lists: the scripts rg-run.mjs measured; a script the interpreter refuses is skipped), and
// --generated=N of the generated docs of test/rg-docs.mjs (default 0), twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/revolve-groove-rig/rg-translate-p4.mjs translateDoc (the phase 7 pane translator + the group's patches; asynchronous, in-process)
//   layer    = packages/layer (compiled), createTranslator({ planners: 'revolve-groove' })
// and requires the same translated commands, the same per-feature status, the same sentence, the same guard object (the original's `guard` is the layer's `rg`) and the same scene measure (volume,
// faces, bodies, bbox). It does NOT score either against an oracle (that was rg-run.mjs against OCCT / brep-rs / closed forms, and there is NO 0.21.0 measurement of the group:
// contract/measured-0.21.0 has no revolve-groove file). It only shows that the port changes nothing on a real kernel.
//
// ONE CHILD PROCESS PER CASE, with a timeout (default 120 s), because the group's own measurements found grooves that take minutes or hang the kernel (revolve-groove-results/r3/cost-*.json;
// the cost rule G8 refuses most of them BEFORE the engine is called, but a case the guards miss would hang this script). A case that times out is recorded as HANG, for both sides alike: it is
// the child, not either translator, that is killed. The layer asks the host for a 45 s budget on every groove run ({ budgetS }); this script's runSC runs in-process and IGNORES it (the node rig has
// no cancel: the kernel is one synchronous wasm call), so the time limit of the layer is not exercised here. THAT IS THE ADVICE-ONLY CASE of NOTES.md, Fold 6: the replay shows nothing about it.
//
// The node rig answers sc.run with measures only (no topology): a shell, fillet or draft that NAMES a face or an edge is refused by both sides alike. Constrained sketches (soups) are mapped
// by phase 4 for pull and pocket, so the p4 original and the layer agree on them; no document is excluded.
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
const RIG = path.join(CONTRACT, 'revolve-groove-rig');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
if (process.env.RG_OFF) { console.error('FATAL: RG_OFF is set; the replay runs every guard on'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const imp = (p) => import(pathToFileURL(p).href);
const load = (p) => imp(path.join(REPO, p));

// ---- the cases (as test/revolve-groove.differential.test.mjs selects them) and the generated docs ------------------------------------------------------------------
const { allCases } = await imp(path.join(RIG, 'rg-cases.mjs'));
const SRC = [...allCases('/nonexistent-rg-dir', [])];
for (const f of ['cases-r3.mjs', 'cases-r3-chainprobe.mjs', 'cases-r3-fuzz.mjs', 'cases-r3-sliver.mjs', 'cases-r3-spinfuzz.mjs', 'cases-r4-graze.mjs', 'cases-r5-regress.mjs', 'cases-r5-wall.mjs']) SRC.push(...(await imp(path.join(RIG, f))).cases);
const N_GEN = Number(arg('generated') || 0);
const CASES = []; const seen = new Set();
for (const c of SRC) { if (typeof c.src !== 'string') continue; const key = `${c.id}\u0000${c.src}`; if (seen.has(key)) continue; seen.add(key); CASES.push({ id: c.id, src: c.src }); }
for (let i = 0; i < N_GEN; i++) CASES.push({ id: `rg seed ${i}`, gen: i });

const idsOut = arg('ids-out');
if (idsOut) { writeFileSync(idsOut, JSON.stringify([...new Set(CASES.map((c) => c.id))])); process.exit(0); }

if (process.argv.includes('--all')) {
  const OUT = path.resolve(arg('out') || '.');
  mkdirSync(path.join(OUT, 'cases'), { recursive: true });
  const only = arg('only').split(',').filter(Boolean);
  const timeout = Number(arg('timeout') || 120) * 1000;
  const rows = [];
  let same = 0, differ = 0, flaky = 0, noDoc = 0, hang = 0;
  const t0 = Date.now();
  for (const c of CASES) {
    if (only.length && !only.includes(c.id)) continue;
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--case=${c.id}`, ...(N_GEN ? [`--generated=${N_GEN}`] : [])], { encoding: 'utf8', timeout, maxBuffer: 64 << 20, env: process.env });
    const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@RESULT@@')).pop();
    let row;
    if (line) row = JSON.parse(line.slice(10));
    else row = { id: c.id, hang: r.error?.code === 'ETIMEDOUT' || !!r.signal, crashed: !(r.error?.code === 'ETIMEDOUT' || r.signal), detail: ((r.stderr ?? '').slice(-600) || String(r.error ?? '')) };
    writeFileSync(path.join(OUT, 'cases', `${String(c.id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`), JSON.stringify(row));
    rows.push(row);
    if (row.same) { same++; if (row.retried) flaky++; } else if (row.same === false) differ++; else if (row.skipped) noDoc++; else hang++;
    console.log(`${String(c.id).padEnd(52)} ${row.same ? 'same' : row.same === false ? 'DIFFER' : row.skipped ? 'skipped' : row.hang ? 'HANG' : 'CRASH'}`);
  }
  writeFileSync(path.join(OUT, 'live-replay-revolve-groove.json'), JSON.stringify({ pkg: PKG, cases: same + differ, same, differ, flakyRetried: flaky, noDoc, hangOrCrash: hang, wallS: Math.round((Date.now() - t0) / 1000), rows }, null, 1));
  console.log(`DONE: ${same + differ} cases replayed, ${same} identical (${flaky} only after a re-run), ${differ} differ, ${noDoc} scripts with no doc, ${hang} hung or crashed. Wrote ${path.join(OUT, 'live-replay-revolve-groove.json')}`);
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
const { rgDoc } = await imp(path.join(HERE, 'rg-docs.mjs'));
const orig = await imp(path.join(RIG, 'rg-translate-p4.mjs'));
const layer = createTranslator({ planners: 'revolve-groove' });
const done = (row) => { console.log('@@RESULT@@' + JSON.stringify(row)); process.exit(0); };

const runSC = (cmds) => { try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; } };
function sceneOf(commands) {
  const all = runSC(commands);
  if (!all.ok) return { ok: false };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
// the original's `guard` object is the layer's `rg`; the layer's `guard` is a code the original does not have
const feats = (tr, isOriginal) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.status === 'refused' ? x.refusal : null, pick: x.pick ?? null, guard: (isOriginal ? x.guard : x.rg) ?? null }));
async function outcome(isOriginal, doc) {
  let tr;
  try {
    tr = isOriginal
      ? await orig.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds) => runSC(cmds), soups: {} })
      : await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds /* , { budgetS }: ignored, see the header */) => runSC(cmds), soups: {} });
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: feats(tr, isOriginal), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));

let doc;
if (C.gen !== undefined) doc = rgDoc(C.gen);
else {
  const r = runScript(C.src);
  if (r.errors.length) done({ id: C.id, skipped: `script error: ${r.errors[0].message}` });
  doc = solveDoc(r.doc);
}
const t0 = Date.now();
let a = await outcome(true, doc);
let b = await outcome(false, doc);
let eq = canon(a) === canon(b);
let retried = false;
if (!eq) { retried = true; a = await outcome(true, doc); b = await outcome(false, doc); eq = canon(a) === canon(b); }
done(eq
  ? { id: C.id, same: true, retried, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, volume: a.scene?.volume ?? null, wallMs: Date.now() - t0, load1: +os.loadavg()[0].toFixed(1) }
  : { id: C.id, same: false, retried, original: a, layer: b });
