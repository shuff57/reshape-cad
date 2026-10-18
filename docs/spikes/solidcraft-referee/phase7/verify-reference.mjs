#!/usr/bin/env node
// SPIKE (phase 7), referee only. For EVERY example in the pane's gallery, builds the same ModelDoc the pane builds
// (real interpreter + the phase 5 friendly shim, then solveDoc) on the reSHape CAD kernel brep-rs (packages/brep-rs/pkg,
// measure_doc) and on OCCT as independent referee, and writes reference-results.json: volume, bbox, faces, centre of mass
// (OCCT only: brep-rs measure_doc has no COM), and every refusal sentence, READ LIVE. Nothing numeric is hardcoded.
// verify-browser.mjs then scores the pane's own runs against this file.   node docs/spikes/solidcraft-referee/phase7/verify-reference.mjs
// Needs `npm run build` and packages/brep-rs/pkg. Not a gate, not in npm test.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { install, withPreamble } from './pane/lib/friendly-sketch.mjs';
install();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { runScript } = await load('packages/script/dist/reshape-script.js'); // Node harness, not an app origin
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

function occtOf(shape) {
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(), hi = bx.CornerMax();
  const c = g.CentreOfMass();
  return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], com: [c.X(), c.Y(), c.Z()] };
}
const examples = JSON.parse(readFileSync(path.join(HERE, 'pane', 'examples.json'), 'utf8'));
const out = [];
for (const e of examples) {
  if (e.group === 'misuse') continue;
  const r = e.doc ? { errors: [], doc: e.doc } : runScript(withPreamble(e.script));
  if (r.errors.length) { out.push({ id: e.id, group: e.group, scriptError: r.errors[0].message, line: r.errors[0].line ?? null }); console.log(e.id.padEnd(30), 'script error', r.errors[0].message); continue; }
  const doc = solveDoc(r.doc);
  const solids = doc.features.filter((f) => !['sketch', 'datum'].includes(f.kind));
  const finalId = solids.at(-1)?.id;
  const rec = { id: e.id, group: e.group, finalFeature: finalId, closed: e.closed ?? null };
  try {
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
    const bs = m.shapes?.[finalId];
    rec.brep = bs ? { volume: bs.volume, faces: bs.faces, bbox: [...bs.bbox[0], ...bs.bbox[1]] } : { refused: m.refusals?.[finalId] ?? 'no shape' };
    rec.brepRefusals = m.refusals ?? {};
  } catch (err) { rec.brep = { error: String(err.message ?? err).slice(0, 200) }; }
  try {
    const built = buildDoc(oc, doc, arc);
    const sh = built.shapes.get(finalId);
    rec.occt = sh ? occtOf(sh) : { refused: [...(built.refusals ?? new Map())].map(([, v]) => v).join(' | ') || 'no shape' };
    rec.occtRefusals = Object.fromEntries(built.refusals ?? []);
  } catch (err) { rec.occt = { error: String(err.message ?? err).slice(0, 200) }; }
  out.push(rec);
  console.log(e.id.padEnd(30), 'occt', rec.occt?.volume?.toFixed(5) ?? JSON.stringify(rec.occt).slice(0, 60), '| brep', rec.brep?.volume?.toFixed(5) ?? JSON.stringify(rec.brep).slice(0, 80));
}
writeFileSync(path.join(HERE, 'reference-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results: out }, null, 1) + '\n');
console.log(`wrote reference-results.json (${out.length} examples)`);
