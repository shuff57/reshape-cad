// SPIKE, referee only (contract / booleans group, round 4 = critic round 2). More cases for run-booleans.mjs; pushes onto the CASES array of boolean-cases.mjs. ids start r4-.
// Same conventions as r3 (B/C/S/K take REAL radii and write the DIAMETER the script wants; every shape has `at`).
import { CASES } from './boolean-cases.mjs';
const PI = Math.PI;
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const K = (r, h, at = [0, 0, 0]) => `cone(${2 * r},${h},{at:[${at}]})`;
const T = (shape, ang) => `turn(${shape}, [${ang}])`;
const F = {
  alias: 'official alias names union / subtract / intersect',
  arr: 'a list given to join / cut / keep instead of separate shapes',
  fromOps: 'operands that are the result of mirror, repeat, repeatAround, hollow, round or bevel',
  coax: 'two cylinders on one axis with the same radius (shared wall)',
  ring: 'spin() tube whose profile has an edge on the sketch axis line',
  slow: 'round shape meeting a flat face at a slant (kernel needs minutes): predicted by the guard',
  fast: 'turned operands that stay fast (relative alignment square, or surfaces never meet)',
  inner: 'nested perpendicular cylinder wholly inside another',
};
CASES.push(
  // ---- aliases ----------------------------------------------------------------------------------------------------------------------
  { id: 'r4-alias-union', feature: F.alias, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; union(a,c)`, analytic: 32000 + PI * 64 * 20 },
  { id: 'r4-alias-subtract', feature: F.alias, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; subtract(a,c)`, analytic: 32000 - PI * 64 * 20 },
  { id: 'r4-alias-intersect', feature: F.alias, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; intersect(a,c)`, analytic: PI * 64 * 20 },
  { id: 'r4-alias-subtract3', feature: F.alias, script: `const a = ${B(40, 40, 20)}; const c = ${C(4, 40, [10, 0, 0])}; const d = ${C(4, 40, [-10, 0, 0])}; subtract(a,c,d)`, analytic: 32000 - 2 * PI * 16 * 20 },
  { id: 'r4-alias-union-one', feature: F.alias, script: `const a = ${B(40, 40, 20)}; union(a)`, note: 'alias with one shape: same sentence as join(a)' },
  // ---- a list instead of shapes -----------------------------------------------------------------------------------------------------
  { id: 'r4-arr-join-list', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; join([a, c])` },
  { id: 'r4-arr-cut-list', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; cut([a, c])` },
  { id: 'r4-arr-keep-list', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; keep([a, c])` },
  { id: 'r4-arr-join-var', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; const both = [a, c]; join(both)` },
  { id: 'r4-arr-cut-list-first', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40)}; const d = ${C(3, 40, [12, 0, 0])}; cut([a, c], d)` },
  { id: 'r4-arr-cut-list-tools', feature: F.arr, script: `const a = ${B(40, 40, 20)}; const c = ${C(4, 40, [10, 0, 0])}; const d = ${C(4, 40, [-10, 0, 0])}; cut(a, [c, d])` },
  // ---- operands from other features --------------------------------------------------------------------------------------------------
  { id: 'r4-op-mirror-join', feature: F.fromOps, script: `const a = ${B(20, 20, 20, [15, 0, 0])}; const m = mirror(a,'left-right'); const c = ${C(10, 40)}; join(m,c)`, note: 'two cubes 10 mm either side of the origin joined by a cylinder through both' },
  { id: 'r4-op-mirror-cut', feature: F.fromOps, script: `const p = ${B(60, 40, 20)}; const a = ${B(20, 20, 20, [15, 0, 0])}; const m = mirror(a,'left-right'); cut(p,m)`, analytic: 48000 - 16000 },
  { id: 'r4-op-mirror-keep', feature: F.fromOps, script: `const p = ${B(60, 40, 20)}; const a = ${B(20, 20, 20, [15, 0, 0])}; const m = mirror(a,'left-right'); keep(p,m)`, analytic: 16000 },
  { id: 'r4-op-repeat-cut', feature: F.fromOps, script: `const p = ${B(100, 30, 10, [25, 0, 5])}; const a = ${B(10, 10, 10, [0, 0, 5])}; const r = repeat(a,{count:3,step:[25,0,0]}); cut(p,r)`, analytic: 30000 - 3000 },
  { id: 'r4-op-repeat-join', feature: F.fromOps, script: `const p = ${B(100, 30, 10, [25, 0, 5])}; const a = ${B(10, 10, 10, [0, 0, 15])}; const r = repeat(a,{count:3,step:[25,0,0]}); join(p,r)`, analytic: 30000 + 3000 },
  { id: 'r4-op-repeat-keep', feature: F.fromOps, script: `const p = ${B(100, 30, 10, [25, 0, 5])}; const a = ${B(10, 10, 20, [0, 0, 5])}; const r = repeat(a,{count:3,step:[25,0,0]}); keep(p,r)`, analytic: 3000 },
  { id: 'r4-op-around-cut', feature: F.fromOps, script: `const p = ${C(50, 20)}; const a = ${C(6, 30, [25, 0, 0])}; const r = repeatAround(a,{count:4}); cut(p,r)`, analytic: PI * 20 * (2500 - 4 * 36) },
  { id: 'r4-op-around-join', feature: F.fromOps, script: `const p = ${C(10, 20)}; const a = ${C(6, 20, [20, 0, 0])}; const r = repeatAround(a,{count:4}); join(p,r)`, note: 'four pegs around a hub; they overlap the hub? no: 14 mm gap, so 5 separate pieces' },
  { id: 'r4-op-around-keep', feature: F.fromOps, script: `const p = ${C(30, 10)}; const a = ${C(6, 30, [20, 0, 0])}; const r = repeatAround(a,{count:4}); keep(p,r)`, analytic: 4 * PI * 36 * 10 },
  { id: 'r4-op-hollow-cut', feature: F.fromOps, script: `const a = ${B(40, 40, 40)}; const h = hollow(a,{wall:2}); const c = ${C(10, 60)}; cut(h,c)`, analytic: 64000 - 36 ** 3 - PI * 100 * 2 * 2, note: 'closed hollow box (a sealed void) cut by a cylinder through both walls' },
  { id: 'r4-op-hollow-join', feature: F.fromOps, script: `const a = ${B(40, 40, 40)}; const h = hollow(a,{wall:2}); const c = ${C(5, 20, [0, 0, 30])}; join(h,c)`, note: 'a post through the top wall of the closed hollow box' },
  { id: 'r4-op-hollow-keep', feature: F.fromOps, script: `const a = ${B(40, 40, 40)}; const h = hollow(a,{wall:2}); const c = ${B(60, 10, 60)}; keep(h,c)` },
  { id: 'r4-op-hollow-tool', feature: F.fromOps, script: `const p = ${B(80, 80, 60)}; const a = ${B(40, 40, 40)}; const h = hollow(a,{wall:2}); cut(p,h)`, analytic: 80 * 80 * 60 - (64000 - 36 ** 3), note: 'the hollow box as the TOOL: the 36 mm core is left as a separate piece' },
  { id: 'r4-op-round-cut', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; round(a, 3); const c = ${C(10, 40)}; cut(a,c)` },
  { id: 'r4-op-round-join', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; round(a, 3); const c = ${C(10, 30, [0, 0, 10])}; join(a,c)` },
  { id: 'r4-op-round-keep', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; round(a, 3); const c = ${C(25, 40)}; keep(a,c)` },
  { id: 'r4-op-bevel-cut', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; bevel(a.edge('top','front'), 2); const c = ${C(10, 40)}; cut(a,c)`, note: 'one chamfered edge' },
  { id: 'r4-op-bevel-join', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; bevel(a.edge('top','front'), 2); const c = ${C(10, 30, [0, 0, 10])}; join(a,c)` },
  { id: 'r4-op-bevel-keep', feature: F.fromOps, script: `const a = ${B(40, 40, 20)}; bevel(a.edge('top','front'), 2); const b = ${B(60, 60, 10, [0, 0, 5])}; keep(a,b)` },
  // ---- equal-radius coaxial cylinders (a shared wall) ------------------------------------------------------------------------------------
  { id: 'r4-coax-keep-partial', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 20, [0, 0, 10])}; keep(a,b)`, analytic: PI * 100 * 10 },
  { id: 'r4-coax-cut-partial', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 20, [0, 0, 10])}; cut(a,b)`, analytic: PI * 100 * 10 },
  { id: 'r4-coax-join-partial', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 20, [0, 0, 10])}; join(a,b)`, analytic: PI * 100 * 30 },
  { id: 'r4-coax-keep-contained', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 10, [0, 0, 0])}; keep(a,b)`, analytic: PI * 100 * 10 },
  { id: 'r4-coax-keep-longer', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 40, [0, 0, 0])}; keep(a,b)`, analytic: PI * 100 * 20 },
  { id: 'r4-coax-keep-partial-turned', feature: F.coax, script: `const a = ${T(C(10, 20, [0, 0, 0]), [90, 0, 0])}; const b = ${T(C(10, 20, [0, 0, 10]), [90, 0, 0])}; keep(a,b)`, note: 'same pair with the common axis turned to y: the rule must read the axis, not the world z' },
  { id: 'r4-coax-keep-pull', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const s = sketch('top', 0); s.circle(20); const p = pull(s, 20); keep(a,p)`, note: 'a round pull() that shares the wall of the cylinder' },
  { id: 'r4-coax-keep-three', feature: F.coax, script: `const a = ${C(10, 20, [0, 0, 0])}; const b = ${C(10, 20, [0, 0, 10])}; const c = ${B(40, 40, 8, [0, 0, 5])}; keep(a,b,c)`, note: 'three operands, two of them share a wall' },
  // ---- spin() tube whose profile has an edge on the sketch axis line ---------------------------------------------------------------------
  { id: 'r4-ring-base0-cut', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 10, 40, [0, 0, 7.5])}; cut(t,b)`, note: 'critic repro (oracle 12211.89)' },
  { id: 'r4-ring-base0-keep', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 10, 40, [0, 0, 7.5])}; keep(t,b)` },
  { id: 'r4-ring-base0-join', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 10, 40, [0, 0, 7.5])}; join(t,b)` },
  { id: 'r4-ring-centred-cut', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,-7.5],[20,-7.5],[20,7.5],[10,7.5]]); const t = spin(s,360); const b = ${B(60, 10, 40)}; cut(t,b)`, note: 'control: the same tube centred on the sketch origin (round 3 supported this)' },
  { id: 'r4-ring-shifted-cut', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,2],[20,2],[20,17],[10,17]]); const t = spin(s,360); const b = ${B(60, 10, 40, [0, 0, 9.5])}; cut(t,b)`, note: 'control: the tube lifted off the sketch axis line' },
  { id: 'r4-ring-base0-tool', feature: F.ring, script: `const a = ${B(60, 60, 30, [0, 0, 7.5])}; const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); cut(a, spin(s,360))`, note: 'the same tube as the TOOL (G10 territory)' },
  // the critic's tube: the same profile with slabs of several widths and both directions through the axis
  { id: 'r4-ring-base0-w2', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 2, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-wx2', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(2, 60, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-w4', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 4, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-wx4', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(4, 60, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-w5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 5, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-wx5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(5, 60, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-w6', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 6, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-wx6', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(6, 60, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-w8', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 8, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-wx8', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(8, 60, 40, [0, 0, 7.5])}; cut(t,b)` },
  { id: 'r4-ring-base0-flush-w5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 5, 15, [0, 0, 7.5])}; cut(t,b)`, note: 'slab 15 mm tall centred at z=7.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  { id: 'r4-ring-base0-flush-w10', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 10, 15, [0, 0, 7.5])}; cut(t,b)`, note: 'slab 15 mm tall centred at z=7.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  { id: 'r4-ring-base0-flush-w6', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 6, 15, [0, 0, 7.5])}; cut(t,b)`, note: 'slab 15 mm tall centred at z=7.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  { id: 'r4-ring-base0-flushbot-w5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 5, 25, [0, 0, 12.5])}; cut(t,b)`, note: 'slab 25 mm tall centred at z=12.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  { id: 'r4-ring-base0-flushtop-w5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 5, 25, [0, 0, 2.5])}; cut(t,b)`, note: 'slab 25 mm tall centred at z=2.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  { id: 'r4-ring-base0-tall-w5', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[10,0],[20,0],[20,15],[10,15]]); const t = spin(s,360); const b = ${B(60, 5, 40, [0, 0, 7.5])}; cut(t,b)`, note: 'slab 40 mm tall centred at z=7.5: coplanar with the tube end faces where its height is 15 (flush) or one end flush' },
  // ---- round shape meeting a flat face at a slant ------------------------------------------------------------------------------------
  { id: 'r4-slow-cyl-bx45-cut', feature: F.slow, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${C(6, 50)}; cut(a,c)` },
  { id: 'r4-slow-cyl-bx45-join', feature: F.slow, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${C(6, 50)}; join(a,c)` },
  { id: 'r4-slow-cyl-bx45-keep', feature: F.slow, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${C(6, 50)}; keep(a,c)` },
  { id: 'r4-slow-cylcut-b20_30_10', feature: F.slow, script: `const c = ${C(6, 50)}; const b = ${T(B(30, 30, 30), [20, 30, 10])}; cut(c,b)`, note: 'critic seed 8 shape: vertical cylinder cut by a generically turned box (95 s cpu for the critic)' },
  { id: 'r4-slow-cylkeep-b45_60_45', feature: F.slow, script: `const c = ${C(6, 50)}; const b = ${T(B(30, 30, 30), [45, 60, 45])}; keep(c,b)`, note: 'critic seed 46 shape (38 s cpu for the critic)' },
  { id: 'r4-slow-tilted-cyl-box-cut', feature: F.slow, script: `const a = ${B(40, 40, 20)}; const c = ${T(C(8, 60), [30, 20, 10])}; cut(a,c)`, note: 'the round-3 case r3-rot-cyl-cut-skew (25.7 s cpu in round 3)' },
  { id: 'r4-slow-tilted-cyl-box-join', feature: F.slow, script: `const a = ${B(40, 40, 20)}; const c = ${T(C(8, 60), [30, 20, 10])}; join(a,c)` },
  { id: 'r4-slow-tilted-cyl-box-keep', feature: F.slow, script: `const a = ${B(40, 40, 20)}; const c = ${T(C(8, 60), [30, 20, 10])}; keep(a,c)` },
  { id: 'r4-slow-cyl-x45-box', feature: F.slow, script: `const a = ${B(30, 30, 30)}; const c = ${T(C(6, 50), [45, 0, 0])}; cut(a,c)`, note: 'a hole drilled at 45 degrees through an axis-aligned block' },
  { id: 'r4-slow-nested-join', feature: F.slow, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${C(6, 50)}; const d = ${B(10, 10, 10, [0, 0, 40])}; join(join(a,d),c)`, note: 'the slanted box reached through an earlier join (the operand is a combine result)' },
  // ---- turned operands that stay fast --------------------------------------------------------------------------------------------------------
  { id: 'r4-fast-cyl-bz45-cut', feature: F.fast, script: `const a = ${T(B(30, 30, 30), [0, 0, 45])}; const c = ${C(6, 50)}; cut(a,c)`, note: 'a box turned about z only: its faces stay parallel to the vertical cylinder axis' },
  { id: 'r4-fast-cyl-bz45-keep', feature: F.fast, script: `const a = ${T(B(30, 30, 30), [0, 0, 45])}; const c = ${C(6, 50)}; keep(a,c)` },
  { id: 'r4-fast-pair-x45-cut', feature: F.fast, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${T(C(6, 50), [45, 0, 0])}; cut(a,c)`, note: 'cylinder and box turned together: square again' },
  { id: 'r4-fast-pair-x45-join', feature: F.fast, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${T(C(6, 50), [45, 0, 0])}; join(a,c)` },
  { id: 'r4-fast-pair-x45-keep', feature: F.fast, script: `const a = ${T(B(30, 30, 30), [45, 0, 0])}; const c = ${T(C(6, 50), [45, 0, 0])}; keep(a,c)` },
  { id: 'r4-fast-inside-x45-cut', feature: F.fast, script: `const a = ${T(B(40, 40, 40), [45, 0, 0])}; const c = ${C(3, 10)}; cut(a,c)`, note: 'small vertical cylinder wholly inside a turned box: the surfaces never meet' },
  { id: 'r4-fast-inside-x45-join', feature: F.fast, script: `const a = ${T(B(40, 40, 40), [45, 0, 0])}; const c = ${C(3, 10)}; join(a,c)` },
  { id: 'r4-fast-inside-x45-keep', feature: F.fast, script: `const a = ${T(B(40, 40, 40), [45, 0, 0])}; const c = ${C(3, 10)}; keep(a,c)` },
  // ---- what the next step does with a join that only touches along an edge (the reason the join of touching shapes is refused) ------------------------------
  { id: 'r4-touch-edge-join-hollow', feature: 'join of shapes that touch along an edge, then hollow()', script: `const a = ${B(20, 20, 20)}; const b = ${B(20, 20, 20, [20, 20, 0])}; const j = join(a,b); hollow(j,{wall:2})`, note: 'as shipped the join builds (one body, two shells); the question is what hollow() does with it' },
  { id: 'r4-touch-edge-join-cut', feature: 'join of shapes that touch along an edge, then a cut through the touching edge', script: `const a = ${B(20, 20, 20)}; const b = ${B(20, 20, 20, [20, 20, 0])}; const j = join(a,b); const c = ${C(4, 40, [10, 10, 0])}; cut(j,c)`, note: 'a vertical bore centred on the touching edge' },
  { id: 'r4-touch-edge-join-round', feature: 'join of shapes that touch along an edge, then a whole-shape round', script: `const a = ${B(20, 20, 20)}; const b = ${B(20, 20, 20, [20, 20, 0])}; const j = join(a,b); round(j, 2)`, note: 'round() of a joined handle: the interpreter may refuse it (whole-shape round is for box and cylinder)' },
  { id: 'r4-touch-face-cut-then-join', feature: 'cut with a tool that only touches a face, then a join with the unchanged part', script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15])}; const u = cut(a,b); const d = ${B(10, 10, 10, [0, 0, 15])}; join(u,d)`, note: 'the part comes back unchanged from the touching cut; a later join still works on it' },
  // ---- nested perpendicular cylinder (the sentence said they cross) ------------------------------------------------------------------------
  { id: 'r4-inner-perp-cut', feature: F.inner, script: `const a = ${C(15, 40)}; const b = ${T(C(3, 10), [90, 0, 0])}; cut(a,b)`, note: 'row 40 of round 3: a small cylinder with a perpendicular axis wholly inside a big one' },
  { id: 'r4-inner-perp-join', feature: F.inner, script: `const a = ${C(15, 40)}; const b = ${T(C(3, 10), [90, 0, 0])}; join(a,b)` },
  { id: 'r4-inner-perp-keep', feature: F.inner, script: `const a = ${C(15, 40)}; const b = ${T(C(3, 10), [90, 0, 0])}; keep(a,b)` },
);

// fuzz pairs and triples written by bool-fuzz-gen-r4.mjs (booleans-r4/fuzz-cases-<seed>.json), appended when present
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'booleans-r4');
  for (const f of readdirSync(dir).filter((x) => /^fuzz-cases-\d+\.json$/.test(x)).sort()) CASES.push(...JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
} catch { /* no fuzz files yet */ }
