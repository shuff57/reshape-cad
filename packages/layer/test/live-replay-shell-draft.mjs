// REAL-KERNEL replay for fold 3 (shell-draft). Not part of `npm test`: needs the SolidCraft wasm rig AND the retired brep-rs wasm (the group's pick source). NOT RUN by the agent that
// wrote it (the owner runs it).
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-shell-draft.mjs --out=<file.json> [--only=id,id]
//   (BREP_PKG=<dir> overrides archive/brep-rs/pkg; build it once with `cd archive/brep-rs && wasm-pack build --release --target web --out-dir pkg`, see AGENTS.md)
// Runs every case of the shell-draft group (shell-draft-cases.mjs + shell-draft-cases-steep.mjs + shell-draft-cases-r2.mjs: 1100 cases, the ones shell-draft-runner.mjs measured)
// twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/shell-draft-translate.mjs  translateDocGuarded   (synchronous, picks through brep-rs resolve)
//   layer    = packages/layer (compiled), createTranslator({ planners: 'shell-draft' })                (asynchronous, the SAME brep-rs resolve handed in as ctx.resolveAt)
// and requires the same translated commands, the same per-feature status, sentence and guard, and the same scene measure (volume, faces, bodies, bbox).
// It does NOT score either against an oracle (that was shell-draft-runner.mjs against OCCT / brep-rs / the closed forms). It only shows the port changes nothing on a real kernel.
//
// What it does NOT run: the layer's own pick path (no ctx.resolveAt: the point comes from the base's name resolution through ctx.topologyOf). The node rig answers sc.run with
// measures only, no topology snapshot, so that path can only be replayed in the browser host (the pane's bridge). On the fake engine it is reported by the differential test.
//
// Docs that contain a feature phase0 and phase 4 plan differently (a fillet's edge, a constrained-sketch pull / spin / blend) are not compared: the original plans them with
// phase0 (brep-rs picks, four fillet candidates), the layer with the base planners. They are listed as `excluded` with the reason. See NOTES.md.
//
// The group has no execution budget (no G-BUDGET): both sides call sc.run in-process, as shell-draft-runner.mjs does. A mismatch is run again once; if the second run agrees it is reported
// as `flaky` (with the count) and not as `differ`. Nothing else is retried. A hang in the engine would hang this script as it would hang the runner; run it under `timeout`.
//
// Needs: SOLIDCRAFT_REFEREE_PKG; packages/{sketch,script,layer}/dist built (npm run build). Memory: one process, in-process wasm; run one replay at a time.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
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
const OUT = path.resolve(arg('out') || 'live-replay-shell-draft.json');
mkdirSync(path.dirname(OUT), { recursive: true });
if (process.env.SD_OFF) { console.error('FATAL: SD_OFF is set; the replay runs every guard on'); process.exit(2); }

const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const brepDir = process.env.BREP_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
if (!existsSync(path.join(brepDir, 'brep_rs_bg.wasm'))) { console.error(`FATAL: no brep-rs wasm in ${brepDir} (the group's pick source); build it or set BREP_PKG`); process.exit(2); }
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const original = await import(pathToFileURL(path.join(CONTRACT, 'shell-draft-translate.mjs')).href);
const { createTranslator } = await load('packages/layer/dist/index.js');
const layer = createTranslator({ planners: 'shell-draft' });

// the cases, built the way shell-draft-runner.mjs builds them (sigma only feeds the closed forms, which this replay does not use)
const P = await import(pathToFileURL(path.join(CONTRACT, 'shell-draft-polytope.mjs')).href);
const { CASES_FN } = await import(pathToFileURL(path.join(CONTRACT, 'shell-draft-cases.mjs')).href);
const { STEEP_FN } = await import(pathToFileURL(path.join(CONTRACT, 'shell-draft-cases-steep.mjs')).href);
const { R2_FN } = await import(pathToFileURL(path.join(CONTRACT, 'shell-draft-cases-r2.mjs')).href);
const env = { P, sigma: -1, rel: (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1) };
const cases = [...CASES_FN(env), ...STEEP_FN(env), ...R2_FN(env)];

// where phase0 and phase 4 plan a feature other than shell / draft differently (same rule as shell-draft.differential.test.mjs)
const isSoup = (sk) => sk && sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
function differences(doc) {
  const out = []; const sketches = {};
  for (const f of doc.features) {
    if (f.kind === 'sketch') sketches[f.id] = f;
    if (f.kind === 'fillet') out.push('fillet');
    if (['extrude', 'pocket', 'revolve', 'groove'].includes(f.kind) && isSoup(sketches[f.target])) out.push(`${f.kind} of a constrained sketch`);
    if (f.kind === 'blend' && (f.targets ?? []).some((t) => isSoup(sketches[t]))) out.push('blend of a constrained sketch');
  }
  return [...new Set(out)];
}

const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
// the group's pick source, exactly as shell-draft-runner.mjs wires it
const brepResolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };

function sceneOf(commands) {
  const all = runSC(commands);
  if (!all.ok) return { ok: false };
  const bs = all.measure.bodies;
  return { ok: true, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
}
const feats = (tr) => tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.refusal ?? null, guard: x.guard ?? null }));
// canonical outcome of one translator on one doc
async function outcome(isOriginal, doc, fromUsage) {
  let tr;
  try {
    tr = isOriginal
      ? original.translateDocGuarded(structuredClone(doc), { arc, mt, runSC, resolveAt: brepResolveAt }, { fromUsage, off: [] })
      : await layer.translateDoc(structuredClone(doc), { arc, mt, runSC: async (cmds) => runSC(cmds), resolveAt: brepResolveAt, soups: {}, fromUsage });
  } catch (e) { return { threw: String(e?.message ?? e) }; }
  const out = { feats: feats(tr), commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') out.scene = sceneOf(tr.commands);
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));

const rows = []; let same = 0, differ = 0, flaky = 0, noDoc = 0, excluded = 0;
const t0 = Date.now();
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  const r = runScript(c.script);
  if (r.errors.length) { noDoc++; rows.push({ id: c.id, skipped: `script error: ${r.errors[0].message}` }); continue; }
  const doc0 = r.doc; if (c.patch) c.patch(doc0);
  const doc = solveDoc(doc0);
  const diff = differences(doc);
  if (diff.length) { excluded++; rows.push({ id: c.id, excluded: diff }); continue; }
  const fromUsage = original.draftFromUsage(c.script);
  let a = await outcome(true, doc, fromUsage);
  let b = await outcome(false, doc, fromUsage);
  let eq = canon(a) === canon(b);
  let retried = false;
  if (!eq) { retried = true; a = await outcome(true, doc, fromUsage); b = await outcome(false, doc, fromUsage); eq = canon(a) === canon(b); }
  if (eq) { same++; if (retried) flaky++; } else differ++;
  rows.push(eq ? { id: c.id, same: true, retried, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, guards: (a.feats ?? []).map((f) => f.guard).filter(Boolean), volume: a.scene?.volume ?? null } : { id: c.id, same: false, retried, original: a, layer: b });
  if ((same + differ) % 10 === 0) { writeFileSync(OUT, JSON.stringify({ partial: true, same, differ, flaky, noDoc, excluded, rows }, null, 1)); console.log(`${same + differ} cases, ${differ} differ, ${Math.round((Date.now() - t0) / 1000)} s`); }
}
writeFileSync(OUT, JSON.stringify({ pkg: PKG, brep: brepDir, cases: same + differ, same, differ, flakyRetried: flaky, noDoc, excluded, rows }, null, 1));
console.log(`DONE: ${same + differ} cases replayed, ${same} identical (${flaky} only after a re-run), ${differ} differ, ${noDoc} scripts that do not run (no doc), ${excluded} docs not compared (a fillet or a constrained sketch: planned differently by phase0 and phase 4). Wrote ${OUT}`);
process.exit(differ ? 1 : 0);
