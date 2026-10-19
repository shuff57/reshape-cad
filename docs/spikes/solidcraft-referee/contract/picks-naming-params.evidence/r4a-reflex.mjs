// Round 4 (critic follow-up). swept^swept edge of an extruded non-rectangular polygon: round and bevel at CONVEX and REFLEX vertices.
// ModelDoc-level (script text cannot name a swept^swept edge of a pull). Scored through the PAGE translator (translate-p4 via lib.scored)
// against live OCCT, live brep-rs and an exact closed form:  a vertical edge of height h at a vertex with interior angle a, cut by leg d:
//   bevel at a reflex vertex ADDS (d*d/2*sin(a')...) -- for the right-angle polygons used here: convex bevel removes d*d/2*h, reflex bevel adds d*d/2*h.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r4a-reflex.mjs
import { L, D, save, out } from './common.mjs';
const btw = (feature, a, b) => ({ cause: 'between', feature, kind: 'edge', of: [a, b] });
const sw = (i) => ({ cause: 'swept', feature: 'pull1', kind: 'face', from: 'sk1', edge: i });
const polys = {
  L: { pts: [[0,0],[40,0],[40,15],[15,15],[15,30],[0,30]], area: 825, convex: [0,1,3+0,4,5].filter((v)=>v!==3), reflex: [2] },
  T: { pts: [[0,0],[40,0],[40,10],[25,10],[25,30],[15,30],[15,10],[0,10]], area: 600, reflex: [2, 5] },
  U: { pts: [[0,0],[40,0],[40,30],[30,30],[30,10],[10,10],[10,30],[0,30]], area: 800, reflex: [3, 4] },
};
const H = 14;
const results = [];
for (const [pn, p] of Object.entries(polys)) {
  const n = p.pts.length;
  // the vertex v is shared by edges v-1 and v; "edge pair (v, v+1)" in the critic's numbering meets at vertex v+1.
  for (const style of ['chamfer', 'fillet']) for (const d of [1, 2, 3]) for (let v = 0; v < n; v++) {
    const vertex = (v + 1) % n;
    const reflex = p.reflex.includes(v) ? true : p.reflex.includes(v - 0) ;
    const isReflex = p.reflex.includes(v);
    // only the representative convex vertices (first 2) plus all reflex ones, to keep the run short
    if (!isReflex && v > 1) continue;
    const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: p.pts };
    const feats = [sk, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H },
      { id: 'round1', kind: 'fillet', target: 'pull1', edge: btw('pull1', sw(v), sw((v + 1) % n)), size: d, style }];
    const label = `${pn} ${style} d=${d} swept${v}^swept${(v + 1) % n} (${isReflex ? 'REFLEX' : 'convex'} vertex)`;
    const o = await D(label, { version: 1, features: feats }, { control: false });
    const sign = isReflex ? 1 : -1;
    const closedChamfer = (p.area * H) + sign * d * d / 2 * H;
    const closedFillet = (p.area * H) + sign * (1 - Math.PI / 4) * d * d * H; // right-angle: fillet adds/removes (1-pi/4)d^2 per unit height
    o.closedForm = style === 'chamfer' ? closedChamfer : closedFillet;
    o.reflex = isReflex;
    results.push({ label, outcome: o.outcome, sc: o.truck?.volume, occt: o.occt?.volume, brep: o.brep?.volume, closed: o.closedForm, faces: o.truck?.faces, sentence: o.sentence });
  }
}
console.log('--- SUMMARY (SC vs closed form)');
for (const r of results) console.log(r.label.padEnd(60), r.outcome.padEnd(8), 'SC', r.sc?.toFixed?.(4), 'closed', r.closed.toFixed(4), 'rel', r.sc ? (Math.abs(r.sc - r.closed) / r.closed).toExponential(1) : '-', r.sentence ? '| ' + r.sentence.slice(0, 160) : '');
save('r4a-reflex.json');
