// Handles of features that sit on a built solid (sketch corners/round, extrude height, pocket depth, fillet radius, draft, datum):
// placement against the SC body's edges/faces, and a simulated drag scored against OCCT.
import { L, out, save } from './common.mjs';
const scripts = [
  ['sketch corners (rect extrude)', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nextrude(sk1, 10)`],
  ['sketch corners+round', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); sk1.round(1, 5)\nextrude(sk1, 10)`],
  ['polygon sketch', `const sk1 = sketch('top'); sk1.polygon([[0,0],[40,0],[30,25],[0,20]])\nextrude(sk1, 10)`],
  ['front-plane sketch', `const sk1 = sketch('front'); sk1.rect(40, 30, { at: [20, 15] })\nextrude(sk1, 10)`],
  ['pocket', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] })\npocket(sk2, plate, 4)`],
  ['fillet edge', `const b = box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','right'), 3)`],
  ['bevel edge', `const b = box(40,30,20,{at:[5,-3,2]})\nbevel(b.edge('top','right'), 3)`],
  ['draft', `const b = box(40,30,20,{at:[5,-3,2]})\ndraft(b.face('right'), 5)`],
  ['datum', `const p = plane('top', 7)\nconst sk = sketch(p); sk.rect(20,10,{at:[0,0]})\nextrude(sk, 6)`],
];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const near = (p, pts, tol = 1e-6) => pts.some(q => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) <= tol);
async function scBody(doc) {
  const sd = L.cg.solveDoc(doc);
  const tr = await L.translateDoc(sd, { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
  const f = tr.features.find(x => x.id === L.lastSolid(sd));
  if (!f || f.status !== 'built') return { refused: f?.refusal ?? 'not built' };
  const topo = await L.topologyOf(tr.commands);
  return { measure: f.measure, body: topo.topology.bodies.find(b => f.measure.bodies.includes(b.name)) };
}
for (const [label, src] of scripts) {
  const r = L.fromScript(src); if (r.errors.length) { console.log('ERR', label, r.errors[0].message); continue; }
  const doc = r.doc; const base = await scBody(doc);
  if (base.refused) { console.log(label, 'base refused', base.refused); continue; }
  const pts = { v: base.body.edges.flatMap(e => [e.start, e.end]), m: base.body.edges.map(e => e.mid) };
  for (const f of doc.features) {
    for (const h of L.mh.handlesFor(f, doc)) {
      const gp = L.cg.generatedParams(doc).find(p => p.name === h.param);
      const rec = { script: label, feature: f.id, kind: f.kind, handle: h.kind, label: h.label, param: h.param, hasSlot: !!gp };
      if (!gp) { console.log(label.padEnd(30), (f.id + ':' + h.label).padEnd(26), 'NO SLOT'); out.push(rec); continue; }
      rec.originOnVertex = near(h.origin, pts.v); rec.originOnEdgeMid = near(h.origin, pts.m);
      // what plane is the origin on? any planar SC face whose plane contains it
      rec.onPlanarFacePlane = base.body.faces.some(x => x.plane_normal && Math.abs((h.origin[0]-x.centroid[0])*x.plane_normal[0] + (h.origin[1]-x.centroid[1])*x.plane_normal[1] + (h.origin[2]-x.centroid[2])*x.plane_normal[2]) < 1e-6);
      // drag d along axis (and axisV for point handles)
      const d = 2; let doc2 = doc; let moved = {};
      const paramsToSet = [[h.param, gp.value + h.scale * d]];
      if (h.paramV) { const gv = L.cg.generatedParams(doc).find(p => p.name === h.paramV); if (gv) paramsToSet.push([h.paramV, gv.value + h.scale * d]); }
      for (const [nm, v] of paramsToSet) { const g = L.cg.generatedParams(doc).find(p => p.name === nm); doc2 = L.cg.applyParam(doc2, nm, Math.min(g.max, Math.max(g.min, v))); }
      if (JSON.stringify(doc2.features) === JSON.stringify(doc.features)) { rec.dragNoop = true; console.log(label.padEnd(30), (f.id + ':' + h.label).padEnd(26), 'drag no-op'); out.push(rec); continue; }
      const sd2 = L.cg.solveDoc(doc2); const ref = L.references(sd2); const sc = await L.scored(sd2, { ref });
      rec.drag = { outcome: sc.outcome, sentence: sc.sentence, dVol: sc.score?.dVol, dBbox: sc.score?.dBbox, dCom: sc.score?.dCom, truckV: sc.truck?.volume, occtV: ref.occt?.volume };
      // new handle origin (after drag) on SC vertex? (sketch corners / round)
      if (!sc.sentence) { const after = await scBody(doc2); const f2 = doc2.features.find(x => x.id === f.id); const h2 = L.mh.handlesFor(f2, doc2).find(x => x.param === h.param); if (after.body && h2) { const v2 = after.body.edges.flatMap(e => [e.start, e.end]); rec.afterDrag = { originOnVertex: near(h2.origin, v2), originOnEdgeMid: near(h2.origin, after.body.edges.map(e=>e.mid)), } } }
      out.push(rec);
      console.log(label.padEnd(30), (f.id + ':' + h.label).padEnd(26), h.kind.padEnd(7), `onVertex=${rec.originOnVertex} onEdgeMid=${rec.originOnEdgeMid} onPlane=${rec.onPlanarFacePlane}`, '| drag', sc.outcome, sc.score ? `dVol ${L.sci(sc.score.dVol)}` : (sc.sentence ?? '').slice(0, 90), rec.afterDrag ? `after: v=${rec.afterDrag.originOnVertex} m=${rec.afterDrag.originOnEdgeMid}` : '');
    }
  }
}
save('resI2.json');
