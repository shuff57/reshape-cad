#!/usr/bin/env node
// ROUND 3. Explain a face-count mismatch: per-surface census of the OCCT shape (type, surface key, area) next to truck's body. For the case where a second
// bore is centred on the wall of an earlier blind bore (OCCT 9 faces, truck 10, brep-rs 11).
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes3-faces.mjs --out=<dir> [--script='...']
import { oc, buildDoc, arc, solveDoc, runScript, runSC, translateDoc, brep } from './holes-base.mjs';
import { facesOf } from '../../../../packages/brep-adapter/dist/topo-resolve.js';
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const BOX = 'const b = cuboid(40, 40, 20); ';
const script = arg('script') || `${BOX} const h1 = hole(b, { across: 10, deep: 10 }); hole(h1, { across: 4, at: [5, 0] });`;
const run = runScript(script); const doc = run.doc; const last = doc.features.at(-1).id;
const built = buildDoc(oc, doc, arc);
const shape = built.shapes.get(last);
const fs = facesOf(oc, shape);
const T = oc.GeomAbs_SurfaceType;
console.log('OCCT faces:');
fs.forEach((f, i) => {
  const a = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
  const g = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, g, false, false);
  const t = a.GetType(); const name = Object.keys(T).find((k) => T[k] === t);
  let extra = '';
  if (t === T.GeomAbs_Cylinder) { const c = a.Cylinder(); const l = c.Location(); extra = `r=${c.Radius().toFixed(3)} axis@(${l.X().toFixed(2)},${l.Y().toFixed(2)}) u:[${a.FirstUParameter().toFixed(3)},${a.LastUParameter().toFixed(3)}] v:[${a.FirstVParameter().toFixed(2)},${a.LastVParameter().toFixed(2)}]`; }
  if (t === T.GeomAbs_Plane) { const ax = a.Plane().Axis(); const l = ax.Location(); const d = ax.Direction(); extra = `n=(${d.X().toFixed(0)},${d.Y().toFixed(0)},${d.Z().toFixed(0)}) z=${l.Z().toFixed(2)}`; }
  console.log(`  ${i} ${name.replace('GeomAbs_', '')} area=${g.Mass().toFixed(3)} ${extra}`);
});
const bres = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
console.log('brep-rs faces:', bres.shapes?.[last]?.faces, 'volume', bres.shapes?.[last]?.volume);
const tr = translateDoc(solveDoc(doc), { arc, mt: null, runSC, resolveAt: () => null });
const m = tr.features.find((f) => f.id === last)?.measure;
console.log('truck:', JSON.stringify({ faces: m?.faces, kernelFaces: m?.kernelFaces, types: m?.faceTypes, volume: m?.volume }));
