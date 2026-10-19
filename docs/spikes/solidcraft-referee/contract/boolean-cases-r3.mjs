// SPIKE, referee only (contract/booleans group, round 3). More cases for run-booleans.mjs; pushes onto the CASES array of boolean-cases.mjs. ids start r3-.
// Same conventions: scripts take DIAMETERS for cylinder/sphere/ring/cone and are written with `at`; ModelDoc `features` only where the script surface cannot reach.
import { CASES } from './boolean-cases.mjs';
const PI = Math.PI;
const box = (id, size, center = [0, 0, 0], rotate) => ({ id, kind: 'box', size, center, ...(rotate ? { rotate } : {}) });
const cyl = (id, radius, height, center = [0, 0, 0], rotate) => ({ id, kind: 'cylinder', radius, height, center, ...(rotate ? { rotate } : {}) });
const tor = (id, ringRadius, tubeRadius, center = [0, 0, 0], rotate) => ({ id, kind: 'torus', ringRadius, tubeRadius, center, ...(rotate ? { rotate } : {}) });
const op = (id, o, targets) => ({ id, kind: 'combine', op: o, targets });
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const R = (Rr, r, at = [0, 0, 0]) => `ring(${2 * (Rr + r)},${2 * r},{at:[${at}]})`;
const K = (r, h, at = [0, 0, 0]) => `cone(${2 * r},${h},{at:[${at}]})`;
const F = {
  pieces: 'result with more than one solid: a cut or keep that separates the part, and what a later step may do with the pieces',
  nary: 'keep(a,b,c,...): three or more operands',
  tanThrough: 'cut whose round tool goes THROUGH the part and is tangent to its side faces along lines',
  torCyl: 'torus with a cylinder coaxial with it, tangent to the ring at a circle',
  sphIn: 'sphere with a smaller sphere inside it (hollow ball, off-centre void, internally tangent)',
  sphSph: 'sphere with sphere (union and cut: extra cone faces)',
  cone: 'cone as a combine operand',
  prismWedge: 'prism or wedge as a combine operand',
  rounded: 'rounded box (corner:) as a combine operand',
  rotated: 'operands turned by a generic angle (turn(.., [30,20,10]))',
  band: 'overlap between 4e-3 mm and 0.1 mm (and the thin-overlap thresholds for round tools)',
  ring: 'spin() of a ring profile (tube) as a cut or keep operand, and a tube as the TARGET',
  arity: 'two-or-more-shapes rule: wrong kind of argument',
  policy: 'cut or keep that touches nothing (policy refusal, not an engine limit)',
};
CASES.push(
  // ---- pieces: cuts that separate the part -------------------------------------------------------------------------------------------
  { id: 'r3-split-slot', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 60, 30)}; cut(a,b)`, analytic: 32000 - 10 * 40 * 20 },
  { id: 'r3-split-cross4', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const p = ${B(10, 60, 30)}; const q = ${B(60, 10, 30)}; cut(a,p,q)`, note: 'n-ary cut: two slabs crossing leave four corner blocks', analytic: 32000 - (2 * 10 * 40 * 20 - 10 * 10 * 20) },
  { id: 'r3-split-boxbox-small', feature: F.pieces, script: `const a = ${B(20, 10, 10)}; const b = ${B(4, 30, 30)}; cut(a,b)`, analytic: 2000 - 4 * 10 * 10 },
  { id: 'r3-split-ball-corners', feature: F.pieces, script: `const a = ${B(40, 40, 40)}; const s = ${S(30)}; cut(a,s)`, note: 'sphere r30 cuts every edge (edge midpoints 28.3 from the centre) and no corner (34.6): eight corner solids' },
  { id: 'r3-split-cone-slab', feature: F.pieces, script: `const c = ${K(12, 30)}; const b = ${B(40, 4, 60, [0, 0, 15])}; cut(c,b)`, note: 'a slab through the axis of a cone: two half cones' },
  { id: 'r3-split-cyl-bar', feature: F.pieces, script: `const a = ${C(15, 10)}; const b = ${B(40, 4, 20)}; cut(a,b)`, note: 'slit through a disc' , analytic: PI * 225 * 10 - (2 * (15 * 15 * Math.acos(2 / 15) - 2 * Math.sqrt(225 - 4)) * 10) },
  { id: 'r3-split-keep-two-cyl', feature: F.pieces, script: `const a = ${B(60, 20, 20)}; const b = ${C(8, 30, [-20, 0, 0])}; const c = ${C(8, 30, [20, 0, 0])}; const d = join(b,c); keep(a,d)`, analytic: 2 * PI * 64 * 20 },
  { id: 'r3-split-then-cut-other', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const c = ${C(4, 40, [12, 0, 0])}; const u = cut(a,slot); cut(u,c)`, analytic: 24000 - PI * 16 * 20, note: 'the second tool touches only the x>5 piece' },
  { id: 'r3-split-then-cut-both', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const bar = ${B(60, 10, 10, [0, 0, 5])}; const u = cut(a,slot); cut(u,bar)`, analytic: 24000 - 2 * 15 * 10 * 10, note: 'one tool bar across BOTH pieces' },
  { id: 'r3-split-then-join-other', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const d = ${B(10, 10, 10, [20, 0, 15])}; const u = cut(a,slot); join(u,d)`, analytic: 25000 },
  { id: 'r3-split-bridge', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const br = ${B(20, 10, 4, [0, 0, 8])}; const u = cut(a,slot); join(u,br)`, note: 'a bridge across the slot joins the two pieces into ONE solid', analytic: 24000 + 10 * 10 * 4 },
  { id: 'r3-split-keep-after', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const k = ${B(60, 20, 30)}; const u = cut(a,slot); keep(u,k)`, analytic: 2 * 15 * 20 * 20 },
  { id: 'r3-split-resplit', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const s1 = ${B(10, 60, 30)}; const s2 = ${B(6, 60, 30, [14, 0, 0])}; const u = cut(a,s1); cut(u,s2)`, analytic: 32000 - 10 * 40 * 20 - 6 * 40 * 20, note: 'the second slot cuts the x>5 piece again' },
  { id: 'r3-split-as-tool', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const w = ${B(100, 60, 20)}; const u = cut(a,slot); cut(w,u)`, analytic: 120000 - 24000, note: 'the TOOL is two pieces' },
  { id: 'r3-split-as-keep-tool', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const w = ${B(100, 60, 20)}; const u = cut(a,slot); keep(w,u)`, analytic: 24000 },
  { id: 'r3-split-cut3-pieces', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const c1 = ${C(3, 40, [12, 0, 0])}; const c2 = ${C(3, 40, [-12, 0, 0])}; const u = cut(a,slot); cut(u,c1,c2)`, analytic: 24000 - 2 * PI * 9 * 20, note: 'n-ary cut of a two-piece handle' },
  { id: 'r3-split-then-hole', feature: F.pieces, script: `const a = ${B(40, 40, 20)}; const slot = ${B(10, 60, 30)}; const u = cut(a,slot); hole(u,{across:6})`, note: 'a later hole() on a handle that is two pieces (not a combine)' },
  // ---- n-ary keep ---------------------------------------------------------------------------------------------------------------------
  { id: 'r3-keep-slabs-empty', feature: F.nary, script: `const a = ${B(20, 20, 20)}; const b = ${B(20, 20, 20, [15, 0, 0])}; const c = ${B(20, 20, 20, [30, 0, 0])}; keep(a,b,c)`, note: 'a&b and b&c overlap but a&b&c is empty (the n-ary form wrongly gave 2000)' },
  { id: 'r3-keep-apq', feature: F.nary, script: `const a = ${B(40, 40, 20)}; const p = ${B(20, 60, 60)}; const q = ${B(60, 20, 60)}; keep(a,p,q)`, analytic: 20 * 20 * 20 },
  { id: 'r3-keep-four-boxes', feature: F.nary, script: `const a = ${B(40, 40, 40)}; const b = ${B(30, 60, 60)}; const c = ${B(60, 30, 60)}; const d = ${B(60, 60, 30)}; keep(a,b,c,d)`, analytic: 30 * 30 * 30 },
  { id: 'r3-keep-three-cyl', feature: F.nary, script: `const a = ${B(40, 40, 20)}; const b = ${C(15, 40)}; const c = ${B(20, 60, 60)}; keep(a,b,c)`, note: 'same as keep-three; kept here as the n-ary control' },
  { id: 'r3-keep-split-first', feature: F.nary, script: `const a = ${B(60, 20, 20)}; const b = ${C(8, 30, [-20, 0, 0])}; const c = ${C(8, 30, [20, 0, 0])}; const d = join(b,c); const e = ${B(100, 12, 12)}; keep(a,d,e)`, note: 'a&d is two pieces, then &e must act on BOTH pieces' },
  { id: 'r3-keep-split-first-lost', feature: F.nary, script: `const a = ${B(60, 20, 20)}; const b = ${C(8, 30, [-20, 0, 0])}; const c = ${C(8, 30, [20, 0, 0])}; const d = join(b,c); const e = ${B(10, 12, 12, [-20, 0, 0])}; keep(a,d,e)`, note: 'a&d is two pieces; &e keeps one of them only' },
  // ---- through-cylinder tangent to side faces -----------------------------------------------------------------------------------------
  { id: 'r3-tan-cyl-through-4', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(20, 40)}; cut(a,b)`, note: 'critic repro: cylinder r20 through a 40x40 box, tangent to all four sides' },
  { id: 'r3-tan-cyl-through-1', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10, 0, 0])}; cut(a,b)`, analytic: 32000 - PI * 100 * 20, note: 'tangent to the x=20 side only' },
  { id: 'r3-tan-cyl-through-2', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 40, [10, 10, 0])}; cut(a,b)`, analytic: 32000 - PI * 100 * 20, note: 'tangent to two adjacent sides' },
  { id: 'r3-tan-cyl-through-x', feature: F.tanThrough, features: [box('a', [60, 20, 20]), cyl('c', 10, 80, [0, 0, 0], [0, 90, 0]), op('op1', 'subtract', ['a', 'c'])], analytic: 24000 - PI * 100 * 60, note: 'axis along x through a 20x20 section, tangent to four sides' },
  { id: 'r3-tan-cyl-blind-1', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(10, 10, [10, 0, 5])}; cut(a,b)`, analytic: 32000 - PI * 100 * 10, note: 'blind bore from the top face, tangent to the x=20 side' },
  { id: 'r3-tan-cyl-through-join', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(20, 40)}; join(a,b)`, note: 'join of the same pair: the cylinder is bigger than the box in z and tangent in x,y' },
  { id: 'r3-tan-cyl-through-keep', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${C(20, 40)}; keep(a,b)`, analytic: PI * 400 * 20 },
  { id: 'r3-tan-sph-in-1', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${S(5, [0, 0, 5])}; cut(a,b)`, analytic: 32000 - 4 / 3 * PI * 125, note: 'ball wholly inside, touching the top face at one point' },
  { id: 'r3-tan-cyl-side-in-1', feature: F.tanThrough, features: [box('a', [40, 40, 20]), cyl('c', 5, 20, [0, 0, 5], [90, 0, 0]), op('op1', 'subtract', ['a', 'c'])], analytic: 32000 - PI * 25 * 20, note: 'cylinder lying along y wholly inside, touching the top face along a line' },
  { id: 'r3-tan-cyl-through-opp', feature: F.tanThrough, script: `const a = ${B(40, 80, 20)}; const b = ${C(20, 40)}; cut(a,b)`, note: 'tangent to the two opposite sides x=+-20 only' },
  { id: 'r3-tan-cyl-through-3', feature: F.tanThrough, script: `const a = ${B(40, 60, 20)}; const b = ${C(20, 40, [0, 10, 0])}; cut(a,b)`, note: 'box 40x60: cylinder r20 centred at y=10 is tangent to x=-20, x=+20 and y=+30 (three sides)' },
  { id: 'r3-tan-cyl-through-4-small', feature: F.tanThrough, script: `const a = ${B(20, 20, 10)}; const b = ${C(10, 20)}; cut(a,b)`, note: 'the critic\'s four-sided repro at half the size' },
  { id: 'r3-tan-sph-big', feature: F.tanThrough, script: `const a = ${B(40, 40, 20)}; const b = ${S(20)}; cut(a,b)`, note: 'ball r20 crosses the top and bottom and touches the four sides at points' },
  // ---- torus with a cylinder tangent to it ----------------------------------------------------------------------------------------------
  { id: 'r3-tor-cyl-inner-join', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(10, 12)}; join(t,c)`, note: 'cylinder radius 10 = R - r: touches the inner equator along a circle only' },
  { id: 'r3-tor-cyl-inner-cut', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(10, 12)}; cut(t,c)`, note: 'nothing is removed' },
  { id: 'r3-tor-cyl-inner-keep', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(10, 12)}; keep(t,c)`, note: 'nothing in common' },
  { id: 'r3-tor-cyl-outer-join', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(18, 12)}; join(t,c)`, note: 'cylinder radius 18 = R + r: the ring sits inside it touching the wall along a circle' },
  { id: 'r3-tor-cyl-outer-cut', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(18, 12)}; cut(c,t)`, note: 'ring-shaped void touching the wall' },
  { id: 'r3-tor-cyl-outer-keep', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(18, 12)}; keep(c,t)`, note: 'cylinder radius 18 = R + r encloses the ring and touches it along the outer equator: the common part is the whole ring' },
  { id: 'r3-trap-keep-cyl-1e-7', feature: F.policy, script: `const a = ${C(5, 10)}; const b = ${C(5, 10, [1e-7, 0, 0])}; keep(a,b)`, note: 'two equal cylinders 1e-7 mm apart: a REAL wasm trap (trap-hunt.mjs)' },
  { id: 'r3-trap-keep-box-1e-7', feature: F.policy, script: `const a = ${B(10, 10, 10)}; const b = ${B(10, 10, 10, [1e-7, 0, 0])}; keep(a,b)`, note: 'two equal boxes 1e-7 mm apart: the same trap' },
  { id: 'r3-tor-cyl-clear-join', feature: F.torCyl, script: `const t = ${R(14, 4)}; const c = ${C(8, 12)}; join(t,c)`, note: 'control: cylinder in the hole, 2 mm clear of the ring' },
  // ---- sphere inside a sphere ---------------------------------------------------------------------------------------------------------------
  { id: 'r3-sph-in-concentric-cut', feature: F.sphIn, script: `const s = ${S(15)}; const t = ${S(7)}; cut(s,t)`, analytic: 4 / 3 * PI * (3375 - 343), note: 'hollow ball' },
  { id: 'r3-sph-in-offcenter-cut', feature: F.sphIn, script: `const s = ${S(15)}; const t = ${S(5, [3, 0, 0])}; cut(s,t)`, analytic: 4 / 3 * PI * (3375 - 125), note: 'inner ball not touching the wall, off centre' },
  { id: 'r3-sph-in-tangent-cut', feature: F.sphIn, script: `const s = ${S(15)}; const t = ${S(5, [10, 0, 0])}; cut(s,t)`, note: 'inner ball touching the wall at a point' },
  { id: 'r3-sph-in-concentric-join', feature: F.sphIn, script: `const s = ${S(15)}; const t = ${S(7)}; join(s,t)`, analytic: 4 / 3 * PI * 3375 },
  { id: 'r3-sph-in-concentric-keep', feature: F.sphIn, script: `const s = ${S(15)}; const t = ${S(7)}; keep(s,t)`, analytic: 4 / 3 * PI * 343 },
  { id: 'r3-sph-in-cyl-void', feature: F.sphIn, script: `const s = ${S(15)}; const c = ${C(4, 10)}; cut(s,c)`, analytic: 4 / 3 * PI * 3375 - PI * 16 * 10, note: 'a cylinder wholly inside a ball (void)' },
  // ---- sphere with sphere: extra cone faces ----------------------------------------------------------------------------------------------
  { id: 'r3-sph-sph-union-b', feature: F.sphSph, script: `const s = ${S(10)}; const t = ${S(10, [8, 0, 0])}; join(s,t)` },
  { id: 'r3-sph-sph-cut-b', feature: F.sphSph, script: `const s = ${S(10)}; const t = ${S(10, [8, 0, 0])}; cut(s,t)` },
  { id: 'r3-sph-sph-union-diag', feature: F.sphSph, script: `const s = ${S(12)}; const t = ${S(8, [6, 6, 6])}; join(s,t)` },
  { id: 'r3-sph-sph-keep-b', feature: F.sphSph, script: `const s = ${S(10)}; const t = ${S(10, [8, 0, 0])}; keep(s,t)` },
  // ---- cone ----------------------------------------------------------------------------------------------------------------------------------------
  { id: 'r3-cone-cyl-coax-join', feature: F.cone, script: `const c = ${K(12, 30)}; const d = ${C(4, 50, [0, 0, 0])}; join(c,d)`, note: 'critic repro: coaxial cone r12 h30 and cylinder r4 h50' },
  { id: 'r3-cone-cyl-coax-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const d = ${C(4, 50)}; cut(c,d)` },
  { id: 'r3-cone-cyl-coax-keep', feature: F.cone, script: `const c = ${K(12, 30)}; const d = ${C(4, 50)}; keep(c,d)` },
  { id: 'r3-cone-cone-coax-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const d = ${K(6, 30, [0, 0, 5])}; cut(c,d)`, note: 'smaller cone inside, same axis' },
  { id: 'r3-cone-sph-centred-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const s = ${S(8, [0, 0, 5])}; cut(c,s)`, note: 'ball centred on the cone axis' },
  { id: 'r3-cone-cyl-parallel-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const d = ${C(3, 50, [5, 0, 0])}; cut(c,d)`, note: 'cylinder parallel to the cone axis, off axis' },
  { id: 'r3-cone-cyl-perp-cut', feature: F.cone, features: [{ id: 'k', kind: 'cone', radius: 12, height: 30, center: [0, 0, 0] }, cyl('c', 3, 50, [0, 0, 0], [90, 0, 0]), op('op1', 'subtract', ['k', 'c'])], note: 'cylinder crossing the cone axis at right angles' },
  { id: 'r3-cone-sph-off-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const s = ${S(6, [8, 0, 5])}; cut(c,s)`, note: 'ball off the cone axis' },
  { id: 'r3-cone-box-join', feature: F.cone, script: `const c = ${K(12, 30)}; const b = ${B(10, 10, 10, [0, 0, 5])}; join(c,b)` },
  { id: 'r3-cone-box-cut', feature: F.cone, script: `const c = ${K(12, 30)}; const b = ${B(10, 10, 10, [0, 0, 10])}; cut(c,b)`, note: 'a box over the tip of the cone (the first draft sat on the apex plane and removed nothing)' },
  { id: 'r3-cone-box-keep', feature: F.cone, script: `const c = ${K(12, 30)}; const b = ${B(40, 40, 10, [0, 0, 5])}; keep(c,b)` },
  // ---- prism, wedge -----------------------------------------------------------------------------------------------------------------------------
  { id: 'r3-prism-wedge-join', feature: F.prismWedge, script: `const p = prism(6, 30, 20, {at:[0,0,0]}); const w = wedge(20, 10, 15, {at:[20,0,0]}); join(p,w)` },
  { id: 'r3-prism-cut-cyl', feature: F.prismWedge, script: `const p = prism(6, 30, 20, {at:[0,0,0]}); const c = ${C(4, 40)}; cut(p,c)`, analytic: 3 * Math.sqrt(3) / 2 * 15 * 15 * 20 - PI * 16 * 20 },
  { id: 'r3-prism-keep-box', feature: F.prismWedge, script: `const p = prism(6, 30, 20, {at:[0,0,0]}); const b = ${B(10, 40, 40)}; keep(p,b)` },
  { id: 'r3-wedge-cut-box', feature: F.prismWedge, script: `const w = wedge(30, 20, 15, {at:[0,0,0]}); const b = ${B(10, 10, 20, [0, 0, 0])}; cut(w,b)` },
  { id: 'r3-wedge-keep-cyl', feature: F.prismWedge, script: `const w = wedge(30, 20, 15, {at:[0,0,0]}); const c = ${C(6, 30)}; keep(w,c)` },
  // ---- rounded box -------------------------------------------------------------------------------------------------------------------------------
  { id: 'r3-rnd-join-cyl', feature: F.rounded, script: `const a = box(40,40,20,{corner:4,at:[0,0,0]}); const b = ${C(6, 40)}; join(a,b)` },
  { id: 'r3-rnd-cut-cyl', feature: F.rounded, script: `const a = box(40,40,20,{corner:4,at:[0,0,0]}); const b = ${C(6, 40)}; cut(a,b)` },
  { id: 'r3-rnd-keep-box', feature: F.rounded, script: `const a = box(40,40,20,{corner:4,at:[0,0,0]}); const b = ${B(60, 20, 60)}; keep(a,b)` },
  { id: 'r3-rnd-cut-sph', feature: F.rounded, script: `const a = box(40,40,20,{corner:4,at:[0,0,0]}); const b = ${S(8, [0, 0, 10])}; cut(a,b)`, note: 'critic: about 50 s through the translator' },
  { id: 'r3-rnd-cut-rnd', feature: F.rounded, script: `const a = box(40,40,20,{corner:4,at:[0,0,0]}); const b = box(10,10,40,{corner:2,at:[8,0,0]}); cut(a,b)` },
  // ---- generic rotation ------------------------------------------------------------------------------------------------------------------------------
  { id: 'r3-rot-box-cut-cyl', feature: F.rotated, script: `const a = turn(box(40,30,20,{at:[0,0,0]}), [30,20,10]); const c = turn(${C(5, 60)}, [30,20,10]); cut(a,c)`, analytic: 24000 - PI * 25 * 20, note: 'both turned by the same angles about the origin: the bore stays square to the box' },
  { id: 'r3-rot-box-join-cyl', feature: F.rotated, script: `const a = turn(box(40,30,20,{at:[0,0,0]}), [30,20,10]); const c = turn(${C(5, 60)}, [30,20,10]); join(a,c)` },
  { id: 'r3-rot-box-keep-cyl', feature: F.rotated, script: `const a = turn(box(40,30,20,{at:[0,0,0]}), [30,20,10]); const c = turn(${C(5, 60)}, [30,20,10]); keep(a,c)`, analytic: PI * 25 * 20 },
  { id: 'r3-rot-box-cut-box', feature: F.rotated, script: `const a = turn(box(40,30,20,{at:[0,0,0]}), [30,20,10]); const b = turn(box(10,10,40,{at:[0,0,0]}), [30,20,10]); cut(a,b)`, analytic: 24000 - 10 * 10 * 20 },
  { id: 'r3-rot-cyl-cut-skew', feature: F.rotated, script: `const a = ${B(40, 40, 20)}; const c = turn(${C(4, 60)}, [30, 20, 10]); cut(a,c)`, note: 'box square, tool tilted: oblique bore (not a measured-safe cylinder case before)' },
  // ---- thin overlaps: 4e-3 to 0.1 mm, and round tools --------------------------------------------------------------------------------------------
  { id: 'r3-sl-cut-4.5e-3', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.0045])}; cut(a,b)`, analytic: 32000 - 100 * 0.0045 },
  { id: 'r3-sl-cut-0.02', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.02])}; cut(a,b)`, analytic: 32000 - 100 * 0.02 },
  { id: 'r3-sl-keep-4.5e-3', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.0045])}; keep(a,b)`, analytic: 100 * 0.0045 },
  { id: 'r3-sl-keep-0.05', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.05])}; keep(a,b)`, analytic: 100 * 0.05 },
  { id: 'r3-sl-cut-cylv-0.02', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${C(5, 20, [0, 0, 10 - 0.02 + 10])}; cut(a,b)`, analytic: 32000 - PI * 25 * 0.02, note: 'vertical cylinder, flat cap enters 0.02 mm (curved operands carry a bounding-box tolerance of about 7e-3 mm, so thinner caps read as touching and G4 refuses them)' },
  { id: 'r3-sl-cut-sph-0.1', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 0.1])}; cut(a,b)`, note: 'ball enters 0.1 mm: truck ignores it (raw sweep)' },
  { id: 'r3-sl-cut-sph-0.15', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 0.15])}; cut(a,b)`, analytic: 32000 - PI * 0.0225 * (30 - 0.15) / 3 },
  { id: 'r3-sl-cut-sph-0.3', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 0.3])}; cut(a,b)`, analytic: 32000 - PI * 0.09 * (30 - 0.3) / 3 },
  { id: 'r3-sl-keep-sph-1', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 1])}; keep(a,b)`, analytic: PI * 1 * (30 - 1) / 3, note: 'raw sweep: 1.7e-4, exact' },
  { id: 'r3-sl-keep-sph-0.5', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 0.5])}; keep(a,b)`, analytic: PI * 0.25 * (30 - 0.5) / 3 },
  { id: 'r3-sl-keep-sph-2', feature: F.band, script: `const a = ${B(40, 40, 20)}; const b = ${S(10, [0, 0, 10 + 10 - 2])}; keep(a,b)`, analytic: PI * 4 * (30 - 2) / 3 },
  { id: 'r3-sl-cut-rot-0.05', feature: F.band, features: [box('a', [40, 40, 20], [0, 0, 0], [0, 30, 0]), box('b', [10, 10, 10], [Math.sin(PI / 6) * (15 - 0.05), 0, Math.cos(PI / 6) * (15 - 0.05)], [0, 30, 0]), op('op1', 'subtract', ['a', 'b'])], analytic: 32000 - 5 },
  { id: 'r3-sl-cut-rot-0.2', feature: F.band, features: [box('a', [40, 40, 20], [0, 0, 0], [0, 30, 0]), box('b', [10, 10, 10], [Math.sin(PI / 6) * (15 - 0.2), 0, Math.cos(PI / 6) * (15 - 0.2)], [0, 30, 0]), op('op1', 'subtract', ['a', 'b'])], analytic: 32000 - 20 },
  // ---- spin() ring (tube) operands ---------------------------------------------------------------------------------------------------------------
  { id: 'r3-ring-cut-180-void', feature: F.ring, script: `const a = ${B(50, 40, 50)}; const s = sketch('front', 0); s.polygon([[5,-10],[15,-10],[15,10],[5,10]]); cut(a, spin(s,180))`, analytic: 100000 - 200 * PI * 20 / 2, note: 'half-turn tube wholly inside the part' },
  { id: 'r3-ring-target-cut-box', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[5,-10],[15,-10],[15,10],[5,10]]); const t = spin(s,360); const b = ${B(40, 6, 40)}; cut(t,b)`, note: 'the TUBE is the target, a slab cuts through it: two half tubes' },
  { id: 'r3-ring-target-keep-box', feature: F.ring, script: `const s = sketch('front', 0); s.polygon([[5,-10],[15,-10],[15,10],[5,10]]); const t = spin(s,360); const b = ${B(40, 40, 40)}; keep(t,b)`, analytic: 200 * PI * 20 },
  { id: 'r3-ring-cut-through-cyl-core', feature: F.ring, script: `const a = ${B(50, 40, 50)}; const s = sketch('front', 0); s.polygon([[0,-20],[15,-20],[15,20],[0,20]]); cut(a, spin(s,360))`, analytic: 100000 - 225 * PI * 40, note: 'control: a SOLID spin (profile on the axis) through the part' },
  // ---- arity sentences: wrong kind of argument ----------------------------------------------------------------------------------------------------------
  { id: 'r3-arity-cut-number', feature: F.arity, script: `const a = ${B(40, 40, 20)}; cut(a, 5)` },
  { id: 'r3-arity-join-text', feature: F.arity, script: `const a = ${B(40, 40, 20)}; join(a, 'b')` },
  { id: 'r3-arity-keep-first-number', feature: F.arity, script: `const a = ${B(40, 40, 20)}; keep(5, a)` },
  { id: 'r3-arity-cut-sketch-second', feature: F.arity, script: `const a = ${B(40, 40, 20)}; const s = sketch('top', 0); s.circle(10); cut(a, s)` },
  { id: 'r3-arity-join-three-one-bad', feature: F.arity, script: `const a = ${B(40, 40, 20)}; const b = ${C(5, 40)}; join(a, b, 7)` },
  { id: 'r3-arity-cut-unknown-name', feature: F.arity, script: `const a = ${B(40, 40, 20)}; cut(a, nothing)` },
  { id: 'r3-arity-cut-point-list', feature: F.arity, script: `const a = ${B(40, 40, 20)}; cut(a, [1, 2])` },
  // ---- cut and keep that touch nothing: policy ------------------------------------------------------------------------------------------------------------
  { id: 'r3-policy-cut-far', feature: F.policy, script: `const a = ${B(40, 40, 20)}; const b = ${C(8, 30, [100, 0, 0])}; cut(a,b)`, analytic: 32000 },
  { id: 'r3-policy-cut-touch-face', feature: F.policy, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15])}; cut(a,b)`, analytic: 32000 },
  { id: 'r3-policy-cut-tangent-cyl', feature: F.policy, script: `const a = ${B(40, 40, 20)}; const b = ${C(5, 30, [25, 0, 0])}; cut(a,b)`, analytic: 32000, note: 'cylinder tangent OUTSIDE a side face along a line' },
);

// fuzz pairs and triples written by bool-fuzz-gen-r3.mjs (booleans-r3/fuzz-cases-<seed>.json), appended when present
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'booleans-r3');
  for (const f of readdirSync(dir).filter((x) => /^fuzz-cases-\d+\.json$/.test(x)).sort()) CASES.push(...JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
} catch { /* no fuzz files yet */ }
