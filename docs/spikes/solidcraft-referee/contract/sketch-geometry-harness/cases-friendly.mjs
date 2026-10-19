// Friendly spike syntax (phase 5 shim): the phase-5 gallery scripts + one case per call. All run through withPreamble.
import { pathToFileURL } from 'node:url';
const REAL = '/home/shuff57/Documents/GitHub/reshape-cad';
const { FRIENDLY, MISUSE } = await import(pathToFileURL(`${REAL}/docs/spikes/solidcraft-referee/phase5/examples.mjs`).href);
const P = Math.PI;
const f = (id, feature, body, what, extra = {}) => ({ id, feature, what, preamble: true, script: `const sk = sketch('top')\n${body}\nconst part = extrude(sk, 10)`, ...extra });
export const cases = [
  ...FRIENDLY.map((e) => ({
    id: `gallery-${e.id}`, feature: 'friendly gallery', what: e.title, preamble: true, script: e.script,
    exact: e.closed != null ? { volume: e.closed, ...(e.bbox ? { bbox: e.bbox } : {}) } : undefined, curved: e.curved,
  })),
  f('fr-line-triangle', 'sk.line', "const a = sk.line([0,0],[20,0])\nconst b = sk.line(a.b,[0,15])\nconst c = sk.line(b.b, a.a)", 'three lines joined by reusing handles', { exact: { volume: 1500, bbox: [0, 0, 0, 20, 15, 10] } }),
  f('fr-line-not-joined', 'sk.line', "sk.line([0,0],[20,0])\nsk.line([20,0],[0,15])\nsk.line([0,15],[0,0])", 'same triangle by coordinates only (no handle reuse): the doc says "touching is not joined"', { exact: { volume: 1500 } }),
  f('fr-circle-r', 'sk.circle', "sk.circle([5,5], { r: 3 })", 'circle by radius', { exact: { volume: P * 9 * 10, bbox: [2, 2, 0, 8, 8, 10] }, curved: true }),
  f('fr-circle-across', 'sk.circle', "sk.circle([5,5], { across: 6 })", 'circle by across', { exact: { volume: P * 9 * 10, bbox: [2, 2, 0, 8, 8, 10] }, curved: true }),
  f('fr-circle-both', 'sk.circle', "sk.circle([5,5], { r: 3, across: 6 })", 'both r and across: refused'),
  f('fr-circle-neither', 'sk.circle', "sk.circle([5,5])", 'neither r nor across: refused'),
  f('fr-circle-construction', 'sk.circle', "sk.rectangle([0,0],[20,10])\nsk.circle([10,5], { r: 3, construction: true })", 'construction circle inside a rectangle: no hole', { exact: { volume: 2000 }, curved: false }),
  f('fr-arc-cw-D', 'sk.arc', "const l = sk.line([0,-10],[0,10])\nconst a = sk.arc([0,0], l.b, l.a, 'cw')", 'D shape: line + arc cw from top to bottom (right half disc)', { exact: { volume: 0.5 * P * 100 * 10, bbox: [0, -10, 0, 10, 10, 10] }, curved: true }),
  f('fr-arc-ccw-D', 'sk.arc', "const l = sk.line([0,-10],[0,10])\nconst a = sk.arc([0,0], l.b, l.a, 'ccw')", 'D shape: arc ccw from top to bottom (left half disc)', { exact: { volume: 0.5 * P * 100 * 10, bbox: [-10, -10, 0, 0, 10, 10] }, curved: true }),
  f('fr-arc-pie-ccw', 'sk.arc', "const l1 = sk.line([0,0],[10,0])\nconst a = sk.arc([0,0], l1.b, [0,10], 'ccw')\nconst l2 = sk.line(a.b, l1.a)", 'quarter pie, ccw', { exact: { volume: 0.25 * P * 100 * 10 }, curved: true }),
  f('fr-arc-pie-cw', 'sk.arc', "const l1 = sk.line([0,0],[10,0])\nconst a = sk.arc([0,0], l1.b, [0,10], 'cw')\nconst l2 = sk.line(a.b, l1.a)", '3/4 pie: the same ends with cw', { exact: { volume: 0.75 * P * 100 * 10 }, curved: true }),
  f('fr-arc-no-dir', 'sk.arc', "sk.arc([0,0],[10,0],[0,10])", 'arc with no direction word: refused'),
  f('fr-arc-bad-dir', 'sk.arc', "sk.arc([0,0],[10,0],[0,10],'left')", "arc direction 'left': refused"),
  f('fr-arc-not-on-circle', 'sk.arc', "sk.arc([0,0],[10,0],[0,12],'ccw')", 'arc whose ends are at different radii: refused'),
  f('fr-point', 'sk.point', "sk.point([3,3])\nsk.rectangle([0,0],[20,10])", 'a point row beside a rectangle', { exact: { volume: 2000 } }),
  f('fr-lines-closed', 'sk.lines', "sk.lines([[0,0],[20,0],[20,10],[0,10]], { closed: true })", 'composite closed polyline', { exact: { volume: 2000, bbox: [0, 0, 0, 20, 10, 10] } }),
  f('fr-lines-open', 'sk.lines', "sk.lines([[0,0],[20,0],[20,10],[0,10]])", 'open polyline: nothing to pull'),
  f('fr-rectangle', 'sk.rectangle', "const r = sk.rectangle([2,3],[22,13])", 'rectangle tool rows (no dimension)', { exact: { volume: 2000, bbox: [2, 3, 0, 22, 13, 10] } }),
  f('fr-rectangle-handles', 'sk.rectangle', "const r = sk.rectangle([2,3],[22,13])\nsk.join(r.bottom.a, sk.origin)", 'rectangle corner moved onto the origin by join(corner, sk.origin), nothing else pinned: underdetermined (22 x 13 expected: only that corner moves)', { exact: { volume: 2860 } }),
  f('fr-axes-triangle', 'sk.origin/xAxis/yAxis', "const l = sk.line([1,1],[19,2])\nconst m = sk.line(l.b,[19,14])\nconst n = sk.line(m.b,l.a)\nsk.parallel(l, sk.xAxis)\nsk.perpendicular(m, sk.xAxis)\nsk.length(l, 18)\nsk.length(m, 12)\nsk.at(l.a, [0, 0])", 'right triangle on the axes: l parallel x, m perpendicular x, corner at origin (sk.at), 18 x 12', { exact: { volume: 0.5 * 18 * 12 * 10, bbox: [0, 0, 0, 18, 12, 10] } }),
  f('fr-remove', 'sk.remove', "const a = sk.line([0,0],[20,0])\nconst b = sk.line(a.b,[0,15])\nconst c = sk.line(b.b,a.a)\nconst stray = sk.line([30,30],[40,40])\nsk.remove(stray)", 'a stray line removed: the triangle remains', { exact: { volume: 1500 } }),
  f('fr-remove-all', 'sk.remove', "const a = sk.line([0,0],[20,0])\nsk.remove(a)", 'removing the only shape: refused (else the default 40x25 rectangle appears)'),
  f('fr-handles-abc', 'handles .a .b .c', "const c = sk.circle([0,0],{r:5})\nconst r = sk.rectangle([10,-5],[20,5])\nsk.join(c.c, sk.origin)\nsk.horizontal(r.bottom)", 'circle centre handle .c joined to origin, plus an apart rectangle', { exact: { volume: (P * 25 + 100) * 10 }, curved: true }),
  f('fr-bad-handle', 'handles .a .b .c', "const l = sk.line([0,0],[10,0])\nsk.join(l.mid, sk.origin)", 'unknown handle l.mid: refused'),
  f('fr-dimensions-rect', 'sk.rectangle', "const r = sk.rectangle([0,0],[17,9])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\nsk.at(r.bottom.a, [5, 3])", 'rectangle sloppy 17x9, dimensioned 30 x 20 at (5,3)', { exact: { volume: 6000, bbox: [5, 3, 0, 35, 23, 10] } }),
  f('fr-symmetric', 'sk.symmetric', "const a = sk.line([-10,0],[10,0])\nconst b = sk.line(a.b,[6,10])\nconst c = sk.line(b.b,[-6,10])\nconst d = sk.line(c.b,a.a)\nsk.symmetric(a.a, a.b, sk.yAxis)\nsk.symmetric(c.a, c.b, sk.yAxis)\nsk.horizontal(a)\nsk.horizontal(c)\nsk.length(a, 20)\nsk.length(c, 12)\nsk.dy(a.a, c.a, 10)\nsk.pointOn(a.a, sk.xAxis)", 'isosceles trapezoid mirrored about sk.yAxis, bottom 20 top 12 height 10', { exact: { volume: 0.5 * (20 + 12) * 10 * 10, bbox: [-10, 0, 0, 10, 10, 10] } }),
  f('fr-equal-parallel', 'sk.equal/parallel', "const r = sk.lines([[0,0],[20,0],[22,10],[2,10]], { closed: true })\nsk.parallel(r[0], r[2])\nsk.horizontal(r[0])\nsk.horizontal(r[2])\nsk.length(r[0], 20)", 'sk.lines returns? parallelogram by parallel + horizontal (probe: does sk.lines return handles)', {}),
  ...MISUSE.map((m) => ({ id: `misuse-${m.id}`, feature: 'friendly misuse', what: m.title, preamble: true, script: m.script, expectContains: m.contains })),
];
