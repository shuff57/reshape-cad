// SPIKE, referee only (contract / booleans group, fix round 2 = critic round 4). Pushes onto the CASES array of boolean-cases.mjs. ids start r6-.
// (1) side keep: a vertical cylinder dipping d mm into a box SIDE, radius and depth swept past r100 (critic: r150 d3 is 9.8e-4 off the closed form), closed form = circular segment x height.
// (2) tangent cut leaving two pieces, then a later join / hole on the part (critic: unfused interface faces), plus near-tangent ligament / breach neighbours with a closed form.
// (3) big-ball keep through a thin plate (row 103): closed-form volume AND closed-form bounding box.
// (4) coaxial keep with the axis turned (row 91); (5) keep of two parallel cylinders that cross (a lens), the real shape of row 91's case and of the fuzz survivor fz13-052.
import { CASES } from './boolean-cases.mjs';
const PI = Math.PI;
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const K = (r, h, at = [0, 0, 0]) => `cone(${2 * r},${h},{at:[${at}]})`;
const T = (shape, ang) => `turn(${shape}, [${ang}])`;
const seg = (R, d) => R * R * Math.acos((R - d) / R) - (R - d) * Math.sqrt(2 * R * d - d * d);
const F = {
  side: 'thin keep of a vertical cylinder that dips a few mm into a box side (circular segment): radius and depth sweep',
  tan: 'cut of a cylinder through a box tangent to two sides, then a later feature on the part',
  near: 'cut of a cylinder through a box that leaves a thin wall (or breaches the side by a sliver) at the side',
  ball: 'keep of a large ball through a thin plate',
  coax: 'two cylinders on one axis, same radius, lengths overlapping in part, axis turned',
};
// (1) side keep. 100x100x20 box where the segment fits across y (sqrt(2Rd) <= 48), and a 100x400x20 box for every radius
for (const R of [100, 120, 135, 150, 200, 300, 500]) for (const d of [2.5, 3, 5, 8, 12]) {
  const w = Math.sqrt(2 * R * d - d * d);
  if (w <= 48) CASES.push({ id: `r6-side-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 100, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; keep(a,c)`, analytic: seg(R, d) * 20, note: `cylinder r${R}, ${d} mm into the x=50 side of a 100x100x20 box; closed form circular segment x 20` });
  CASES.push({ id: `r6-wide-side-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 400, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; keep(a,c)`, analytic: seg(R, d) * 20, note: `cylinder r${R}, ${d} mm into the x=50 side of a 100x400x20 box; closed form circular segment x 20` });
}
// the same dips as cut and join (neighbours): the critic found these fine (1.7e-5, 8.6e-5); kept so the row can say so with numbers
for (const [R, d] of [[150, 3], [300, 3], [500, 5]]) {
  const s = seg(R, d) * 20;
  CASES.push({ id: `r6-wide-side-cut-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 400, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; cut(a,c)`, analytic: 100 * 400 * 20 - s });
  CASES.push({ id: `r6-wide-side-join-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 400, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; join(a,c)`, analytic: 100 * 400 * 20 + PI * R * R * 40 - s });
}
// (2) tangent through-cuts and what follows
const tanBox = `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10, 10, 0])}; const u = cut(a,b);`;
CASES.push(
  { id: 'r6-tan2-then-join-big', feature: F.tan, script: `${tanBox} const c = ${B(10, 10, 10, [-15, -15, 15])}; join(u,c)`, note: 'critic repro: the join lands on the big lump; unfused interface faces gave area +200 mm2' },
  { id: 'r6-tan2-then-join-far', feature: F.tan, script: `${tanBox} const c = ${B(10, 10, 10, [-5, -5, 15])}; join(u,c)`, note: 'critic control' },
  { id: 'r6-tan2-then-hole', feature: F.tan, script: `${tanBox} hole(u,{across:6})`, note: 'critic repro: hole on the pinched part' },
  { id: 'r6-tan2-then-cut', feature: F.tan, script: `${tanBox} const d = ${C(3, 40, [-10, -10, 0])}; cut(u,d)`, analytic: 32000 - PI * 100 * 20 - PI * 9 * 20 },
  { id: 'r6-tan1-then-join', feature: F.tan, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10, 0, 0])}; const u = cut(a,b); const c = ${B(10, 10, 10, [-15, -15, 15])}; join(u,c)`, note: 'tangent to ONE side only (the row 66 case that stays supported), then a join' },
  { id: 'r6-tan1-then-hole', feature: F.tan, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10, 0, 0])}; const u = cut(a,b); hole(u,{across:6})` },
  { id: 'r6-tanopp-then-join', feature: F.tan, script: `const a = ${B(40, 80, 20)}; const b = ${C(20, 40)}; const u = cut(a,b); const c = ${B(10, 10, 10, [0, 35, 15])}; join(u,c)`, note: 'two opposite sides: two pieces, then a join onto one' },
  { id: 'r6-tan2-small', feature: F.tan, script: `const a = ${B(20, 20, 10)}; const b = ${C(5, 20, [5, 5, 0])}; cut(a,b)`, analytic: 4000 - PI * 25 * 10, note: 'the same two-side tangency at half size' },
  { id: 'r6-tan2-large', feature: F.tan, script: `const a = ${B(160, 160, 40)}; const b = ${C(40, 80, [40, 40, 0])}; cut(a,b)`, analytic: 160 * 160 * 40 - PI * 1600 * 40, note: 'the same two-side tangency at four times the size' },
  { id: 'r6-tan2-offset', feature: F.tan, script: `const a = ${B(40, 40, 20, [100, -50, 7])}; const b = ${C(10, 40, [110, -40, 7])}; cut(a,b)`, analytic: 32000 - PI * 100 * 20, note: 'the same, the box away from the origin' },
  { id: 'r6-tan2-cone', feature: F.tan, script: `const a = ${B(40, 40, 20)}; const b = ${K(10, 20, [10, 10, 0])}; cut(a,b)`, note: 'neighbour: a cone (base radius 10 on the bottom face) touching two sides at one point each' },
);
// near-tangent: the cylinder (r10) centre at 10-g in both x and y: a wall of g mm stays between the hole and each side (g>0), or the hole breaches both sides by |g| (g<0), cutting the corner lump free
for (const g of [1, 0.5, 0.1, 0.05, 0.01, 0.001, 0.0001]) CASES.push({ id: `r6-near-tan2-wall-${g}`, feature: F.near, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10 - g, 10 - g, 0])}; cut(a,b)`, analytic: 32000 - PI * 100 * 20, note: `two-side near tangency, wall ${g} mm` });
for (const g of [0.5, 0.1, 0.01, 0.001]) CASES.push({ id: `r6-near-tan2-breach-${g}`, feature: F.near, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10 + g, 10 + g, 0])}; cut(a,b)`, note: `the cylinder breaches both sides by ${g} mm: the corner piece falls free` });
// (3) ball through a thin plate: box 400x400x20 (z -10..10), ball radius R centred at 10+R-d (d = 0.3 R, deep enough to pass the 20 mm plate for R > 66)
const slab = (R, zc) => PI * (20 * R * R - ((zc + 10) ** 3 - (zc - 10) ** 3) / 3);   // ball x plate z -10..10, plate wide enough
for (const R of [60, 120, 140, 160, 180, 200, 250, 300]) {
  const d = +(0.3 * R).toFixed(2); const zc = 10 + R - d;
  const reach = Math.max(Math.sqrt(Math.max(0, R * R - (zc - 10) ** 2)), Math.sqrt(Math.max(0, R * R - (zc + 10) ** 2)));
  const through = zc - R <= -10 && reach <= 200;
  CASES.push({ id: `r6-ball-keep-r${R}`, feature: F.ball, script: `const a = ${B(400, 400, 20)}; const s = ${S(R, [0, 0, zc])}; keep(a,s)`, ...(through ? { analytic: slab(R, zc), bboxAnalytic: [-reach, -reach, -10, reach, reach, 10] } : {}), note: `ball r${R} centred at z ${zc}; the widest section is ${reach.toFixed(3)} mm out` });
}
for (const R of [140, 160, 200, 250]) for (const f of [0.1, 0.2]) {
  const d = +(f * R).toFixed(2); const zc = 10 + R - d; const reach = Math.sqrt(Math.max(0, R * R - (zc - 10) ** 2));
  if (d <= 20) continue;
  CASES.push({ id: `r6-ball-keep-r${R}-f${f}`, feature: F.ball, script: `const a = ${B(400, 400, 20)}; const s = ${S(R, [0, 0, zc])}; keep(a,s)`, ...(reach <= 200 ? { analytic: slab(R, zc), bboxAnalytic: [-reach, -reach, -10, reach, reach, 10] } : {}), note: `ball r${R}, ${d} mm deep` });
}
// (4) coaxial keep, same radius, partial overlap, axis turned. The centre of the second cylinder lies ON the common (turned) axis, 10 mm along it.
// NOTE (fix round 2): the round-4 case r4-coax-keep-partial-turned put the second centre at [0,0,10] with the axis turned to y, which is NOT on the axis: those are two PARALLEL cylinders 10 mm apart (a lens keep), not a coaxial pair.
const rotM = (rot) => { const d = Math.PI / 180; const [ax, ay, az] = rot.map((v) => v * d); const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]; const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]; const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])); return mul(Rz, mul(Ry, Rx)); };
const axisOf = (rot) => { const R = rotM(rot); return [R[0][2], R[1][2], R[2][2]]; };
for (const [nm, ang] of [['x', [0, 90, 0]], ['y', [90, 0, 0]], ['z', [0, 0, 0]], ['gen', [30, 20, 10]]]) {
  const a = axisOf(ang).map((v) => +(10 * v).toFixed(9));
  CASES.push({ id: `r6-coax-keep-turned-${nm}`, feature: F.coax, script: `const a = ${T(C(10, 20, [0, 0, 0]), ang)}; const b = ${T(C(10, 20, a), ang)}; keep(a,b)`, analytic: PI * 100 * 10, note: `common axis ${nm}; second centre ${a} on the axis` });
}
// (5) keep of two PARALLEL cylinders that cross (a lens): closed form = lens area x common height. fz13-052 is (4, 10, distance 10); r4-coax-keep-partial-turned is (10, 10, distance 10) with the axis along y
const lens = (r1, r2, d) => { const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)); const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)); const k = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)); return a1 + a2 - k; };
const L = { feature: 'keep of two parallel cylinders that cross (a lens)' };
for (const [r1, r2, d, h] of [[4, 10, 10, 20], [10, 10, 10, 20], [10, 10, 15, 20], [10, 10, 5, 20], [10, 10, 18, 20], [20, 10, 15, 20], [20, 10, 25, 20], [30, 30, 30, 20], [50, 50, 60, 20], [5, 8, 9, 20], [10, 7, 12, 20]]) {
  CASES.push({ id: `r6-lens-keep-r${r1}-r${r2}-d${d}`, ...L, script: `const a = ${C(r1, 40, [0, 0, 0])}; const b = ${C(r2, h, [d, 0, 0])}; keep(a,b)`, analytic: lens(r1, r2, d) * h, note: `vertical cylinders r${r1} and r${r2}, axes ${d} apart; lens area x ${h}` });
}
for (const [nm, ang, off] of [['y', [90, 0, 0], [10, 0, 0]], ['x', [0, 90, 0], [0, 10, 0]]]) CASES.push({ id: `r6-lens-keep-turned-${nm}`, ...L, script: `const a = ${T(C(10, 20, [0, 0, 0]), ang)}; const b = ${T(C(10, 20, off), ang)}; keep(a,b)`, analytic: lens(10, 10, 10) * 20, note: `two r10 cylinders with axes along ${nm}, 10 apart` });
CASES.push({ id: 'r6-lens-keep-r4old', ...L, script: `const a = ${T(C(10, 20, [0, 0, 0]), [90, 0, 0])}; const b = ${T(C(10, 20, [0, 0, 10]), [90, 0, 0])}; keep(a,b)`, note: 'the exact round-4 case r4-coax-keep-partial-turned (its two cylinders are parallel, 10 apart, overlapping 10 along y): overlap is not a full-height lens, so no closed form is stored' });
// (6) held-out for the cylinder keep rule (CYL_KEEP_FRAC in booleans.guard.mjs): run AFTER the rule was chosen. Radii and depths not in any earlier set; depth fractions around the rule's 3.5 % of the radius.
const r1 = (v) => +v.toFixed(1);
for (const R of [110, 175, 250, 400, 700]) for (const f of [0.03, 0.04, 0.06]) {
  const d = r1(f * R);
  CASES.push({ id: `r6h-side-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 1000, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; keep(a,c)`, analytic: seg(R, d) * 20, note: `held-out: cylinder r${R}, ${d} mm (${f * 100} % of r) into the x=50 side of a 100x1000x20 box` });
}
// the same dip with the cylinder lying down (axis along x) into the top face of a 400x400x20 plate; and a round pull() cylinder (OCCT only)
for (const [R, d] of [[120, 3], [120, 5], [200, 3], [200, 8], [300, 5], [300, 12]]) {
  CASES.push({ id: `r6h-top-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(400, 400, 20)}; const c = ${T(C(R, 40, [0, 0, 10 + R - d]), [0, 90, 0])}; keep(a,c)`, analytic: seg(R, d) * 40, note: `held-out: cylinder r${R} lying along x, ${d} mm into the top face` });
}
for (const [R, d] of [[150, 3], [150, 8], [300, 5]]) {
  CASES.push({ id: `r6h-pull-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 1000, 20, [-(R - d) - 50, 0, 0])}; const s = sketch('top', 0); s.circle(${2 * R}); const p = pull(s, 40); keep(a,p)`, note: `held-out: a round pull() cylinder r${R} dipping ${d} mm into the side of a box; OCCT is the second measure` });
}
// (7) a cut that leaves a very thin remainder (G21): the fz17-023 shape and neighbours, closed form = integral of the cone outside the ball
const coneBall = (rc, hc, rb) => { // cone base radius rc at z=-hc/2, tip at +hc/2; ball radius rb at the origin; volume of cone outside ball, integrated numerically in z
  let v = 0; const n = 200000; const z0 = -hc / 2; for (let i = 0; i < n; i++) { const z = z0 + (hc * (i + 0.5)) / n; const rcz = rc * (hc / 2 - z) / hc; const rbz2 = Math.max(0, rb * rb - z * z); const dv = rcz * rcz - rbz2; if (dv > 0) v += PI * dv * (hc / n); } return v; };
CASES.push({ id: 'r6-tiny-cone-minus-ball', feature: 'a cut that leaves a very thin remainder', script: `const a = ${K(10, 20, [0, 0, 0])}; const b = ${S(14, [0, 0, 0])}; cut(a,b)`, analytic: coneBall(10, 20, 14), note: 'fz17-023 as a script: cone (r10, h20) minus a ball r14 leaves a 0.84 mm3 rim' });
for (const rb of [13.9, 14.05, 14.1, 13.5]) CASES.push({ id: `r6-tiny-cone-minus-ball-r${rb}`, feature: 'a cut that leaves a very thin remainder', script: `const a = ${K(10, 20, [0, 0, 0])}; const b = ${S(rb, [0, 0, 0])}; cut(a,b)`, analytic: coneBall(10, 20, rb), note: `cone r10 h20 minus a ball r${rb}` });
for (const rb of [12, 12.5, 13, 13.2, 13.4, 13.6, 13.7, 13.8]) CASES.push({ id: `r6-tiny-cone-minus-ball-r${rb}`, feature: 'a cut that leaves a very thin remainder', script: `const a = ${K(10, 20, [0, 0, 0])}; const b = ${S(rb, [0, 0, 0])}; cut(a,b)`, analytic: coneBall(10, 20, rb), note: `cone r10 h20 minus a ball r${rb}` });
for (const [k, rb] of [[2, 28], [2, 27.8], [2, 27.4], [2, 27], [2, 26], [0.5, 7], [0.5, 6.95], [0.5, 6.85], [0.5, 6.5]]) CASES.push({ id: `r6-tiny-cone-x${k}-minus-ball-r${rb}`, feature: 'a cut that leaves a very thin remainder', script: `const a = ${K(10 * k, 20 * k, [0, 0, 0])}; const b = ${S(rb, [0, 0, 0])}; cut(a,b)`, analytic: coneBall(10 * k, 20 * k, rb), note: `the cone scaled by ${k} minus a ball r${rb}` });
