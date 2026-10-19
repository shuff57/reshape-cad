#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). WHICH OCCT? The repo's own OCCT builder (packages/brep-adapter/dist/occt-build.js, the one the
// parity gate trusts) does NOT read the pull/pocket options: it builds the plain prism. So "live OCCT" in extrude-pocket.json means:
//   - plain pull, plain pocket, pad, soups: occt-build.js
//   - midplane / length2 / reversed / taper / direction / alongNormal / through: a bespoke OCCT builder written in extrude-pocket-measure.mjs
//     (occtSweepShape: BRepPrimAPI_MakePrism, a sheared prism, or a ThruSections loft to a mitre offset), checked against brep-rs and closed forms.
// This script shows the difference on one 10 x 10 plate: occt-build.js volume vs brep-rs volume vs the closed form, per option.
//   SOLIDCRAFT_REFEREE_PKG is not needed.   bun docs/spikes/solidcraft-referee/contract/extrude-pocket-occt-provenance.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const brepDir = path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const volOf = (sh) => { const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false); return g.Mass(); };
const T = [
  ['plain', 'pull(sk, 10)', 10 * 100],
  ['length2: 4', 'pull(sk, 10, { length2: 4 })', 14 * 100],
  ['midplane', 'pull(sk, 10, { midplane: true })', 1000],
  ['reversed', 'pull(sk, 10, { reversed: true })', 1000],
  ['taper: 10', 'pull(sk, 10, { taper: 10 })', null],
  ['direction [1,0,1]', 'pull(sk, 10, { direction: [1, 0, 1] })', 1000],
];
console.log('option'.padEnd(20), 'repo occt-build.js'.padStart(20), 'brep-rs'.padStart(14), 'closed form'.padStart(14));
for (const [lab, call, cf] of T) {
  const r = runScript(`const sk = sketch('top'); sk.rect(10, 10, { at: [5, 5] }); const part = ${call};`);
  const doc = solveDoc(r.doc);
  const id = [...doc.features].reverse().find((f) => f.kind === 'extrude').id;
  const built = buildDoc(oc, doc, arc);
  const o = built.shapes.get(id) ? volOf(built.shapes.get(id)) : NaN;
  const b = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[id]?.volume;
  console.log(lab.padEnd(20), String(o.toFixed(4)).padStart(20), String(b?.toFixed(4)).padStart(14), String(cf ?? '(see ep-results pt-*)').padStart(14));
}
console.log('pocket through (plate 40x30x10, rect 8x6): repo occt-build.js ignores `through`?');
{
  const r = runScript("const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 10); const sk = sketch('top', 5); sk.rect(8, 6, { at: [20, 15] }); const cut = pocket(sk, plate, 2, { through: true });");
  const doc = solveDoc(r.doc);
  const id = [...doc.features].reverse().find((f) => f.kind === 'pocket').id;
  const built = buildDoc(oc, doc, arc);
  console.log('occt-build.js', volOf(built.shapes.get(id)).toFixed(4), ' brep-rs', JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[id]?.volume.toFixed(4), ' closed form (cut from z=5 down only) ', (12000 - 48 * 5).toFixed(4));
}
