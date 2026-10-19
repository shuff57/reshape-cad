// SPIKE, referee only (contract/booleans group, round 2). More cases for run-booleans.mjs; pushes onto the CASES array of boolean-cases.mjs.
// Same conventions as boolean-cases.mjs: scripts take DIAMETERS for cylinder/sphere/ring and are written with `at`, ModelDoc `features` where the script surface cannot reach.
import { CASES } from './boolean-cases.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PI = Math.PI;
const box = (id, size, center = [0, 0, 0], rotate) => ({ id, kind: 'box', size, center, ...(rotate ? { rotate } : {}) });
const cyl = (id, radius, height, center = [0, 0, 0], rotate) => ({ id, kind: 'cylinder', radius, height, center, ...(rotate ? { rotate } : {}) });
const sph = (id, radius, center = [0, 0, 0]) => ({ id, kind: 'sphere', radius, center });
const tor = (id, ringRadius, tubeRadius, center = [0, 0, 0], rotate) => ({ id, kind: 'torus', ringRadius, tubeRadius, center, ...(rotate ? { rotate } : {}) });
const op = (id, o, targets) => ({ id, kind: 'combine', op: o, targets });
const B = (w, d, h, at = [0, 0, 0]) => `box(${w},${d},${h},{at:[${at}]})`;
const C = (r, h, at = [0, 0, 0]) => `cylinder(${2 * r},${h},{at:[${at}]})`;
const S = (r, at = [0, 0, 0]) => `sphere(${2 * r},{at:[${at}]})`;
const R = (Rr, r, at = [0, 0, 0]) => `ring(${2 * (Rr + r)},${2 * r},{at:[${at}]})`;

const F = {
  sliver: 'sliver overlap: cut or keep with an overlap thinner than 0.01 mm (axis-aligned part)',
  sliverEsc: 'sliver overlap the bounding-box test cannot see (rotated part)',
  sameKeep: 'same handle twice: keep(a, a)',
  noat: 'cut or keep with a shape that touches nothing (a primitive written without at:)',
  spin: 'spin() operand: off-axis tube, half turn, tube inside the part',
  kf: 'kernel-failure refusals: hollow ball, internally tangent spheres, torus in an axis plane',
  trap: 'wasm trap: torus meeting a tangent box, a shifted torus, a spindle torus',
  reuse: 'operand consumed by one combine used again',
  hang: 'time budget: round shapes crossing at an angle and a torus meeting a box',
};
const spinTube = (y0, y1, r0, r1, deg, box_, op_) => `const a = ${box_}; const s = sketch('front', 0); s.polygon([[${r0},${y0}],[${r1},${y0}],[${r1},${y1}],[${r0},${y1}]]); ${op_}(a, spin(s,${deg}))`;
const BIG = B(50, 40, 50);

CASES.push(
  // ---- sliver overlaps (planar): the tool dips d below the top face of a 40x40x20 box -----------------------------------------------
  ...[['5e-3', 0.005], ['2e-3', 0.002], ['1e-3', 0.001], ['1e-4', 0.0001]].map(([n, d]) => ({ id: `sl-cut-${n}`, feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - d])}; cut(a,b)`, analytic: 32000 - 100 * d })),
  { id: 'sl-cut-5e-2', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.05])}; cut(a,b)`, analytic: 32000 - 5, note: 'SolidCraft is exact here; the guard still refuses it (below 0.1 mm)' },
  { id: 'sl-cut-0.2', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.2])}; cut(a,b)`, analytic: 32000 - 20, note: 'just above the guard threshold: built' },
  { id: 'sl-keep-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.001])}; keep(a,b)`, analytic: 0.1 },
  { id: 'sl-keep-5e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.005])}; keep(a,b)`, analytic: 0.5 },
  { id: 'sl-cut-side-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [25 - 0.001, 0, 0])}; cut(a,b)`, analytic: 32000 - 0.1 * 10 },
  { id: 'sl-cut-cyl-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${C(5, 30, [25 - 0.001, 0, 0])}; cut(a,b)` },
  { id: 'sl-cut-sph-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${S(5, [25 - 0.001, 0, 0])}; cut(a,b)` },
  { id: 'sl-join-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${B(10, 10, 10, [0, 0, 15 - 0.001])}; join(a,b)`, analytic: 32000 + 1000 - 0.1 },
  { id: 'sl-cut-3op-1e-3', feature: F.sliver, script: `const a = ${B(40, 40, 20)}; const b = ${C(5, 30, [0, 0, 0])}; const c = ${B(10, 10, 10, [0, 25 - 0.001, 0])}; cut(a,b,c)`, note: 'one real tool and one sliver tool' },
  // sliver the bbox test cannot see: the part is rotated, so its bounding box is far looser than the part
  { id: 'sl-esc-rot-cut-1e-3', feature: F.sliverEsc, features: [box('a', [40, 40, 20], [0, 0, 0], [0, 30, 0]), box('b', [10, 10, 10], [Math.sin(PI / 6) * (15 - 0.001), 0, Math.cos(PI / 6) * (15 - 0.001)], [0, 30, 0]), op('op1', 'subtract', ['a', 'b'])], analytic: 32000 - 0.1 },
  { id: 'sl-esc-rot-cut-1e-2', feature: F.sliverEsc, features: [box('a', [40, 40, 20], [0, 0, 0], [0, 30, 0]), box('b', [10, 10, 10], [Math.sin(PI / 6) * (15 - 0.01), 0, Math.cos(PI / 6) * (15 - 0.01)], [0, 30, 0]), op('op1', 'subtract', ['a', 'b'])], analytic: 32000 - 1 },
  { id: 'sl-esc-rot-3op', feature: F.sliverEsc, features: [box('a', [40, 40, 20], [0, 0, 0], [0, 30, 0]), cyl('c', 3, 60, [0, 0, 0]), box('b', [10, 10, 10], [Math.sin(PI / 6) * (15 - 0.01), 0, Math.cos(PI / 6) * (15 - 0.01)], [0, 30, 0]), op('op1', 'subtract', ['a', 'c', 'b'])], analytic: null, note: 'a real bore plus a rotated sliver tool: the volume changes, so the after-check cannot see the ignored sliver' },
  { id: 'sl-esc-sph-sph-1e-3', feature: F.sliverEsc, script: `const a = ${S(10, [0, 0, 0])}; const b = ${S(10, [20 - 0.001, 0, 0])}; cut(a,b)`, note: 'two spheres overlapping by 1e-3 mm: bbox overlap is 1e-3 too, so the guard sees it' },

  // ---- same handle twice ----------------------------------------------------------------------------------------------------------
  { id: 'sh-keep-a-a', feature: F.sameKeep, script: `const a = ${B(40, 40, 20)}; keep(a, a)`, analytic: 32000 },
  { id: 'sh-join-a-a-b', feature: F.sameKeep, script: `const a = ${B(40, 40, 20)}; const b = ${C(8, 40)}; join(a, b, a)`, note: 'the same shape appears twice among three' },

  // ---- shapes that touch nothing: a primitive written without at: is auto-placed beside the part ----------------------------------------
  { id: 'noat-cut', feature: F.noat, script: 'const a = box(40,40,20); const b = cylinder(10,30); cut(a,b)', analytic: 32000, note: 'no at:: the interpreter puts the cylinder at x=40, beside the box' },
  { id: 'noat-keep', feature: F.noat, script: 'const a = box(40,40,20); const b = cylinder(10,30); keep(a,b)' },
  { id: 'noat-join', feature: F.noat, script: 'const a = box(40,40,20); const b = cylinder(10,30); join(a,b)', note: 'join of auto-placed disjoint shapes: two pieces, allowed' },
  { id: 'noat-cut-3op', feature: F.noat, script: `const a = ${B(40, 40, 20)}; const b = ${C(8, 40)}; const c = cylinder(10,30); cut(a,b,c)`, note: 'one real tool, one auto-placed tool that touches nothing' },

  // ---- spin() operands (the critic found cut(box, spin(tube)) refused with kernel text) ------------------------------------------------
  { id: 'sp-cut-tube-360-through', feature: F.spin, script: spinTube(-20, 20, 5, 15, 360, BIG, 'cut'), analytic: 100000 - 8000 * PI },
  { id: 'sp-cut-tube-180-through', feature: F.spin, script: spinTube(-20, 20, 5, 15, 180, BIG, 'cut'), analytic: 100000 - 4000 * PI },
  { id: 'sp-cut-tube-360-blind', feature: F.spin, script: spinTube(0, 20, 5, 15, 360, BIG, 'cut'), analytic: 100000 - 4000 * PI },
  { id: 'sp-cut-solid-180', feature: F.spin, script: spinTube(-20, 20, 0, 6, 180, BIG, 'cut'), analytic: 100000 - 36 * PI * 40 / 2 },
  { id: 'sp-cut-tube-void', feature: F.spin, script: spinTube(-10, 10, 5, 15, 360, BIG, 'cut'), analytic: 100000 - 200 * PI * 20 },
  { id: 'sp-join-tube-360', feature: F.spin, script: spinTube(-30, 30, 5, 15, 360, BIG, 'join'), analytic: 100000 + 200 * PI * 20 },
  { id: 'sp-keep-tube-360', feature: F.spin, script: spinTube(-30, 30, 5, 15, 360, BIG, 'keep'), analytic: 200 * PI * 40 },
  { id: 'sp-keep-tube-180', feature: F.spin, script: spinTube(-30, 30, 5, 15, 180, BIG, 'keep'), analytic: 200 * PI * 20 },
  { id: 'sp-join-solid-180', feature: F.spin, script: spinTube(-30, 30, 0, 6, 180, BIG, 'join') },

  // ---- kernel-failure refusals ------------------------------------------------------------------------------------------------------
  { id: 'kf-hollow-ball', feature: F.kf, script: `const s = ${S(15)}; const t = ${S(7)}; cut(s,t)`, analytic: 4 / 3 * PI * (3375 - 343) },
  { id: 'kf-sph-internal-tangent', feature: F.kf, script: `const s = ${S(15)}; const t = ${S(7, [8, 0, 0])}; cut(s,t)`, analytic: 4 / 3 * PI * (3375 - 343) },
  { id: 'kf-tor40-10-half', feature: F.kf, script: `const t = ${R(15, 5)}; const b = ${B(60, 30, 20, [0, 15, 0])}; keep(t,b)`, analytic: PI * PI * 15 * 25 },
  { id: 'kf-tor36-8-half', feature: F.kf, script: `const t = ${R(14, 4)}; const b = ${B(60, 30, 20, [0, 15, 0])}; keep(t,b)`, analytic: PI * PI * 14 * 16, note: 'the existing x-tor-half again, same script, for the size comparison' },

  // ---- operand reuse (keep_tools) ---------------------------------------------------------------------------------------------------
  { id: 'reuse-tool-join-two', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [30, 0, 0])}; const c = ${C(8, 40, [15, 0, 0])}; const x = cut(a,c); const y = cut(b,c); join(x,y)` },
  { id: 'reuse-tool-three-parts', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [30, 0, 0])}; const d = ${B(40, 40, 20, [15, 30, 0])}; const c = ${C(8, 100, [15, 15, 0])}; const x = cut(a,c); const y = cut(b,c); const z = cut(d,c); join(x,y,z)`, note: 'three uses of one cutter' },
  { id: 'reuse-tool-keep-pair', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [30, 0, 0])}; const c = ${C(8, 40, [15, 0, 0])}; const x = keep(a,c); const y = keep(b,c); join(x,y)` },
  { id: 'reuse-tool-two-tools', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [30, 0, 0])}; const c = ${C(8, 40, [15, 0, 0])}; const e = ${C(3, 40, [0, 10, 0])}; const x = cut(a,c,e); const y = cut(b,c); join(x,y)`, note: 'one reused tool and one used once' },
  { id: 'reuse-box-tool-two-plates', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [80, 0, 0])}; const t = ${B(160, 10, 10, [40, 0, 0])}; const x = cut(a,t); const y = cut(b,t); join(x,y)`, analytic: 56000, note: 'planar tool shared by two separate plates' },
  { id: 'reuse-box-tool-keep', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [80, 0, 0])}; const t = ${B(160, 10, 10, [40, 0, 0])}; const x = keep(a,t); const y = keep(b,t); join(x,y)`, analytic: 8000, note: 'planar tool shared by two keeps' },
  { id: 'reuse-ctl-cyl-two-tools', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [30, 0, 0])}; const c = ${C(8, 40, [15, 0, 0])}; const c2 = ${C(8, 40, [15, 0, 0])}; const e = ${C(3, 40, [0, 10, 0])}; const x = cut(a,c,e); const y = cut(b,c2); join(x,y)`, note: 'CONTROL for reuse-tool-two-tools: a second identical cylinder instead of reusing the first (no keep_tools). Same face census = the census gap is not caused by reuse' },
  { id: 'reuse-round-tool-disjoint', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const b = ${B(40, 40, 20, [0, 0, 40])}; const c = ${C(8, 120, [0, 0, 20])}; const x = cut(a,c); const y = cut(b,c); join(x,y)`, analytic: 2 * (32000 - 64 * Math.PI * 20), note: 'one long round cutter through two separate plates' },
  { id: 'reuse-tool-first-arg', feature: F.reuse, script: `const a = ${B(40, 40, 20)}; const c = ${C(8, 40, [10, 0, 0])}; const x = join(a,c); const d = ${B(10, 10, 10, [10, 0, 0])}; cut(c,d)`, note: 'c is a TARGET of the 2nd combine after being a tool of the 1st' },

  // ---- time budget: round shapes crossing at an angle, a torus meeting a box (raw SolidCraft times; guarded they are refused before the call) ---
  { id: 'hg-cyl-perp-equal-cut', feature: F.hang, features: [cyl('c1', 10, 40), cyl('c2', 10, 40, [0, 0, 0], [90, 0, 0]), op('op1', 'subtract', ['c1', 'c2'])], note: 'equal radii, axes at right angles (the keep version is x-cyl-cross-cyl-equal-keep)' },
  { id: 'hg-cyl-tilt45-union', feature: F.hang, features: [cyl('c1', 10, 40), cyl('c2', 5, 40, [0, 0, 0], [45, 0, 0]), op('op1', 'union', ['c1', 'c2'])] },
  { id: 'hg-cyl-inside-perp', feature: F.hang, features: [cyl('c1', 10, 40), cyl('c2', 2, 10, [0, 0, 0], [0, 90, 0]), op('op1', 'subtract', ['c1', 'c2'])], note: 'small cylinder with a perpendicular axis wholly inside the big one: no surface meets (the guard still refuses on bounding boxes)' },
  { id: 'hg-tor-half-d0', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(80, 80, 80, [40, 0, 0])}; cut(t,b)`, note: 'cutting plane x=0 contains the torus axis' },
  { id: 'hg-tor-half-d2', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(80, 80, 80, [42, 0, 0])}; cut(t,b)`, note: 'cutting plane x=2: 2 mm off the axis' },
  { id: 'hg-tor-half-d14', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(80, 80, 80, [54, 0, 0])}; cut(t,b)`, note: 'cutting plane x=14 through the tube centre' },
  { id: 'hg-tor-equator-z0', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(80, 80, 80, [0, 0, 40])}; cut(t,b)`, note: 'cutting plane z=0 is perpendicular to the axis (equatorial)' },
  { id: 'hg-tor-equator-z2', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(80, 80, 80, [0, 0, 42])}; cut(t,b)` },
  { id: 'hg-tor-miss', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(10, 10, 10, [40, 0, 0])}; join(t,b)`, note: 'box nowhere near the ring: two pieces' },
  { id: 'hg-tor-union-embedded-box', feature: F.hang, script: `const t = ${R(14, 4)}; const b = ${B(6, 6, 6, [14, 0, 0])}; join(t,b)`, note: 'small box wholly inside the tube cross-section' },
  { id: 'hg-tor-void-in-box', feature: F.hang, script: `const a = ${B(60, 60, 30)}; const t = ${R(14, 4)}; cut(a,t)`, note: 'torus strictly inside a box (the measured-safe case, size changed)' },

  // ---- wasm traps ---------------------------------------------------------------------------------------------------------------------
  { id: 'trap-tor-union-box-tangent', feature: F.trap, features: [tor('t', 14, 4), box('b', [10, 10, 40], [23, 0, 0]), op('op1', 'union', ['t', 'b'])], note: 'box face x=18 tangent to the tube outer equator' },
  { id: 'trap-tor-union-tor-shift10', feature: F.trap, features: [tor('t1', 14, 4), tor('t2', 14, 4, [10, 0, 0]), op('op1', 'union', ['t1', 't2'])] },
  { id: 'trap-box-cut-spindle', feature: F.trap, features: [box('a', [60, 60, 60]), tor('t', 5, 8, [0, 0, 0]), op('op1', 'subtract', ['a', 't'])], note: 'spindle torus: tube radius 8 > ring radius 5' },
);

// fuzz pairs written by bool-fuzz-gen.mjs (booleans-r2/fuzz-cases-<seed>.json), appended when present
try {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'booleans-r2');
  for (const f of readdirSync(dir).filter((x) => /^fuzz-cases-\d+\.json$/.test(x)).sort()) CASES.push(...JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
} catch { /* no fuzz files yet */ }
