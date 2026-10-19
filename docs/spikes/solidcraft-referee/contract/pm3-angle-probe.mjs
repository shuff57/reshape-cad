// SPIKE, referee only. Round 3: the SAME call repeatAround(x,{count:3,angle:90}) on a whole solid and on a pocket/hole/pad.
// Prints where the copies actually land (angle of each copy about z), read from the ModelDoc the script produces
// (pocket: the lowered sketch centres; solid: the pattern feature + OCCT/brep-rs volume-weighted centre of mass of the copies).
// usage: SOLIDCRAFT_REFEREE_PKG=... bun pm3-angle-probe.mjs      (needs no solidcraft; OCCT and brep-rs only)
import { loadOracles, docOfScript } from './pm3-common.mjs';
const { occt, brepM } = await loadOracles();
const deg = (x, y) => +(Math.atan2(y, x) * 180 / Math.PI).toFixed(3);
// solid: count 3 boxes; the COM direction of the union of the copies is the mean angle of the copies (equal volumes, no overlap)
for (const [n, ang] of [[3, 90], [4, 90], [3, 180], [3, -90]]) {
  const d = docOfScript(`const a = box(4,4,4,{at:[30,0,0]}); repeatAround(a, { count: ${n}, angle: ${ang} });`);
  const last = d.doc.features.at(-1);
  const o = occt(d.doc, last.id); const b = brepM(d.doc, last.id);
  const sp = last.totalAngle / last.count, sp1 = last.totalAngle / (last.count - 1);
  console.log(`SOLID count ${n} angle ${ang}: pattern.totalAngle=${last.totalAngle} OCCT bbox ${o.bbox.map((v) => +v.toFixed(3))} vol ${o.volume.toFixed(3)}; brep bbox ${b.bbox?.map((v) => +v.toFixed(3))}; model rule angle/count=${sp} deg (copies at 0,${sp},...) vs n-1 rule ${sp1} deg`);
  // mean angle of the copies, expected under each rule, versus the measured COM angle (needs com: OCCT com is in occt())
  const mean = (step) => { let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += Math.cos(i * step * Math.PI / 180); sy += Math.sin(i * step * Math.PI / 180); } return deg(sx, sy); };
  console.log(`   measured COM direction ${deg(o.com[0], o.com[1])} deg; predicted mean copy angle: angle/count rule ${mean(sp)} deg, angle/(n-1) rule ${mean(sp1)} deg`);
}
// pocket and hole and pad: read the lowered sketch centres
const srcs = {
  pocket: `const sk1 = sketch('top'); sk1.circle(100); const plate = extrude(sk1, 10); const p1 = sketch('top', 10); p1.circle(4, { at: [30, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 3, angle: 90 });`,
  hole: `const d = cylinder(100, 10, { at: [0, 0, 5] }); const h = hole(d, { across: 4, at: [30, 0] }); repeatAround(h, { count: 3, angle: 90 });`,
  pad: `const sk1 = sketch('top'); sk1.circle(100); const plate = extrude(sk1, 5); const s2 = sketch('top', 5); s2.circle(4, { at: [30, 0] }); const b = extrude(s2, 6); const bl = repeatAround(b, { count: 3, angle: 90 }); join(plate, bl);`,
};
for (const [k, src] of Object.entries(srcs)) {
  const d = docOfScript(src);
  if (d.error) { console.log(k, 'SCRIPT ERROR', d.error); continue; }
  const cs = [];
  for (const f of d.doc.features) {
    if (f.kind === 'sketch' && f.shape === 'circle' && f.points) { const [a, b] = f.points; cs.push(deg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)); }
    if (f.kind === 'hole' && f.center) cs.push(deg(f.center[0], f.center[1]));
  }
  console.log(`${k.toUpperCase()} count 3 angle 90: feature kinds ${d.doc.features.map((f) => f.kind).join(',')}; copy angles about z (from the lowered doc): ${JSON.stringify(cs)}`);
}
