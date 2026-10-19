import { L } from './common.mjs';
const near = (p, pts, tol = 1e-6) => pts.some(q => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) <= tol);
const r = L.fromScript(`const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nextrude(sk1, 10)`);
const doc = r.doc; const sk = doc.features[0];
console.log('rect sketch fields', JSON.stringify({points: sk.points, constraints: sk.constraints, geoms: sk.geoms}));
for (const [nm, dv] of [['sk1_p2u', 2], ['sk1_p2v', 2]]) {
  const gp = L.cg.generatedParams(doc).find(p => p.name === nm);
  const d2 = L.cg.applyParam(doc, nm, gp.value + dv);
  const solved = L.cg.solveDoc(d2);
  console.log(nm, 'raw points', JSON.stringify(d2.features[0].points), 'solved points', JSON.stringify(solved.features[0].points));
}
// both u and v of corner 3 (index 2)
let d2 = L.cg.applyParam(doc, 'sk1_p2u', 42); d2 = L.cg.applyParam(d2, 'sk1_p2v', 32);
const solved = L.cg.solveDoc(d2);
console.log('corner3 -> (42,32): raw', JSON.stringify(d2.features[0].points), 'solved', JSON.stringify(solved.features[0].points));
const ref = L.references(solved); const row = await L.scored(solved, { ref });
console.log(L.brief(row));
const topo = await L.topologyOf(row.commands);
const verts = topo.topology.bodies[0].edges.flatMap(e => [e.start, e.end]);
const h = L.mh.handlesFor(solved.features[0], solved).find(x => x.param === 'sk1_p2u');
console.log('handle corner 3 origin (solved doc)', JSON.stringify(h.origin), 'on SC vertex', near(h.origin, verts));
