import { L } from './common.mjs';
const src = `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
round(part.rim(sk2), 1)`;
const r = L.fromScript(src);
const ref = L.references(r.doc, 'round4');
console.log('brep (all 4):', JSON.stringify(ref.brep), 'brep refusals', JSON.stringify(ref.brepRefusals));
console.log('occt refusals', JSON.stringify(ref.occtRefusals), 'occt vol (partial)', ref.occt.volume);
// pocket1 only: SC prefix
const pre = r.doc.features.filter(f => !['fillet'].includes(f.kind));
const tr = await L.translateDoc(L.cg.solveDoc({version:1, features: pre}), { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
const cmds = tr.commands; console.log('pocket cmds', cmds.length, JSON.stringify(cmds.at(-1)).slice(0,200));
const m0 = L.runSC(cmds); console.log('plate+pocket V', m0.measure.bodies.map(b=>[b.name,b.volume_mm3]));
const body = m0.measure.bodies[0].name;
const pts = [[20,10,10],[20,20,10],[15,15,10],[25,15,10]]; // rim edge midpoints (top plane z=10)
const edges = [[20,10,10],[20,20,10],[15,15,10],[25,15,10]];
for (const rad of [0.5,1,1.5]) {
  const res = L.runSC([...cmds, { command: 'solid.fillet', params: { edges, radius: rad, body } }]);
  console.log('SC 4-edge fillet r', rad, res.ok ? res.measure.bodies.map(b=>[b.volume_mm3,b.faces]) : res.failed);
  const f2 = L.runSC([...cmds, { command: 'solid.chamfer', params: { edges, distance: rad, body } }]);
  console.log('SC 4-edge chamfer d', rad, f2.ok ? f2.measure.bodies.map(b=>[b.volume_mm3,b.faces]) : f2.failed);
}
// brep-rs reference per radius (re-run script)
for (const rad of [0.5,1,1.5]) {
  const rr = L.fromScript(src.replace('round(part.rim(sk2), 1)', `round(part.rim(sk2), ${rad})`));
  const ref2 = L.references(rr.doc,'round4'); console.log('brep r', rad, JSON.stringify(ref2.brep), JSON.stringify(ref2.brepRefusals));
  const rb = L.fromScript(src.replace('round(part.rim(sk2), 1)', `bevel(part.rim(sk2), ${rad})`));
  const refb = L.references(rb.doc,'bevel4'); console.log('brep bevel', rad, JSON.stringify(refb.brep), JSON.stringify(refb.brepRefusals));
}
