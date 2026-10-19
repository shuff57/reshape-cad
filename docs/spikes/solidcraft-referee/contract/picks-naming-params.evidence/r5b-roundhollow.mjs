// Round 5 (critic round 2). round()/bevel() of an edge of the open face's own rim, THEN hollow() with that face open (the order not covered by G-RIM, which is hollow THEN round).
//   closed form (plane-offset cavity, open top): V = Vsolid - 36*26*18 + air,   Vsolid = 24000 - (1-pi/4) r^2 * 40,
//   air = 36 * integral over y in [t, r] of (r - sqrt(r^2-(r-y)^2)) dy  (cavity wall plane y = t lies outside the rounded body above the arc) = 0 when r <= t.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5b-roundhollow.mjs            [r3-run-sec.mjs r5b-roundhollow.mjs  for the guarded run]
import { T, save, L, out } from './common.mjs';
const t = 2;
const air = (r) => { if (r <= t) return 0; const N = 200000; let s = 0; for (let i = 0; i < N; i++) { const y = t + ((r - t) * (i + 0.5)) / N; s += r - Math.sqrt(r * r - (r - y) * (r - y)); } return (s * (r - t)) / N * 36; };
const closed = (r) => 24000 - (1 - Math.PI / 4) * r * r * 40 - 36 * 26 * 18 + air(r);
for (const r of [0.5, 1, 1.5, 1.9, 2, 2.5, 3]) {
  const o = await T(`round r=${r} top|front THEN hollow wall 2 open top`, `const b = cuboid(40,30,20);\nround(b.edge('top','front'), ${r});\nhollow(b, { wall: 2, open: 'top' });`, { control: false });
  o.closedForm = closed(r); o.r = r;
  if (o.truck) console.log('    closed form', closed(r).toFixed(4), 'SC', o.truck.volume.toFixed(4), 'rel', (Math.abs(o.truck.volume - closed(r)) / closed(r)).toExponential(2), 'faces SC/OCCT/brep', o.truck.faces, o.ref?.occt?.faces, o.ref?.brep?.faces);
}
for (const r of [1, 2, 3]) {
  const o = await T(`bevel d=${r} top|front THEN hollow wall 2 open top`, `const b = cuboid(40,30,20);\nbevel(b.edge('top','front'), ${r});\nhollow(b, { wall: 2, open: 'top' });`, { control: false });
  // no closed form here: OCCT, brep-rs and SolidCraft build the same offset chamfered cavity (the plane-offset reading does not apply to a bevelled rim)
}
save('r5b-roundhollow.json');
