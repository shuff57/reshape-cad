import { L, out, save } from './common.mjs';
const R = (label, v) => { out.push({ label, ...v }); console.log(label.padEnd(50), JSON.stringify(v).slice(0, 500)); };
const src = `const L1 = param('L1', 30, {min: 10, max: 60})\nconst sk = sketch('top')\nsk.geom([{k:'line',id:1,a:[0,0],b:[30,0]},{k:'line',id:2,a:[30,0],b:[30,20]},{k:'line',id:3,a:[30,20],b:[0,20]},{k:'line',id:4,a:[0,20],b:[0,0]}])\nsk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'},{k:'horizontal',a:1},{k:'vertical',a:2},{k:'horizontal',a:3},{k:'vertical',a:4},{k:'lock',a:1,aEnd:'a'},{k:'distance',a:1,aEnd:'a',b:1,bEnd:'b',value:L1}])\nextrude(sk, 5)`;
for (const v of [30, 45, 12]) {
  const rv = L.rs.runScript(src, { values: { 'sk1_rule9-value': v } });
  if (rv.errors.length) { R('rule value ' + v, { err: rv.errors[0].message }); continue; }
  const sd = L.cg.solveDoc(rv.doc); const ref = L.references(sd); const row = await L.scored(sd, { ref });
  R('rule param ' + v + ' -> SC vs OCCT', { outcome: row.outcome, sentence: row.sentence, dVol: row.score?.dVol, truckV: row.truck?.volume, occtV: ref.occt?.volume, expectedVolume: v * 20 * 5 });
}
// degenerate values through values/applyParam
for (const [lab, vals] of [['box width -5', { box1_width: -5 }], ['box width 0', { box1_width: 0 }], ['box width 1e-9', { box1_width: 1e-9 }], ['box width 500', { box1_width: 500 }]]) {
  const rr = L.rs.runScript(`const w = param('w', 40)\nbox(w, 30, 20)`, { values: vals });
  const sd = L.cg.solveDoc(rr.doc); const ref = L.references(sd); const row = await L.scored(sd, { ref });
  R(lab, { size: rr.doc.features[0].size, outcome: row.outcome, sentence: row.sentence, dVol: row.score?.dVol, truckV: row.truck?.volume, occt: ref.occt?.volume ?? ref.occt, occtRef: ref.occtRefusals, brep: ref.brep?.volume ?? ref.brep });
}
save('resP2.json');
