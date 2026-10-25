// REAL-KERNEL replay for fold 1 (extrude-pocket). Not part of `npm test`: needs the SolidCraft wasm rig.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir, contract/RIG.md> node packages/layer/test/live-replay-extrude-pocket.mjs --out=<file.json> [--only=id,id]
// Runs every case of the extrude-pocket group (extrude-pocket-cases*.mjs) twice on the SAME kernel and the SAME ModelDoc:
//   original = docs/spikes/solidcraft-referee/contract/translate-ep.mjs
//   layer    = packages/layer (compiled), createTranslator({ planners: 'extrude-pocket' })
// and requires the same translated commands, the same per-feature status and sentence, and the same scene measure (volume, faces, bbox).
// It does NOT score either against an oracle: that was done by extrude-pocket-measure.mjs. This only shows the port changes nothing on a real kernel.
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
const OUT = path.resolve(arg('out') || 'live-replay-extrude-pocket.json');
mkdirSync(path.dirname(OUT), { recursive: true });

const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const original = await import(pathToFileURL(path.join(CONTRACT, 'translate-ep.mjs')).href);
const { createTranslator } = await load('packages/layer/dist/index.js');
const layer = createTranslator({ planners: 'extrude-pocket' });

const { CASES } = await import(pathToFileURL(path.join(CONTRACT, 'extrude-pocket-cases.mjs')).href);
for (const f of ['r2', 'r3', 'r4']) await import(pathToFileURL(path.join(CONTRACT, `extrude-pocket-cases-${f}.mjs`)).href);

const runSC = async (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
// canonical outcome of one translator on one doc
async function outcome(route, doc) {
  let tr;
  try { tr = await route.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null }); } catch (e) { return { threw: String(e.message) }; }
  const feats = tr.features.map((x) => ({ id: x.id, kind: x.kind, status: x.status, refusal: x.refusal ?? null, checks: (x.checks ?? []).map((c) => ({ ...c, ms: undefined })) }));
  const out = { feats, commands: tr.commands };
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status === 'built') {
    const all = await runSC(tr.commands);
    const bs = all.ok ? all.measure.bodies : [];
    out.scene = { ok: all.ok, volume: bs.reduce((s, b) => s + b.volume_mm3, 0), faces: bs.reduce((s, b) => s + b.faces, 0), bodies: bs.length, bbox: bs.map((b) => [b.bbox.min, b.bbox.max]) };
  }
  return out;
}
const canon = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Number(v.toPrecision(12)) : v));

const rows = []; let same = 0, differ = 0, noDoc = 0;
const t0 = Date.now();
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  let doc;
  if (c.doc) doc = c.doc;
  else {
    const r = runScript(c.script);
    if (r.errors.length) { noDoc++; rows.push({ id: c.id, skipped: `script error: ${r.errors[0].message}` }); continue; }
    doc = solveDoc(r.doc);
  }
  const a = await outcome(original, doc);
  const b = await outcome(layer, doc);
  const eq = canon(a) === canon(b);
  eq ? same++ : differ++;
  rows.push(eq ? { id: c.id, same: true, status: a.feats?.map((f) => f.status).join(',') ?? a.threw, volume: a.scene?.volume ?? null } : { id: c.id, same: false, original: a, layer: b });
  if ((same + differ) % 25 === 0) { writeFileSync(OUT, JSON.stringify({ partial: true, same, differ, noDoc, rows }, null, 1)); console.log(`${same + differ} cases, ${differ} differ, ${Math.round((Date.now() - t0) / 1000)} s`); }
}
writeFileSync(OUT, JSON.stringify({ pkg: PKG, cases: same + differ, same, differ, noDoc, rows }, null, 1));
console.log(`DONE: ${same + differ} cases replayed, ${same} identical, ${differ} differ, ${noDoc} scripts that do not run (no doc). Wrote ${OUT}`);
process.exit(differ ? 1 : 0);
