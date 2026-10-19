import * as L from './lib.mjs';
for (const src of [`prism(6,30,20,{at:[3,2,1]})`, `wedge(30,20,10,{at:[3,2,1]})`, `sphere(30,{at:[3,2,1]})`]) {
  const r = L.fromScript(src); const f = r.doc.features[0];
  const gp = L.cg.generatedParams(r.doc).map(p => p.name);
  const d2 = L.cg.applyParam(r.doc, f.id + '_x', 99);
  console.log(f.kind, 'isShape', L.mt.isShape(f), 'center', JSON.stringify(f.center), 'slots', gp.join(','), 'after applyParam x=99 center', JSON.stringify(d2.features[0].center));
  const rr = L.rs.runScript(src, { values: { [f.id + '_x']: 99 } });
  console.log('   runScript values center', JSON.stringify(rr.doc.features[0].center));
}
