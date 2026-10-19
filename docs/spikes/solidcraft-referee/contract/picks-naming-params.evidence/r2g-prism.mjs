// Round 2: prism(n, across, height) side words. Which words name exactly ONE flat face (geometry, independent), what OCCT does with
// round(p.edge('top',word)), what the page says, and whether the ENGINE can build the round when handed the edge directly.
import { writeFileSync } from 'node:fs';
import * as L from './lib.mjs';
const WORDS = { front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
const rows = [];
for (const n of [3, 4, 5, 6, 7, 8, 10, 12]) {
  // geometry: the n side-face normals of a regular n-gon with a vertex on +x (how prism() is built; checked below against OCCT faces)
  const doc0 = L.fromScript(`const p=prism(${n},30,20)\nround(p.edge('top','front'),1)`).doc;
  const pr = doc0.features.find((x) => x.kind === 'prism');
  const built = L.buildDoc(L.oc, { version: 1, features: [pr] }, L.arc); const shape = built.shapes.get(pr.id);
  const fs = L.facesOf(L.oc, shape); const normals = [];
  for (const fc of fs) { const a = new L.oc.BRepAdaptor_Surface(L.oc.TopoDS.Face(fc), true); if (a.GetType() !== L.oc.GeomAbs_SurfaceType.GeomAbs_Plane) continue; const ax = a.Plane().Axis().Direction(); const g = new L.oc.GProp_GProps(); L.oc.BRepGProp.SurfaceProperties(fc, g, false, false); const c = g.CentreOfMass(); let nv = [ax.X(), ax.Y(), ax.Z()]; const cc = [c.X(), c.Y(), c.Z()]; if (nv[0] * (cc[0] - pr.center[0]) + nv[1] * (cc[1] - pr.center[1]) + nv[2] * (cc[2] - pr.center[2]) < 0) nv = nv.map((v) => -v); if (Math.abs(nv[2]) < 0.5) normals.push(nv.map((v) => +v.toFixed(4))); }
  const uniq = {};
  for (const [w, d] of Object.entries(WORDS)) uniq[w] = normals.filter((nv) => nv[0] * d[0] + nv[1] * d[1] + nv[2] * d[2] > 0.999999).length; // faces whose normal IS the word direction
  const near = {}; for (const [w, d] of Object.entries(WORDS)) { const best = Math.max(...normals.map((nv) => nv[0] * d[0] + nv[1] * d[1])); near[w] = normals.filter((nv) => Math.abs(nv[0] * d[0] + nv[1] * d[1] - best) < 1e-6).length; }
  // OCCT and the page for each word
  const res = {};
  for (const w of Object.keys(WORDS)) {
    const f = L.fromScript(`const p=prism(${n},30,20)\nround(p.edge('top','${w}'),1)`);
    const ref = L.references(f.doc); const row = await L.scored(f.doc, { ref });
    res[w] = { flatFacesExactlyThatDirection: uniq[w], tiedNearestFaces: near[w], occt: ref.occt?.volume ?? ref.occt?.refused, occtRef: Object.values(ref.occtRefusals ?? {})[0], brep: ref.brep?.volume ?? ref.brep?.refused, page: row.outcome, sentence: row.sentence };
  }
  rows.push({ n, normals: normals.length, res });
  console.log(`prism(${n}) side faces ${normals.length}:`);
  for (const [w, r] of Object.entries(res)) console.log(`   ${w.padEnd(5)} exact-flat-faces ${r.flatFacesExactlyThatDirection} tied-nearest ${r.tiedNearestFaces} | OCCT ${typeof r.occt === 'number' ? r.occt.toFixed(4) : String(r.occt).slice(0, 60)} | page ${r.page} ${r.sentence ? r.sentence.slice(0, 90) : ''}`);
}
writeFileSync('r2g-prism.json', JSON.stringify(rows, null, 1));
