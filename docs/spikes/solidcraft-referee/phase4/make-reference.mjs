#!/usr/bin/env node
// SPIKE (phase 3), referee only. Measures every gallery example on live OCCT and brep-rs (and records the closed form)
// and writes host/examples.json, which the page reads to score what solidcraft built. No number is hardcoded here
// except the closed forms in examples.mjs.   node docs/spikes/solidcraft-referee/phase4/make-reference.mjs
// Needs `npm run build` and packages/brep-rs/pkg. Not a gate, not in npm test.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXAMPLES } from './examples.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const OCCT_DIR = path.join(REPO, 'node_modules', 'replicad-opencascadejs', 'dist');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await load('packages/brep-adapter/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { runScript } = await load('packages/script/dist/reshape-script.js'); // Node harness, not the app origin
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const brepDir = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });

function occtOf(shape) {
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(), hi = bx.CornerMax();
  return { volume: g.Mass(), bbox: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()] };
}
// --only-group=diverge: measure just that group and MERGE it into the existing examples.json (other entries untouched)
const onlyGroup = (process.argv.find((a) => a.startsWith('--only-group=')) ?? '').split('=')[1] || null;
const out = [];
for (const e of EXAMPLES) {
  if (onlyGroup && e.group !== onlyGroup) continue;
  const r = e.doc ? { errors: [], doc: e.doc } : runScript(e.script); // doc examples have no script form
  if (r.errors.length) throw new Error(`${e.id}: ${r.errors[0].message}`);
  const doc = solveDoc(r.doc);
  const finalId = [...doc.features].reverse().find((f) => !['sketch', 'datum'].includes(f.kind))?.id;
  const ref = { finalFeature: finalId, closed: e.closed ?? null };
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const bs = m.shapes?.[finalId];
  ref.brep = bs ? { volume: bs.volume, faces: bs.faces } : { refused: m.refusals?.[finalId] ?? 'no shape' };
  try {
    const built = buildDoc(oc, doc, arc);
    const sh = built.shapes.get(finalId);
    ref.occt = sh ? occtOf(sh) : { refused: [...(built.refusals ?? new Map())].map(([, v]) => v).join(' | ') || 'no shape' };
  } catch (err) { ref.occt = { error: String(err.message ?? err).slice(0, 200) }; }
  if (e.expectBuilt) {
    // what SHOULD have built when the listed features are refused: the sum of the accepted features' own shapes
    // (live OCCT where it builds that feature id, else brep-rs)
    const builtShapes = buildDoc(oc, doc, arc).shapes;
    ref.builtVolume = e.expectBuilt.reduce((sum, id) => {
      const sh = builtShapes.get(id);
      return sum + (sh ? occtOf(sh).volume : (m.shapes?.[id]?.volume ?? 0));
    }, 0);
    ref.builtFeatures = e.expectBuilt;
  }
  ref.volume = ref.occt?.volume ?? ref.brep?.volume ?? ref.closed ?? null;
  ref.source = ref.occt?.volume != null ? 'OCCT' : ref.brep?.volume != null ? 'brep-rs' : ref.closed != null ? 'closed form' : null;
  if (e.divergence) { // OCCT's shell no-ops here: its volume is the UNHOLLOWED solid and must not be used as the reference
    ref.occtShellNoOp = ref.occt?.volume ?? null;
    ref.volume = e.ref.volume; ref.source = e.ref.source;
  }
  if (ref.occt?.bbox) ref.bbox = ref.occt.bbox;
  else if (e.bbox) ref.bbox = e.bbox;
  // cross-checks the reviewer can see: the sources must agree with each other
  ref.agree = {};
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
  if (ref.occt?.volume != null && ref.brep?.volume != null) ref.agree.occtVsBrep = rel(ref.occt.volume, ref.brep.volume);
  if (ref.closed != null && ref.volume != null) ref.agree.refVsClosed = rel(ref.volume, ref.closed);
  out.push({ ...e, ref });
  console.log(e.id.padEnd(26), `final ${finalId}`.padEnd(14), 'occt', ref.occt?.volume?.toFixed(6) ?? JSON.stringify(ref.occt), '| brep', ref.brep.volume?.toFixed(6) ?? ref.brep.refused, '| closed', ref.closed?.toFixed(6) ?? '-', '|', JSON.stringify(ref.agree));
}
let final = out;
if (onlyGroup) {
  const prev = JSON.parse(readFileSync(path.join(HERE, 'host', 'examples.json'), 'utf8'));
  const ids = new Set(out.map((x) => x.id));
  final = [...prev.filter((x) => !ids.has(x.id)), ...out];
}
writeFileSync(path.join(HERE, 'host', 'examples.json'), JSON.stringify(final, null, 1) + '\n');
console.log(`wrote host/examples.json (${final.length} examples)`);
