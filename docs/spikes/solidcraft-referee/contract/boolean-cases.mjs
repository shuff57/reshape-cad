// SPIKE, referee only (contract/booleans group). Case list for run-booleans.mjs.
// A case is either a reSHape Script (`script`, run through the real interpreter) or raw ModelDoc `features` (used where the script
// surface cannot reach, e.g. the one-target combine a student can never write because the interpreter refuses it first).
// `analytic` is an independent closed-form volume (never read off a kernel); `feature` is the contract row the case belongs to.
const PI = Math.PI;
const box = (id, size, center = [0, 0, 0]) => ({ id, kind: 'box', size, center });
const cyl = (id, radius, height, center = [0, 0, 0]) => ({ id, kind: 'cylinder', radius, height, center });
const sph = (id, radius, center = [0, 0, 0]) => ({ id, kind: 'sphere', radius, center });
const tor = (id, ringRadius, tubeRadius, center = [0, 0, 0]) => ({ id, kind: 'torus', ringRadius, tubeRadius, center });
const op = (id, o, targets) => ({ id, kind: 'combine', op: o, targets });

// Script primitives take DIAMETERS (cylinder(8,..) is radius 4, ring(14,4) is ring radius 5 / tube radius 2) and are auto-placed
// beside earlier shapes unless `at` is given (measured with runScript), so every script below spells `at` out. B/C/S/R write
// the call from the REAL radii used in the closed-form volumes.
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const R = (Rr, r, at = [0, 0, 0]) => `ring(${2 * (Rr + r)},${2 * r},{at:[${at}]})`;
export const CASES = [
  // ---------------- join / union ----------------
  { id: 'join-box-cyl-through', feature: 'join(a,b): box + cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; join(a,b)`, analytic: 32000 + PI * 64 * 20 },
  { id: 'join-box-cyl-sideways-overlap', feature: 'join(a,b): box + cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(8,30,[20,0,0])}; join(a,b)`, note: 'cylinder straddles the x=20 face', analytic: 32000 + PI * 64 * 20 / 2 + 0 /* placeholder replaced by oracle compare */ },
  { id: 'join-three', feature: 'join(a,b,c): three operands (targets[2+])', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${B(20,20,20,[25,0,0])}; join(a,b,c)`, analytic: 32000 + 8000 - 2000 + PI * 64 * 20 },
  { id: 'join-four', feature: 'join(a,b,c): three operands (targets[2+])', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20,[15,0,0])}; const c = ${B(20,20,20,[30,0,0])}; const d = ${B(20,20,20,[45,0,0])}; join(a,b,c,d)`, note: 'four operands in a chain, each overlapping the next by 5', analytic: 8000 * 4 - 3 * 2000 },
  { id: 'join-pull-boss', feature: 'join with a pull() operand', script: `const plate = ${B(40,40,10)}; const s = sketch('top', 5); s.polygon([[0,0],[10,0],[10,8],[0,8]]); join(plate, pull(s,8))`, analytic: 16000 + 640 },
  { id: 'join-pull-sunk', feature: 'join with a pull() operand', script: `const plate = ${B(40,40,10)}; const s = sketch('top', 0); s.polygon([[0,0],[10,0],[10,8],[0,8]]); join(plate, pull(s,10))`, note: 'boss sunk 5 into the plate', analytic: 16000 + 80 * 5 },
  { id: 'join-pull-circle', feature: 'join with a pull() operand', script: `const plate = ${B(40,40,10)}; const s = sketch('top', 5); s.circle(12, {at:[5,5]}); join(plate, pull(s,12))`, analytic: 16000 + PI * 36 * 12 },
  { id: 'join-spin', feature: 'join with a spin() operand', script: `const a = ${B(40,40,20)}; const s = sketch('front', 0); s.polygon([[0,0],[6,0],[6,30],[0,30]]); join(a, spin(s,360))`, note: 'revolved cylinder r6 along y 0..30 through the box', analytic: 32000 + PI * 36 * 10 },
  { id: 'join-hole-boss', feature: 'join with a hole() result operand', script: `const plate = ${B(40,40,10)}; const h = hole(plate,{across:6}); const s = sketch('top', 5); s.polygon([[10,5],[20,5],[20,15],[10,15]]); join(h, pull(s,5))`, analytic: 16000 - 90 * PI + 500 },
  { id: 'join-hole-cover', feature: 'join with a hole() result operand', script: `const plate = ${B(40,40,10)}; const h = hole(plate,{across:6}); const s = sketch('top', 5); s.polygon([[-5,-5],[5,-5],[5,5],[-5,5]]); join(h, pull(s,5))`, note: 'boss closes the hole opening, leaving an internal void', analytic: 16000 - 90 * PI + 500 },
  { id: 'join-chain', feature: 'join/cut of earlier combine results', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${B(10,10,10,[18,0,0])}; const u = join(a,b); join(u,c)`, analytic: 32000 + PI * 64 * 20 + 1000 - 700 },
  { id: 'cut-of-join', feature: 'join/cut of earlier combine results', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${C(3,50,[12,12,0])}; const u = join(a,b); cut(u,c)`, analytic: 32000 + PI * 64 * 20 - PI * 9 * 20 },
  { id: 'keep-of-cut', feature: 'join/cut of earlier combine results', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${B(30,30,30)}; const u = cut(a,b); keep(u,c)`, analytic: 30 * 30 * 20 - PI * 64 * 20 },

  // ---------------- cut / subtract ----------------
  { id: 'cut-box-cyl-through', feature: 'cut(a,b): box - cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; cut(a,b)`, analytic: 32000 - PI * 64 * 20 },
  { id: 'cut-box-cyl-blind', feature: 'cut(a,b): box - cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(8,10,[0,0,5])}; cut(a,b)`, note: 'blind bore from the top face (tool top coplanar with box top)', analytic: 32000 - PI * 64 * 10 },
  { id: 'cut-box-cyl-inside', feature: 'cut(a,b): box - cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(5,10,[0,0,0])}; cut(a,b)`, note: 'cylinder entirely inside the box: internal void', analytic: 32000 - PI * 25 * 10 },
  { id: 'cut-three', feature: 'cut(a,b,c): three operands (target + 2 tools)', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${C(5,40,[14,14,0])}; cut(a,b,c)`, analytic: 32000 - PI * 64 * 20 - PI * 25 * 20 },
  { id: 'cut-four', feature: 'cut(a,b,c): three operands (target + 2 tools)', script: `const a = ${B(60,40,20)}; const b = ${C(6,40,[-20,0,0])}; const c = ${C(6,40)}; const d = ${C(6,40,[20,0,0])}; cut(a,b,c,d)`, analytic: 48000 - 3 * PI * 36 * 20 },
  { id: 'cut-pull-slot', feature: 'cut with a pull() operand', script: `const plate = ${B(40,40,20)}; const s = sketch('top', 2); s.polygon([[-5,-5],[5,-5],[5,5],[-5,5]]); cut(plate, pull(s,20))`, analytic: 32000 - 800 },
  { id: 'cut-spin-bore', feature: 'cut with a spin() operand', script: `const a = ${B(40,40,20)}; const s = sketch('front', 0); s.polygon([[0,0],[6,0],[6,30],[0,30]]); cut(a, spin(s,360))`, analytic: 32000 - PI * 36 * 20 },
  { id: 'cut-spin-cone-groove', feature: 'cut with a spin() operand', script: `const a = ${B(40,40,20)}; const s = sketch('front', 0); s.polygon([[0,-10],[8,-10],[0,10]]); cut(a, spin(s,360))`, note: 'revolved triangle (cone) as the tool, fully inside the box: internal void', analytic: 32000 - PI * 64 * 20 / 3 },
  { id: 'cut-hole-target', feature: 'cut with a hole() result operand', script: `const plate = ${B(40,40,10)}; const h = hole(plate,{across:6}); const c = ${C(4,20,[12,0,0])}; cut(h,c)`, analytic: 16000 - PI * 9 * 10 - PI * 16 * 10 },
  { id: 'cut-hole-as-tool', feature: 'cut with a hole() result operand', script: `const big = ${B(60,60,20)}; const plate = ${B(40,40,10)}; const h = hole(plate,{across:6}); cut(big,h)`, note: 'a holed plate used as the TOOL (a ring-like cutter)', analytic: 72000 - (16000 - 90 * PI) },
  { id: 'cut-of-cut', feature: 'join/cut of earlier combine results', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${C(3,50,[12,12,0])}; const u = cut(a,b); cut(u,c)`, analytic: 32000 - PI * 64 * 20 - PI * 9 * 20 },

  // ---------------- keep / intersect ----------------
  { id: 'keep-box-cyl', feature: 'keep(a,b): box + cylinder', script: `const a = ${B(40,40,20)}; const b = ${C(15,40)}; keep(a,b)`, analytic: PI * 225 * 20 },
  { id: 'keep-box-cyl-clip', feature: 'keep(a,b): box + cylinder', script: `const a = ${B(20,20,20)}; const b = ${C(14,40)}; keep(a,b)`, note: 'cylinder wider than the box face: result has curved and planar faces' },
  { id: 'keep-three', feature: 'keep(a,b,c): three operands', script: `const a = ${B(40,40,20)}; const b = ${C(15,40)}; const c = ${B(20,60,60)}; keep(a,b,c)`, note: 'cylinder clipped by a 20-wide slab' },
  { id: 'keep-three-sph', feature: 'keep(a,b,c): three operands', script: `const a = ${B(40,40,40)}; const b = ${S(18)}; const c = ${C(10,50)}; keep(a,b,c)`, note: 'box / sphere / cylinder all meet' },
  { id: 'keep-pull', feature: 'keep with a pull() operand', script: `const plate = ${B(40,40,20)}; const s = sketch('top', 2); s.polygon([[-5,-5],[5,-5],[5,5],[-5,5]]); keep(plate, pull(s,20))`, analytic: 800 },
  { id: 'keep-spin', feature: 'keep with a spin() operand', script: `const a = ${B(40,40,20)}; const s = sketch('front', 0); s.polygon([[0,0],[6,0],[6,30],[0,30]]); keep(a, spin(s,360))`, analytic: PI * 36 * 20 },
  { id: 'keep-hole-target', feature: 'keep with a hole() result operand', script: `const plate = ${B(40,40,10)}; const h = hole(plate,{across:6}); const c = ${C(15,20)}; keep(h,c)`, analytic: PI * 225 * 10 - PI * 9 * 10 },
  { id: 'keep-chain', feature: 'join/cut of earlier combine results', script: `const a = ${B(40,40,20)}; const b = ${C(15,40)}; const c = ${C(8,40,[10,0,0])}; const u = keep(a,b); keep(u,c)`, note: 'keep of a keep result' },

  // ---------------- operand-count rules (front end) ----------------
  { id: 'arity-join-one', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; join(a)` },
  { id: 'arity-cut-one', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; cut(a)` },
  { id: 'arity-keep-one', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; keep(a)` },
  { id: 'arity-join-zero', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `join()` },
  { id: 'arity-cut-number', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; cut(a, 3)` },
  { id: 'arity-keep-sketch', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; const s = sketch('top', 10); s.circle(4); keep(a, s)`, note: 'a sketch handle is not a solid' },
  { id: 'arity-join-same-twice', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; join(a, a)`, note: 'the same handle twice passes the front end' },
  { id: 'arity-cut-same-twice', feature: 'two-or-more-shapes rule (join, cut, keep)', script: `const a = ${B(40,40,20)}; cut(a, a)` },
  { id: 'arity-modeldoc-one-target', feature: 'two-or-more-shapes rule (join, cut, keep)', features: [box('a', [40, 40, 20]), op('op1', 'union', ['a'])], note: 'ModelDoc path, bypassing the interpreter' },
  { id: 'reuse-tool-twice', feature: 'operand consumed by one combine used again', script: `const a = ${B(40,40,20)}; const b = ${B(30,30,20,[60,0,0])}; const c = ${C(8,40)}; const x = cut(a,c); const y = cut(b,c); join(x,y)`, note: 'the same cutter used on two parts' },
  { id: 'reuse-target-after-union', feature: 'operand consumed by one combine used again', script: `const a = ${B(40,40,20)}; const b = ${C(8,40)}; const c = ${C(4,40,[10,10,0])}; const u = join(a,b); cut(a,c)`, note: 'a is the target of a join, then cut again' },

  // ---------------- curved operands ----------------
  { id: 'x-cut-x-axis-cylinder', feature: 'curved: cylinder in box (rotated axis)', features: [box('a', [40, 40, 20]), { id: 'c', kind: 'cylinder', radius: 5, height: 60, center: [0, 0, 0], rotate: [0, 90, 0] }, op('op1', 'subtract', ['a', 'c'])], analytic: 32000 - PI * 25 * 40 },
  { id: 'x-join-x-axis-cylinder', feature: 'curved: cylinder in box (rotated axis)', features: [box('a', [40, 40, 20]), { id: 'c', kind: 'cylinder', radius: 5, height: 60, center: [0, 0, 0], rotate: [0, 90, 0] }, op('op1', 'union', ['a', 'c'])], analytic: 32000 + PI * 25 * 20 },
  { id: 'x-keep-x-axis-cylinder', feature: 'curved: cylinder in box (rotated axis)', features: [box('a', [40, 40, 20]), { id: 'c', kind: 'cylinder', radius: 5, height: 60, center: [0, 0, 0], rotate: [0, 90, 0] }, op('op1', 'intersect', ['a', 'c'])], analytic: PI * 25 * 40 },
  { id: 'x-cyl-cross-cyl-union', feature: 'curved: cylinder crossing cylinder', features: [cyl('c1', 10, 40), { id: 'c2', kind: 'cylinder', radius: 6, height: 40, center: [0, 0, 0], rotate: [90, 0, 0] }, op('op1', 'union', ['c1', 'c2'])], note: 'perpendicular axes, different radii' },
  { id: 'x-cyl-cross-cyl-cut', feature: 'curved: cylinder crossing cylinder', features: [cyl('c1', 10, 40), { id: 'c2', kind: 'cylinder', radius: 6, height: 40, center: [0, 0, 0], rotate: [90, 0, 0] }, op('op1', 'subtract', ['c1', 'c2'])] },
  { id: 'x-cyl-cross-cyl-keep', feature: 'curved: cylinder crossing cylinder', features: [cyl('c1', 10, 40), { id: 'c2', kind: 'cylinder', radius: 6, height: 40, center: [0, 0, 0], rotate: [90, 0, 0] }, op('op1', 'intersect', ['c1', 'c2'])] },
  { id: 'x-cyl-cross-cyl-equal-keep', feature: 'curved: cylinder crossing cylinder', features: [cyl('c1', 8, 40), { id: 'c2', kind: 'cylinder', radius: 8, height: 40, center: [0, 0, 0], rotate: [90, 0, 0] }, op('op1', 'intersect', ['c1', 'c2'])], note: 'Steinmetz solid (equal radii): the hard case, analytic 16/3 r^3', analytic: 16 / 3 * 512 },
  { id: 'x-cyl-minus-cyl-parallel', feature: 'curved: cylinder crossing cylinder', features: [cyl('c1', 12, 30), cyl('c2', 8, 30, [10, 0, 0]), op('op1', 'subtract', ['c1', 'c2'])], note: 'parallel axes, tool reaches the wall (W8)' },
  { id: 'x-sph-minus-box', feature: 'curved: sphere with box', features: [sph('s', 15), box('b', [10, 10, 40]), op('op1', 'subtract', ['s', 'b'])] },
  { id: 'x-box-minus-sph-hemi', feature: 'curved: sphere with box', script: `const a = ${B(40,40,20)}; const s = ${S(10,[0,0,10])}; cut(a,s)`, note: 'sphere centred on the top face: hemispherical dimple', analytic: 32000 - 2 / 3 * PI * 1000 },
  { id: 'x-box-minus-sph-void', feature: 'curved: sphere with box', script: `const a = ${B(40,40,20)}; const s = ${S(8)}; cut(a,s)`, note: 'sphere entirely inside: internal void', analytic: 32000 - 4 / 3 * PI * 512 },
  { id: 'x-box-minus-box-void', feature: 'curved: sphere with box', script: `const a = ${B(40,40,20)}; const s = ${B(10,10,10)}; cut(a,s)`, note: 'planar internal void (control)', analytic: 31000 },
  { id: 'x-sph-union-box', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const b = ${B(10,10,40)}; join(s,b)` },
  { id: 'x-sph-keep-box', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const b = ${B(20,20,20)}; keep(s,b)`, note: 'corners of the box poke out of the sphere (r15 vs half-diagonal 17.3)' },
  { id: 'x-sph-keep-sph', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const t = ${S(12,[10,0,0])}; keep(s,t)`, note: 'lens' },
  { id: 'x-sph-union-sph', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const t = ${S(12,[10,0,0])}; join(s,t)` },
  { id: 'x-sph-cut-sph', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const t = ${S(12,[10,0,0])}; cut(s,t)` },
  { id: 'x-sph-cut-cyl', feature: 'curved: sphere with box', script: `const s = ${S(15)}; const c = ${C(5,50)}; cut(s,c)`, note: 'bead: a sphere with a bore', analytic: 4 / 3 * PI * 3375 - (PI * 25 * 2 * Math.sqrt(225 - 25) - 2 * (PI / 3) * (15 - Math.sqrt(200)) ** 2 * (3 * 15 - (15 - Math.sqrt(200)))) },
  { id: 'x-tor-union-box', feature: 'curved: torus', script: `const t = ${R(14,4)}; const b = ${B(10,10,40,[14,0,0])}; join(t,b)` },
  { id: 'x-tor-minus-box', feature: 'curved: torus', script: `const t = ${R(14,4)}; const b = ${B(10,10,40,[14,0,0])}; cut(t,b)` },
  { id: 'x-tor-half', feature: 'curved: torus', script: `const t = ${R(14,4)}; const b = ${B(60,30,20,[0,15,0])}; keep(t,b)`, note: 'half of the ring (y > 0): exactly half of 2 pi^2 R r^2', analytic: PI * PI * 14 * 16 },
  { id: 'x-box-minus-tor-void', feature: 'curved: torus', script: `const a = ${B(50,50,20)}; const t = ${R(14,4)}; cut(a,t)`, note: 'torus entirely inside the box: internal void', analytic: 50 * 50 * 20 - 2 * PI * PI * 14 * 16 },
  { id: 'x-box-minus-tor-cross', feature: 'curved: torus', script: `const a = ${B(50,50,20)}; const t = ${R(14,4,[0,0,8])}; cut(a,t)`, note: 'torus pierces the top face' },
  { id: 'x-tor-keep-box', feature: 'curved: torus', script: `const t = ${R(14,4)}; const b = ${B(30,30,4)}; keep(t,b)`, note: 'slab through the tube centre plane' },
  { id: 'x-tor-union-cyl-axis', feature: 'curved: torus', script: `const t = ${R(14,4)}; const c = ${C(6,12)}; join(t,c)`, note: 'cylinder in the hole of the ring, not touching' },
  { id: 'x-tor-union-cyl-touch', feature: 'curved: torus', script: `const t = ${R(14,4)}; const c = ${C(10,12)}; join(t,c)`, note: 'cylinder radius 10 = R - r: tangent to the torus inner equator along a circle' },

  // ---------------- coplanar ----------------
  { id: 'cop-union-shared-face', feature: 'coplanar faces', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 0, 0]), op('op1', 'union', ['a', 'b'])], analytic: 16000 },
  { id: 'cop-union-partial-overlap', feature: 'coplanar faces', script: `const a = ${B(40,40,20)}; const b = ${B(40,40,20,[20,0,0])}; join(a,b)`, note: 'top, bottom, y faces coplanar; overlap 20 wide', analytic: 48000 },
  { id: 'cop-union-inside-flush', feature: 'coplanar faces', script: `const a = ${B(40,40,20)}; const b = ${B(20,20,20,[10,10,0])}; join(a,b)`, note: 'b inside a, sharing four coplanar faces', analytic: 32000 },
  { id: 'cop-union-identical', feature: 'coplanar faces', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20)}; join(a,b)`, note: 'two identical boxes', analytic: 8000 },
  { id: 'cop-union-step', feature: 'coplanar faces', script: `const a = ${B(40,40,20)}; const b = ${B(20,20,10,[0,0,15])}; join(a,b)`, note: 'block stacked on a, fully on its top face', analytic: 32000 + 4000 },
  { id: 'cop-union-l-shape', feature: 'coplanar faces', script: `const a = ${B(40,20,20)}; const b = ${B(20,40,20,[-10,10,0])}; join(a,b)`, note: 'L: bottom, top coplanar; overlap region 20x20', analytic: 16000 + 16000 - 8000 },
  { id: 'cop-cut-flush-top', feature: 'coplanar faces', features: [box('a', [40, 40, 20]), box('b', [10, 10, 10], [0, 0, 5]), op('op1', 'subtract', ['a', 'b'])], analytic: 31000 },
  { id: 'cop-cut-caps', feature: 'coplanar faces', features: [box('a', [40, 40, 20]), cyl('c', 8, 20), op('op1', 'subtract', ['a', 'c'])], analytic: 32000 - PI * 64 * 20 },
  { id: 'cop-cut-same-box', feature: 'coplanar faces', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20,[10,0,0])}; cut(a,b)`, note: 'tool shares four coplanar faces; removes half', analytic: 4000 },
  { id: 'cop-keep-offset', feature: 'coplanar faces', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [0, 0, 10]), op('op1', 'intersect', ['a', 'b'])], analytic: 4000 },
  { id: 'cop-keep-partial', feature: 'coplanar faces', script: `const a = ${B(40,40,20)}; const b = ${B(40,40,20,[20,0,0])}; keep(a,b)`, analytic: 16000 },

  // ---------------- tangent / touching ----------------
  { id: 'tan-union-cyl-overlap1', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), cyl('c', 10, 20, [29, 0, 0]), op('op1', 'union', ['a', 'c'])], note: 'the owner-approved version: 1 mm overlap' },
  { id: 'tan-union-cyl-exact', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), cyl('c', 10, 20, [30, 0, 0]), op('op1', 'union', ['a', 'c'])], note: 'cylinder wall exactly tangent to the x=20 face along a line (the original form)' },
  { id: 'tan-subtract-touching', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), cyl('c', 10, 40, [30, 0, 0]), op('op1', 'subtract', ['a', 'c'])], analytic: 32000 },
  { id: 'tan-keep-cyl-exact', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), cyl('c', 10, 20, [30, 0, 0]), op('op1', 'intersect', ['a', 'c'])], note: 'tangent along a line: empty intersection' },
  { id: 'tan-union-sph-point', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), sph('s', 10, [30, 0, 0]), op('op1', 'union', ['a', 's'])], note: 'sphere touching a face at one point: pinch contact' },
  { id: 'tan-cut-sph-point', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), sph('s', 10, [30, 0, 0]), op('op1', 'subtract', ['a', 's'])], analytic: 32000 },
  { id: 'tan-cut-sph-inscribed', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), sph('s', 10), op('op1', 'subtract', ['a', 's'])], note: 'sphere inscribed in the cube: touches all six faces at a point', analytic: 8000 - 4 / 3 * PI * 1000 },
  { id: 'tan-keep-sph-inscribed', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), sph('s', 10), op('op1', 'intersect', ['a', 's'])], analytic: 4 / 3 * PI * 1000 },
  { id: 'tan-union-sph-inscribed', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), sph('s', 10), op('op1', 'union', ['a', 's'])], analytic: 8000 },
  { id: 'tan-union-cyl-inscribed', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), cyl('c', 10, 20), op('op1', 'union', ['a', 'c'])], note: 'cylinder inscribed in the box, ends coplanar with the box faces, walls tangent along four lines', analytic: 8000 },
  { id: 'tan-cut-cyl-inscribed', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), cyl('c', 10, 20), op('op1', 'subtract', ['a', 'c'])], analytic: 8000 - PI * 100 * 20 },
  { id: 'tan-cyl-in-cyl-internal', feature: 'tangent and touching contact', features: [cyl('c1', 12, 30), cyl('c2', 6, 30, [6, 0, 0]), op('op1', 'subtract', ['c1', 'c2'])], note: 'internally tangent cylinders (tool wall touches target wall along a line)', analytic: PI * 144 * 30 - PI * 36 * 30 },
  { id: 'tan-union-edge-touch', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 20, 0]), op('op1', 'union', ['a', 'b'])], note: 'two boxes sharing only an edge: not a manifold solid' },
  { id: 'tan-union-vertex-touch', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 20, 20]), op('op1', 'union', ['a', 'b'])], note: 'two boxes sharing only a vertex' },
  { id: 'tan-cut-edge-touch', feature: 'tangent and touching contact', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 20, 0]), op('op1', 'subtract', ['a', 'b'])], analytic: 8000 },
  { id: 'tan-union-cyl-on-face', feature: 'tangent and touching contact', features: [box('a', [40, 40, 20]), cyl('c', 8, 10, [0, 0, 15]), op('op1', 'union', ['a', 'c'])], note: 'cylinder stacked on the top face (face contact only)', analytic: 32000 + PI * 64 * 10 },

  // ---------------- disjoint ----------------
  { id: 'dis-union', feature: 'disjoint operands', script: `const a = ${B(10,10,10)}; const b = ${B(10,10,10,[30,0,0])}; join(a,b)`, note: 'two separate solids', analytic: 2000 },
  { id: 'dis-union-curved', feature: 'disjoint operands', script: `const a = ${S(8)}; const b = ${C(5,20,[30,0,0])}; join(a,b)`, analytic: 4 / 3 * PI * 512 + PI * 25 * 20 },
  { id: 'dis-cut', feature: 'disjoint operands', script: `const a = ${B(10,10,10)}; const b = ${B(10,10,10,[30,0,0])}; cut(a,b)`, analytic: 1000 },
  { id: 'dis-cut-curved', feature: 'disjoint operands', script: `const a = ${B(40,40,20)}; const b = ${S(5,[60,0,0])}; cut(a,b)`, analytic: 32000 },
  { id: 'dis-keep', feature: 'empty intersection', script: `const a = ${B(10,10,10)}; const b = ${B(10,10,10,[30,0,0])}; keep(a,b)`, note: 'nothing in common' },
  { id: 'dis-keep-face-touch', feature: 'empty intersection', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 0, 0]), op('op1', 'intersect', ['a', 'b'])], note: 'boxes sharing only a face: zero volume' },
  { id: 'dis-keep-edge-touch', feature: 'empty intersection', features: [box('a', [20, 20, 20]), box('b', [20, 20, 20], [20, 20, 0]), op('op1', 'intersect', ['a', 'b'])] },
  { id: 'dis-keep-curved', feature: 'empty intersection', script: `const a = ${S(8)}; const b = ${C(5,20,[30,0,0])}; keep(a,b)` },
  { id: 'dis-keep-three-pairwise-overlap', feature: 'empty intersection', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20,[15,0,0])}; const c = ${B(20,20,20,[30,0,0])}; keep(a,b,c)`, note: 'a&b and b&c overlap but a&b&c is empty' },
  { id: 'emp-cut-total', feature: 'empty intersection', script: `const a = ${B(10,10,10)}; const b = ${B(40,40,40)}; cut(a,b)`, note: 'subtract everything: empty result' },
  { id: 'emp-cut-identical', feature: 'empty intersection', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20)}; cut(a,b)`, note: 'a minus a copy of a' },
  { id: 'emp-cut-cyl-total', feature: 'empty intersection', script: `const a = ${C(5,10)}; const b = ${C(8,20)}; cut(a,b)` },
  { id: 'emp-cut-three-total', feature: 'empty intersection', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,10,[0,0,5])}; const c = ${B(20,20,10,[0,0,-5])}; cut(a,b,c)`, note: 'two tools that between them consume the target exactly' },
  { id: 'emp-keep-identical', feature: 'empty intersection', script: `const a = ${B(20,20,20)}; const b = ${B(20,20,20)}; keep(a,b)`, note: 'identical operands: the whole box', analytic: 8000 },
  { id: 'emp-keep-contained', feature: 'empty intersection', script: `const a = ${B(40,40,20)}; const b = ${B(10,10,10)}; keep(a,b)`, analytic: 1000 },
  { id: 'emp-keep-contained-sph', feature: 'empty intersection', script: `const a = ${B(40,40,40)}; const b = ${S(10)}; keep(a,b)`, analytic: 4 / 3 * PI * 1000 },

  // ---------------- splitting results ----------------
  { id: 'split-cut-slot-two-pieces', feature: 'result with more than one solid', script: `const a = ${B(40,40,20)}; const b = ${B(10,60,30)}; cut(a,b)`, note: 'a slot through the whole part leaves two separate pieces', analytic: 32000 - 10 * 40 * 20 },
  { id: 'split-cut-ring-pieces', feature: 'result with more than one solid', script: `const a = ${C(15,10)}; const b = ${B(40,4,20)}; cut(a,b)`, note: 'a slit through a cylinder: two half-moons', analytic: PI * 225 * 10 - 4 * 10 * 30 + 0 },
  { id: 'split-keep-two-pieces', feature: 'result with more than one solid', script: `const a = ${B(60,20,20)}; const b = ${C(8,30,[-20,0,0])}; const c = ${C(8,30,[20,0,0])}; const d = join(b,c); keep(a,d)`, note: 'intersection of a box with two separate cylinders', analytic: 2 * PI * 64 * 20 },
  // ---------------- added after round-1 findings ----------------
  { id: 'join-bridge', feature: 'join(a,b,c): three operands (targets[2+])', script: `const a = ${B(10,10,10)}; const c = ${B(10,10,10,[40,0,0])}; const b = ${B(50,6,6,[20,0,0])}; join(a,c,b)`, note: 'a and c are disjoint; only the THIRD operand joins them into one solid', analytic: 3080 },
  { id: 'keep-four', feature: 'keep(a,b,c): three operands', script: `const a = ${B(40,40,20)}; const b = ${C(15,40)}; const c = ${B(20,60,60)}; const d = ${B(60,20,60)}; keep(a,b,c,d)`, note: 'cylinder clipped by two crossing slabs' },
  { id: 'split-then-cut-other-piece', feature: 'result with more than one solid', script: `const a = ${B(40,40,20)}; const slot = ${B(10,60,30)}; const c = ${C(4,40,[12,0,0])}; const u = cut(a,slot); cut(u,c)`, note: 'the first cut leaves two pieces; the second tool touches only the x>5 piece', analytic: 24000 - PI * 16 * 20 },
  { id: 'split-then-join-other-piece', feature: 'result with more than one solid', script: `const a = ${B(40,40,20)}; const slot = ${B(10,60,30)}; const d = ${B(10,10,10,[20,0,15])}; const u = cut(a,slot); join(u,d)`, note: 'block added on top of the x>5 piece only', analytic: 24000 + 1000 - 0 },
];

// Fix analytic placeholders that cannot be closed-form: drop them rather than ship a wrong "independent" number.
for (const c of CASES) {
  if (c.id === 'join-box-cyl-sideways-overlap') delete c.analytic;
  if (c.id === 'x-sph-cut-cyl') delete c.analytic;
  if (c.id === 'split-cut-ring-pieces') delete c.analytic;
}
