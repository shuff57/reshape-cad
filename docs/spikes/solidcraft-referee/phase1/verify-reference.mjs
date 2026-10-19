#!/usr/bin/env node
// SPIKE, referee only. Scores the numbers the BROWSER demo got from solidcraft (browser-results.json, captured by
// playwright-cli from host/ + bridge-dist) against the SAME ModelDoc built live on OCCT and brep-rs. No hardcoded numbers.
//   node docs/spikes/solidcraft-referee/phase1/verify-reference.mjs
// Needs `npm run build` and packages/brep-rs/pkg (same prerequisites as ../run.mjs). Not a gate, not in npm test.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const TOL = { planar: 1e-9, curved: 3e-4 }; // phase0/PROGRESS.md bars
const browser = JSON.parse(readFileSync(path.join(HERE, 'browser-results.json'), 'utf8'));

const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const { facesOf } = await load('packages/brep-adapter/dist/topo-resolve.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { runScript } = await load('packages/script/dist/reshape-script.js'); // Node harness, not the app origin
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
// browser body name b_<featureId> -> the ModelDoc feature whose head shape it is
const headOf = (name) => name.replace(/^b_/, '');
const rows = [];
for (const [key, run] of Object.entries(browser)) {
  const doc0 = runScript(run.src);
  if (doc0.errors.length) throw new Error(`script ${key}: ${doc0.errors[0].message}`);
  const full = solveDoc(doc0.doc);
  // Only compare what solidcraft BUILT: drop the features it refused (and nothing else), same ids as the browser run.
  const refused = new Set(run.features.filter((f) => f.status === 'refused').map((f) => f.id));
  const doc = { ...full, features: full.features.filter((f) => !refused.has(f.id)) };
  const built = buildDoc(oc, doc, arc);
  const brepRes = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  // the browser's bodies, each named after the feature that last produced it; a hole advances its target's head
  const heads = run.features.filter((f) => f.status === 'built' && f.bodies).map((f) => f);
  const lastById = {};
  for (const f of run.features) if (f.status === 'built') for (const b of f.bodies ?? []) lastById[b] = f.id;
  for (const b of run.bodies) {
    const fid = lastById[b.name] ?? headOf(b.name);
    const shape = built.shapes.get(fid);
    if (!shape) { rows.push({ script: key, body: b.name, feature: fid, error: 'OCCT built nothing' }); continue; }
    const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
    const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
    const lo = bx.CornerMin(); const hi = bx.CornerMax();
    const ob = [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()];
    const bs = brepRes.shapes?.[fid];
    const curved = /hole/.test(fid); // the only curved result in these two scripts
    const tol = curved ? TOL.curved : TOL.planar;
    const dVol = rel(b.volume, g.Mass());
    const dBbox = Math.max(...b.bbox.map((v, i) => rel(v, ob[i])));
    rows.push({
      script: key, body: b.name, feature: fid, curved,
      occt: { volume: g.Mass(), faces: facesOf(oc, shape).length, bbox: ob },
      brep: bs ? { volume: bs.volume, faces: bs.faces } : { refused: brepRes.refusals?.[fid] ?? 'no shape' },
      solidcraft_browser: { volume: b.volume, faces: b.faces, bbox: b.bbox },
      dVol_vs_occt: dVol, dVol_vs_brep: bs ? rel(b.volume, bs.volume) : null, dBbox_vs_occt: dBbox, tol,
      pass: dVol <= tol && dBbox <= tol,
    });
  }
  const tot = rows.filter((r) => r.script === key && r.occt).reduce((s, r) => s + r.occt.volume, 0);
  rows.push({ script: key, body: '(TOTAL)', occt_total: tot, solidcraft_browser_total: run.total.volume_mm3, dVol: rel(run.total.volume_mm3, tot), pass: rel(run.total.volume_mm3, tot) <= TOL.curved });
}
writeFileSync(path.join(HERE, 'reference-results.json'), JSON.stringify(rows, null, 1));
for (const r of rows) {
  if (r.error) console.log(r.script, r.body, 'ERROR', r.error);
  else if (r.occt_total !== undefined) console.log(`${r.script.padEnd(7)} TOTAL      occt ${r.occt_total.toFixed(9)}  browser ${r.solidcraft_browser_total.toFixed(9)}  dVol ${r.dVol.toExponential(2)}  ${r.pass ? 'PASS' : 'FAIL'}`);
  else console.log(`${r.script.padEnd(7)} ${r.body.padEnd(9)} ${r.feature.padEnd(6)} occt ${r.occt.volume.toFixed(9)} (faces ${r.occt.faces})  brep ${r.brep.volume?.toFixed(9) ?? r.brep.refused} (faces ${r.brep.faces ?? '-'})  browser ${r.solidcraft_browser.volume.toFixed(9)} (faces ${r.solidcraft_browser.faces})  dVol/occt ${r.dVol_vs_occt.toExponential(2)} dVol/brep ${r.dVol_vs_brep?.toExponential(2)} dBbox ${r.dBbox_vs_occt.toExponential(2)} tol ${r.tol} ${r.pass ? 'PASS' : 'FAIL'}`);
}
process.exit(rows.every((r) => r.pass ?? true) ? 0 : 1);
