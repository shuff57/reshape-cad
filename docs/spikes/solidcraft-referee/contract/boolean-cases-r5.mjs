// SPIKE, referee only (contract / booleans group, fix round 1 = critic round 3). Thin CURVED keeps with a CLOSED-FORM answer, the critic's own repros (crit-sph-keep-3, crit-side-keep-*) widened over radius and depth.
// The harness bar is the plain relative one again (3e-4 on volume), so these decide where a thin curved remainder is still honest. ids start r5-. Each case has `analytic` (spherical cap / circular segment prism).
import { CASES } from './boolean-cases.mjs';
const PI = Math.PI;
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const cap = (R, h) => PI * h * h * (3 * R - h) / 3;
const seg = (R, d) => R * R * Math.acos((R - d) / R) - (R - d) * Math.sqrt(2 * R * d - d * d);
const F = { sph: 'thin keep of a ball that dips a few mm into a box face (spherical cap)', side: 'thin keep of a vertical cylinder that dips a few mm into a box side (circular segment)' };
for (const R of [10, 20, 40]) for (const d of [1, 2, 3, 5]) {
  if (R === 10 && d > 5) continue;
  // box 100x100x20 (z -10..10); the ball sits above the top face and dips d mm into it
  CASES.push({ id: `r5-sph-keep-r${R}-d${d}`, feature: F.sph, script: `const a = ${B(100, 100, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, analytic: cap(R, d), note: `ball r${R}, ${d} mm into the top face; closed form spherical cap` });
  // vertical cylinder r R, 40 tall, centred so its side dips d mm into the x=+50 face of the box
  CASES.push({ id: `r5-side-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 100, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; keep(a,c)`, analytic: seg(R, d) * 20, note: `cylinder r${R}, ${d} mm into the x=50 side; closed form circular segment x 20` });
}

// ---- probe set A (fit the rule; every case has a closed form) and held-out set B (checked AFTER the rule is chosen) ------------------------------------------------------------
const probe = (set, kind, R, d) => CASES.push(kind === 'sph'
  ? { id: `r5${set}-sph-keep-r${R}-d${d}`, feature: F.sph, script: `const a = ${B(100, 100, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, analytic: cap(R, d), note: `probe ${set}: ball r${R}, ${d} mm into the top face` }
  : { id: `r5${set}-side-keep-r${R}-d${d}`, feature: F.side, script: `const a = ${B(100, 100, 20)}; const c = ${C(R, 40, [50 + R - d, 0, 0])}; keep(a,c)`, analytic: seg(R, d) * 20, note: `probe ${set}: cylinder r${R}, ${d} mm into the x=50 side` });
for (const [R, d] of [[40, 4], [40, 6], [60, 3], [60, 5], [60, 6], [60, 8], [30, 2], [30, 3], [30, 4], [80, 6], [80, 8], [80, 10]]) probe('a', 'sph', R, d);
for (const [R, d] of [[60, 3], [60, 5], [60, 8], [80, 3], [80, 5], [80, 8]]) probe('a', 'side', R, d);
// held-out set B: radii and depths NOT used to choose the ball rule (BALL_KEEP_FRAC in booleans.guard.mjs); run after the rule was fixed
for (const [R, d] of [[50, 3], [50, 5], [100, 7], [100, 10], [25, 2.4], [25, 3], [70, 7], [15, 2], [120, 10], [120, 12], [45, 4], [90, 8]]) probe('b', 'sph', R, d);
for (const [R, d] of [[30, 3], [100, 3], [100, 6]]) probe('b', 'side', R, d);
// sweep set (raw kernel, to see the shape of the error, NO closed-form choice made from it alone): ball radius x depth fraction on a 400x400x20 box (the cap never reaches a box side), and the same kind of cap on a 100x100x20 box where it spills over the sides
for (const R of [20, 60, 120, 200]) for (const f of [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.3]) { const d = +(R * f).toFixed(2);
  CASES.push({ id: `r5s-sph-keep-r${R}-f${f}`, feature: F.sph, script: `const a = ${B(400, 400, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, analytic: cap(R, d), note: `sweep: ball r${R}, depth ${d} (${f} R), 400x400 box` }); }
for (const [R, d] of [[120, 8], [120, 16], [120, 20], [120, 30], [60, 15], [60, 20], [60, 30]]) CASES.push({ id: `r5s-spill-sph-keep-r${R}-d${d}`, feature: F.sph, script: `const a = ${B(100, 100, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, note: `sweep: ball r${R}, ${d} mm into a 100x100 box; the cap base is wider than the box, so no closed form here (OCCT only)` });
// held-out set C: chosen after the spill rule (G3b) and the 0.1 R rule; ball radius and box width not in any earlier set
for (const [R, d] of [[150, 12], [150, 16], [150, 25], [90, 10], [90, 14], [45, 8], [45, 12], [75, 15], [75, 25]]) CASES.push({ id: `r5c-sph-keep-r${R}-d${d}`, feature: F.sph, script: `const a = ${B(100, 100, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, note: `held-out C: ball r${R}, ${d} mm into a 100x100 box (OCCT only when the cap spills)`, ...(Math.sqrt(2 * R * d - d * d) <= 50 && d <= 20 ? { analytic: cap(R, d) } : {}) });
for (const [R, d] of [[150, 15], [150, 30], [90, 6], [90, 9], [45, 3], [45, 5]]) CASES.push({ id: `r5c-wide-sph-keep-r${R}-d${d}`, feature: F.sph, script: `const a = ${B(400, 400, 20)}; const s = ${S(R, [0, 0, 10 + R - d])}; keep(a,s)`, analytic: cap(R, d), note: `held-out C: ball r${R}, ${d} mm into a 400x400 box` });
