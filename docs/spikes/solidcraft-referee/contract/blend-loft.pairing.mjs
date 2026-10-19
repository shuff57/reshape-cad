// Offline check (reads the r2 results json): does truck's loft pairing rule, read from the pinned solidcraft source
// (crates/kernel/src/build.rs loft(): lead = section with most segments, ties -> the LAST one; every section is rotated so its start vertex is the one
// whose direction from its area centroid is nearest the lead's first-vertex direction), predict which corner of a goes with which corner of b?
//   bun blend-loft.pairing.mjs <r2-results.json> > blend-loft.pairing.txt
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const centroid = (p) => { let a2 = 0, cx = 0, cy = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; const k = a[0] * b[1] - b[0] * a[1]; a2 += k; cx += (a[0] + b[0]) * k; cy += (a[1] + b[1]) * k; } return [cx / (3 * a2), cy / (3 * a2)]; };
const ang = (v) => Math.atan2(v[1], v[0]);
const TAU = 2 * Math.PI;
// shift s such that a rotated left by s pairs with b (b is the lead, so b keeps its own start)
function pairingShift(p, q) {
  const cb = centroid(q), ca = centroid(p);
  const target = ang([q[0][0] - cb[0], q[0][1] - cb[1]]);
  let best = 0, bd = Infinity;
  p.forEach((v, k) => { let d = ((ang([v[0] - ca[0], v[1] - ca[1]]) - target) % TAU + TAU) % TAU; d = Math.min(d, TAU - d); if (d < bd) { bd = d; best = k; } });
  return best;
}
const prism = (p, q, h) => { const area = (r) => Math.abs(area2(r)) / 2; const m = p.map((a, i) => [(a[0] + q[i][0]) / 2, (a[1] + q[i][1]) / 2]); return h / 6 * (area(p) + 4 * area(m) + area(q)); };
const pop = [...j.E1.map((x) => ({ ...x, pop: 'E1 random' })), ...j.E2.map((x) => ({ ...x, pop: 'E2 planar-sided' })), ...j.E3.map((x) => ({ ...x, pop: 'E3 named', h: x.points.h }))];
const rows = [];
for (const x of pop) {
  if (!x.points || x.truck.volume === undefined) continue;
  const { p, q } = x.points; const h = x.points.h ?? 20; const n = p.length;
  const s = pairingShift(p, q);
  const pa = p.map((_, i) => p[(i + s) % n]);
  const predicted = prism(pa, q, h);
  const index = prism(p, q, h);
  rows.push({ pop: x.pop, label: x.label, shift: s, planarIdx: x.planar, truck: x.truck.volume, occt: x.occt.volume, indexVol: index, predictedVol: predicted, dTruckPredicted: Math.abs(x.truck.volume - predicted) / Math.max(predicted, 1), dTruckIndex: Math.abs(x.truck.volume - index) / Math.max(index, 1), dOcctIndex: Math.abs(x.occt.volume - index) / Math.max(index, 1) });
}
const fmt = (v) => v.toExponential(1);
const shifted = rows.filter((r) => r.shift !== 0);
console.log(`cases ${rows.length}; truck pairing rule says shift != 0 in ${shifted.length}`);
for (const r of shifted) console.log(`  SHIFTED ${r.pop} | ${r.label}: shift ${r.shift}; truck ${r.truck.toFixed(3)} index-pairing ${r.indexVol.toFixed(3)} shifted-pairing ${r.predictedVol.toFixed(3)}; |truck-shifted| ${fmt(r.dTruckPredicted)} |truck-index| ${fmt(r.dTruckIndex)}; OCCT ${r.occt.toFixed(3)} (|OCCT-index| ${fmt(r.dOcctIndex)})`);
const unshifted = rows.filter((r) => r.shift === 0);
console.log(`shift==0: ${unshifted.length} cases; of those truck-vs-index > 3e-4: ${unshifted.filter((r) => r.dTruckIndex > 3e-4).length}; truck-vs-index > 1e-9 AND planar sides: ${unshifted.filter((r) => r.planarIdx && r.dTruckIndex > 1e-9).length}; planar sides & shift==0: ${unshifted.filter((r) => r.planarIdx).length}, all exact(<1e-9)=${unshifted.filter((r) => r.planarIdx).every((r) => r.dTruckIndex < 1e-9)}`);
console.log(`OCCT follows index pairing (|OCCT-index|<1e-9) in ${rows.filter((r) => r.dOcctIndex < 1e-9).length} of ${rows.length}; where it does not: ${rows.filter((r) => r.dOcctIndex >= 1e-9).map((r) => r.label).join('; ')}`);
