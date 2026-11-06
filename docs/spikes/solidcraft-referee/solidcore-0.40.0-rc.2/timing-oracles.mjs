// Independent volumes for the boolean timing rows (live-replay-booleans' cases): OCCT buildDoc (BRepGProp, exact) and brep-rs measure_doc,
// on the same ModelDoc the replay builds. Compared with the scene volume the rc.2 replay recorded. Referee only.
//   BREP_PKG=<brep-rs pkg> node timing-oracles.mjs <live-replay-booleans.json> > timing-oracles.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, oc, occtVolume, rel } from './lib.mjs';
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const CONTRACT = path.join(REPO, 'docs/spikes/solidcraft-referee/contract');
const { CASES } = await import(pathToFileURL(path.join(CONTRACT, 'boolean-cases.mjs')).href);
for (const f of ['boolean-cases-r2.mjs', 'boolean-cases-r3.mjs', 'boolean-cases-r4.mjs', 'boolean-cases-r5.mjs', 'boolean-cases-r6.mjs']) await import(pathToFileURL(path.join(CONTRACT, f)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const brep = await import(pathToFileURL(path.join(process.env.BREP_PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(process.env.BREP_PKG, 'brep_rs_bg.wasm')) });
const replay = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const row of replay.rows) {
  const c = CASES.find((x) => x.id === row.id); if (!c) { out.push({ id: row.id, error: 'case not found' }); continue; }
  const doc = c.features ? solveDoc({ version: 1, features: structuredClone(c.features) }) : solveDoc(runScript(c.script).doc);
  const last = doc.features[doc.features.length - 1].id;
  let occt = null, brepV = null;
  try { const b = buildDoc(oc, structuredClone(doc), arc); const s = b.shapes.get(last); occt = s ? occtVolume(s) : null; } catch (e) { occt = null; }
  try { const g = JSON.parse(brep.measure_doc(JSON.stringify(doc))); brepV = g.shapes?.[last]?.volume ?? null; } catch { brepV = null; }
  out.push({ id: row.id, solidcore: row.volume, wallMs: row.wallMs, occt, brep: brepV, relOcct: rel(row.volume, occt), relBrep: rel(row.volume, brepV) });
}
console.log(JSON.stringify(out, null, 1));
