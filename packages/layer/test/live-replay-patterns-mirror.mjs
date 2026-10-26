// REAL-KERNEL replay for fold 4 (patterns-mirror). Not part of `npm test`: needs the SolidCraft wasm rig. NOT RUN by the agent that wrote it (the owner runs it; the rig was busy).
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-patterns-mirror.mjs --out=<file.json> [--only=id,id] [--large]
// Runs every case of the patterns-mirror group (pm-cases.mjs, pm-cases-r2.mjs, pm-cases-r3.mjs, pm-cases-r4.mjs, pm-cases-r6.mjs: the scripts pm-run.mjs measured; a script the
// front door pm-preflight refuses is skipped, as pm-run.mjs skips it) twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/pm-translate.mjs  translateDoc   (synchronous; every patch on; run in-process: inProcess)
//   layer    = packages/layer (compiled), createTranslator({ planners: 'patterns-mirror' })   (asynchronous)
// and requires the same translated commands, the same per-feature status, the same sentence (the original's `student` is the layer's `refusal`, the original's `refusal` is the
// layer's `raw`), and the same scene measure (volume, faces, bodies, bbox).
// It does NOT score either against an oracle (that was pm-run.mjs against OCCT / brep-rs / closed forms, and there is no 0.21.0 measurement of the group). It only shows the port
// changes nothing on a real kernel.
//
// Differences from the original that are NOT replayed: (1) the original kills each engine call at a time limit by running it in a child process; here both sides run in-process
// (the original with inProcess: true, the layer's runSC ignores { budgetS }), so a hang in the engine hangs this script: run it under `timeout`. (2) The original's partial-angle
// switch and patch switches (not ported). (3) Docs with a shell, fillet or draft (the original asks brep-rs for the point of a name, the layer reads the engine's topology, which
// the node rig does not return), and docs with a constrained sketch pulled/cut/spun (phase 4 maps it, phase 0 refuses) are listed as `excluded` with the reason.
// Cases with more than 60 copies (r3-box-count-1000 ... : hundreds of bodies, minutes of engine time, killed by the memory cap in the group's own run) are skipped unless --large is given.
// A mismatch is run again once; if the second run agrees it is reported as `flaky` and not as `differ`. Run one replay at a time, under systemd-run MemoryMax=1500M like the group's own runs.
//
// Needs: SOLIDCRAFT_REFEREE_PKG; packages/{sketch,script,layer}/dist built (npm run build). The wall times in the notes are compared with the clock ignored (wallMs is dropped).
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const CONTRACT = path.join(REPO, 'docs', 'spikes', 'solidcraft-referee', 'contract');
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG;
if (!PKG) { console.error('FATAL: SOLIDCRAFT_REFEREE_PKG is unset'); process.exit(2); }
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const only = arg('only').split(',').filter(Boolean);
const large = process.argv.includes('--large');
const OUT = path.resolve(arg('out') || 'live-replay-patterns-mirror.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const original = await import(pathToFileURL(path.join(CONTRACT, 'pm-translate.mjs')).href);
const { preflightScript } = await import(pathToFileURL(path.join(CONTRACT, 'pm-preflight.mjs')).href);
const { createTranslator } = await load('packages/layer/dist/index.js');
const layer = createTranslator({ planners: 'patterns-mirror' });
const ALL_PATCHES = new Set(['reversed', 'fresh', 'plane', 'count1', 'torus', 'contact', 'disjoint', 'subgap', 'budget', 'fused', 'spinbox', 'taper', 'contact3', 'mircontact', 'snap', 'sliver', 'web', '__explicit']);

const mods = await Promise.all(['pm-cases.mjs', 'pm-cases-r2.mjs', 'pm-cases-r3.mjs', 'pm-cases-r4.mjs', 'pm-cases-r6.mjs'].map((f) => import(pathToFileURL(path.join(CONTRACT, f)).href)));
const cases = mods.flatMap((m) => [m.CASES, m.CASES2, m.CASES3, m.CASES4, m.CASES6].filter(Array.isArray).flat());

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
const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
function sceneOf(commands) {
  const all = runSC(commands);
  if (!all.ok) return { ok: false };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
const featsOrig = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.status === 'refused' ? x.student : null, raw: x.status === 'refused' ? x.refusal : null, pick: x.pick ?? null, mirrorAt: x.mirrorAt ?? null }));
const featsLayer = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.status === 'refused' ? x.refusal : null, raw: x.status === 'refused' ? x.raw : null, pick: x.pick ?? null, mirrorAt: x.mirrorAt ?? null }));
async function outcome(isOriginal, doc) {
  let tr;
  try {
    tr = isOriginal
      ? original.translateDoc(structuredClone(doc), { arc, mt, runSC: (cmds) => runSC(cmds), resolveAt: () => null, patches: ALL_PATCHES, inProcess: true })
      : await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds) => runSC(cmds), soups: {} });
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: isOriginal ? featsOrig(tr) : featsLayer(tr), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));

const rows = []; let same = 0, differ = 0, flaky = 0, noDoc = 0, excluded = 0, skippedLarge = 0, seen = new Set();
const t0 = Date.now();
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  const key = `${c.id}\u0000${c.src}`; if (seen.has(key)) continue; seen.add(key);
  if (preflightScript(c.src)) { noDoc++; rows.push({ id: c.id, skipped: 'front door (pm-preflight) refuses the script' }); continue; }
  const r = runScript(c.src);
  if (r.errors.length) { noDoc++; rows.push({ id: c.id, skipped: `script error: ${r.errors[0].message}` }); continue; }
  const doc = solveDoc(r.doc);
  if (!large && doc.features.some((f) => f.kind === 'pattern' && f.count > 60)) { skippedLarge++; rows.push({ id: c.id, skipped: 'more than 60 copies (use --large)' }); continue; }
  const diff = differences(doc);
  if (diff.length) { excluded++; rows.push({ id: c.id, excluded: diff }); continue; }
  let a = await outcome(true, doc);
  let b = await outcome(false, doc);
  let eq = canon(a) === canon(b);
  let retried = false;
  if (!eq) { retried = true; a = await outcome(true, doc); b = await outcome(false, doc); eq = canon(a) === canon(b); }
  if (eq) { same++; if (retried) flaky++; } else differ++;
  rows.push(eq ? { id: c.id, same: true, retried, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, volume: a.scene?.volume ?? null } : { id: c.id, same: false, retried, original: a, layer: b });
  if ((same + differ) % 10 === 0) { writeFileSync(OUT, JSON.stringify({ partial: true, same, differ, flaky, noDoc, excluded, skippedLarge, rows }, null, 1)); console.log(`${same + differ} cases, ${differ} differ, ${Math.round((Date.now() - t0) / 1000)} s`); }
}
writeFileSync(OUT, JSON.stringify({ pkg: PKG, cases: same + differ, same, differ, flakyRetried: flaky, noDoc, excluded, skippedLarge, rows }, null, 1));
console.log(`DONE: ${same + differ} cases replayed, ${same} identical (${flaky} only after a re-run), ${differ} differ, ${noDoc} scripts with no doc, ${excluded} docs not compared (shell / fillet / draft / constrained sketch), ${skippedLarge} skipped as large. Wrote ${OUT}`);
process.exit(differ ? 1 : 0);
