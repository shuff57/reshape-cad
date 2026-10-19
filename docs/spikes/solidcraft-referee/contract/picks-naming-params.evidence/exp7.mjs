import * as L from './lib.mjs';
const src = `const a = box(30,30,10)\nconst b = sphere(30,{at:[5,0,0]})\nkeep(a,b)`;
const r = L.fromScript(src);
for (const [slot, v] of [['box1_height', 10], ['box1_height', 12.5], ['box1_width', 37.5]]) {
  const d2 = L.cg.solveDoc(L.cg.applyParam(r.doc, slot, v));
  const ref = L.references(d2); const row = await L.scored(d2, { ref });
  console.log(slot, v, 'truck', JSON.stringify({ V: row.truck?.volume, faces: row.truck?.faces, types: row.truck?.faceTypes, bbox: row.truck?.bbox }), 'occt', JSON.stringify({ V: ref.occt.volume, faces: ref.occt.faces, types: ref.occt.types, bbox: ref.occt.bbox }));
}
