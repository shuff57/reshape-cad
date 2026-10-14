// SPIKE (phase 3), referee/demo only. The example gallery: every script here was RUN (make-reference.mjs and the
// browser verification, see VERIFY.md). `expect` is what a reviewer should see; `closed` is a closed-form volume
// (arithmetic written out so it can be checked by eye); the OCCT / brep-rs numbers are measured by make-reference.mjs.
//
// Group:  '3d'      3D script, no sketch constraints
//         '2d'      constrained 2D sketch (sk.geom + sk.rules rows), solved by SOLIDCRAFT's own sketch solver
//         'diag'    sketch diagnostics: under-constrained / redundant / conflicting
//         'refusal' a feature the browser demo refuses, with the plain sentence
// Syntax note: reSHape Script exposes constraints in two forms. (a) sk.geom([...]) + sk.rules([...]) rows (the "soup"):
// this is the form phase 2 maps onto solidcraft's solver and the form used for every '2d' / 'diag' example.
// (b) the handle API (sk.rect/polygon + sk.length/across/up/equal/angle...): solved by reSHape's own TS solver inside
// solveDoc, so solidcraft only sees the SOLVED outline. One example (2d-handle-api) shows (b), labelled.

const fmt = (v) => {
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
};
const row = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`;
const rows = (rs) => rs.map((r) => `  ${row(r)}`).join(',\n');
const L = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
const loop = (n) => Array.from({ length: n }, (_, i) => join(i + 1, ((i + 1) % n) + 1));
const len = (i, value) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b', value });
const origin = (id) => ({ k: 'coincident', a: id, aEnd: 'a', b: -1, bEnd: 'a' });
const rectG = (x0, y0, x1, y1) => [L(1, [x0, y0], [x1, y0]), L(2, [x1, y0], [x1, y1]), L(3, [x1, y1], [x0, y1]), L(4, [x0, y1], [x0, y0])];
const rectR = () => [...loop(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const soup = (comment, geoms, rules, tail = 'const part = extrude(sk, 10)') =>
  `// ${comment.split('\n').join('\n// ')}\nconst sk = sketch('top')\nsk.geom([\n${rows(geoms)}\n])\nsk.rules([\n${rows(rules)}\n])\n${tail}`;

const hexV = (r, k) => [r * Math.cos(((60 * k - 30) * Math.PI) / 180), r * Math.sin(((60 * k - 30) * Math.PI) / 180)].map((x) => +x.toFixed(6));
const hexLines = Array.from({ length: 6 }, (_, k) => L(k + 1, hexV(20, k), hexV(20, (k + 1) % 6)));
const R = 10, SL = 40;
const slotG = [
  { k: 'arc', id: 1, c: [0, R], r: R, a: [0, 0], b: [0, 2 * R], sense: 'cw' },
  { k: 'arc', id: 2, c: [SL, R], r: R, a: [SL, 2 * R], b: [SL, 0], sense: 'cw' },
  L(3, [0, 2 * R], [SL, 2 * R]),
  L(4, [SL, 0], [0, 0]),
];
const tj = (l, le, a, ae) => [{ k: 'coincident', a: l, aEnd: le, b: a, bEnd: ae }, { k: 'tangent', a: l, aEnd: le, b: a, bEnd: ae }];
const slotR = [...tj(3, 'a', 1, 'b'), ...tj(3, 'b', 2, 'a'), ...tj(4, 'a', 2, 'b'), ...tj(4, 'b', 1, 'a'),
  { k: 'radius', a: 1, value: R }, { k: 'equal', a: 1, b: 2 }, { k: 'horizontal', a: 3 }, len(3, SL), { k: 'lock', a: 1, aEnd: 'c' }];

const conflictBase = [...rectR(), { k: 'lock', a: 1, aEnd: 'a' },
  { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 20 }];
const base40x20 = rectG(0, 0, 40, 20);

export const EXAMPLES = [
  // ---- 3D --------------------------------------------------------------------------------------------------------
  { id: '3d-box-hole', group: '3d', title: 'Box with a through hole',
    script: `// a 40 x 30 x 10 plate with a 6 mm hole drilled through its middle\nconst b = cuboid(40, 30, 10)\nhole(b, { across: 6 })`,
    expect: 'One body. Volume 40*30*10 - pi*3^2*10 = 11717.257 mm3 (curved, so within 3e-4 of OCCT).', closed: 12000 - Math.PI * 9 * 10, curved: true },
  { id: '3d-extrude-sketch', group: '3d', title: 'Extruded L-shaped sketch',
    script: `// an L-shaped polygon sketched on the top plane, pulled up 12 mm\nconst sk = sketch('top')\nsk.polygon([[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]])\nconst shape = extrude(sk, 12)`,
    expect: 'One body. Area 40*15 + 15*15 = 825, volume 825*12 = 9900 mm3. bbox 0..40 x 0..30 x 0..12.', closed: 9900 },
  { id: '3d-revolve', group: '3d', title: 'Revolve: a ring',
    script: `// a 30 x 10 rectangle 25..55 mm from the axis, spun a full turn\nconst sk = sketch('front', 0)\nsk.rect(30, 10, { at: [40, 0] })\nconst shape = revolve(sk, 360)`,
    expect: 'One body. Volume pi*(55^2 - 25^2)*10 = 75398.2 mm3 (curved).', closed: Math.PI * (55 * 55 - 25 * 25) * 10, curved: true },
  { id: '3d-union', group: '3d', title: 'Boolean union: base plus post',
    script: `// a 40 x 40 x 10 base fused with a 6 mm post 20 mm tall\nconst base = cuboid(40, 40, 10, { at: [0, 0, 5] })\nconst post = cylinder(6, 20, { at: [0, 0, 10] })\nunion(base, post)`,
    expect: 'One body (union). Volume = base 16000 + the part of the post above the base. Compare with the OCCT number in the badge.', curved: true },
  { id: '3d-subtract', group: '3d', title: 'Boolean subtract: a square pocket through',
    script: `// a 40 x 40 x 20 block with a 20 x 20 square cutter that goes all the way through\nconst b = cuboid(40, 40, 20, { at: [0, 0, 10] })\nconst cutter = cuboid(20, 20, 30, { at: [0, 0, 15] })\nsubtract(b, cutter)`,
    expect: 'One body. Volume 40*40*20 - 20*20*20 = 24000 mm3 (planar, exact).', closed: 24000 },
  { id: '3d-linear-pattern', group: '3d', title: 'Linear pattern: three copies',
    script: `// a 20 x 20 x 10 block copied 3 times, 60 mm apart\nconst b = cuboid(20, 20, 10)\nlinearPattern(b, { count: 3, step: 60 })`,
    expect: 'Three bodies. Total volume 3 * 4000 = 12000 mm3.', closed: 12000 },
  { id: '3d-polar-pattern', group: '3d', title: 'Polar pattern: four copies round Z',
    script: `// a 10 x 30 x 10 block, 25 mm from the axis, copied 4 times round Z\nconst b = cuboid(10, 30, 10, { at: [25, 0, 0] })\npolarPattern(b, { count: 4, axis: 'z' })`,
    expect: 'Four bodies. Total volume 4 * 3000 = 12000 mm3.', closed: 12000 },
  // ---- constrained 2D (soup rows, solidcraft solver) ------------------------------------------------------------
  { id: '2d-rect-dims', group: '2d', title: 'Rectangle with width and height dimensions (hand-drawn start)',
    script: soup('a sloppy 28.2 x 17 rectangle near (4,2): the rules dimension it 30 x 20 with its corner 5 right and 3 up of the origin\nsolidcraft solves the dimensions, brep-rs and a closed form agree on the result',
      rectG(4.2, 2.1, 32.4, 19.1),
      [...rectR(), { k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 5 }, { k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 3 }, len(1, 30), len(2, 20)]),
    expect: 'One body, 30 x 20 x 10 = 6000 mm3, bbox [5,3,0, 35,23,10]. Sketch report: dof 0, failing none.', closed: 6000, dof: 0, bbox: [5, 3, 0, 35, 23, 10] },
  { id: '2d-plate-hole-dims', group: '2d', title: 'Plate with a dimensioned hole (two loops)',
    script: soup('a 40 x 25 plate; a hole of diameter 10 whose centre is 20 right and 12.5 up of the plate corner\nthe corner sits on the origin; the outer loop is the plate, the inner circle is a hole (even-odd fill)',
      [...rectG(0.3, 0.2, 39, 25.6), { k: 'circle', id: 5, c: [19, 13.5], r: 4.4 }],
      [...rectR(), origin(1), len(1, 40), len(2, 25), { k: 'diameter', a: 5, value: 10 },
        { k: 'distanceX', a: 1, aEnd: 'a', b: 5, bEnd: 'c', value: 20 }, { k: 'distanceY', a: 1, aEnd: 'a', b: 5, bEnd: 'c', value: 12.5 }]),
    expect: 'One body with a hole: 40*25*10 - pi*5^2*10 = 9214.60 mm3. If the hole were filled it would read 10000. dof 0.', closed: 10000 - Math.PI * 25 * 10, curved: true, dof: 0 },
  { id: '2d-slot-tangent', group: '2d', title: 'Slot: two lines and two tangent arcs',
    script: soup('a slot: lines 40 mm long, 20 apart, closed by two R10 arcs that are tangent to them\nradius dimension + equal arcs + horizontal + length + one pinned centre',
      slotG, slotR),
    expect: 'One body, (40*20 + pi*10^2)*10 = 11141.59 mm3, bbox [-10,0,0, 50,20,10]. Known limit: solidcraft leaves the tangent joints ~1e-4 mm off; volume is inside the 3e-4 bar. Its dof may read higher than 0 (misreported on an already-tangent start).', closed: (SL * 2 * R + Math.PI * R * R) * 10, curved: true, dof: 0, bbox: [-10, 0, 0, 50, 20, 10] },
  { id: '2d-triangle-angle', group: '2d', title: 'Triangle with two lengths and an angle dimension',
    script: soup('a triangle: base 40 on the X axis from the origin, side 30, and 120 deg between side 1 and side 2\n(120 deg is the exterior angle: the interior corner is 60 deg)',
      [L(1, [0.5, 0.4], [39, 1]), L(2, [39, 1], [25, 26.5]), L(3, [25, 26.5], [0.5, 0.4])],
      [...loop(3), { k: 'horizontal', a: 1 }, origin(1), len(1, 40), len(2, 30), { k: 'angle', a: 1, b: 2, value: 120 }]),
    expect: 'One body. Area 0.5*40*30*sin(60 deg) = 519.615, volume 5196.15 mm3. dof 0.', closed: 0.5 * 40 * 30 * Math.sin(Math.PI / 3) * 10, dof: 0 },
  { id: '2d-hexagon', group: '2d', title: 'Regular hexagon from equal sides and a construction circle',
    script: soup('six lines, five equal-length rules, six vertices on a construction circle of radius 20 centred on the origin, one vertical side',
      [...hexLines, { k: 'circle', id: 7, c: [0.3, -0.2], r: 19.4, construction: true }],
      [...loop(6), ...[1, 2, 3, 4, 5].map((i) => ({ k: 'equal', a: i, b: i + 1 })),
        ...[1, 2, 3, 4, 5, 6].map((i) => ({ k: 'pointOnObject', a: i, aEnd: 'a', b: 7 })),
        { k: 'coincident', a: 7, aEnd: 'c', b: -1, bEnd: 'a' }, { k: 'radius', a: 7, value: 20 }, { k: 'vertical', a: 1 }]),
    expect: 'One body. Area (3*sqrt(3)/2)*20^2 = 1039.23, volume 10392.3 mm3. dof 0 (solidcraft may misreport on an already-regular start).', closed: ((3 * Math.sqrt(3)) / 2) * 400 * 10, dof: 0 },
  { id: '2d-handle-api', group: '2d', title: 'Handle API: rect + length/across/up (reSHape solver, not solidcraft)',
    script: `// the same kind of dimensions through the handle API (sk.length, sk.across, sk.up)\n// NOTE: these are solved by reSHape's own TS solver in solveDoc; solidcraft only sees the solved outline,\n// so there is no solidcraft solver report for this sketch\nconst sk = sketch('top')\nsk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])\nsk.across(1)\nsk.up(2)\nsk.length(1, 40)\nconst shape = extrude(sk, 12)`,
    expect: 'One body, 40*25*12 = 12000 mm3. No solidcraft sketch report (labelled: solved by reSHape).', closed: 12000 },
  // ---- diagnostics ------------------------------------------------------------------------------------------------
  { id: 'diag-under', group: 'diag', title: 'Under-constrained: only the width is dimensioned',
    script: soup('a rectangle with joins, horizontal/vertical and ONE length (40). Height and position are free.\nsolidcraft keeps the drawn start (height 20) and reports the freedom',
      base40x20, [...rectR(), len(1, 40)]),
    expect: 'One body, 40*20*10 = 8000 mm3 (as drawn). Sketch report: dof 3 (16 - 8 joins - 4 h/v - 1 length), failing none. The part is built; the diagnostic says what is still free.', closed: 8000, dof: 3 },
  { id: 'diag-conflict', group: 'diag', title: 'Conflicting: width dimensioned 40 and 50',
    script: soup('the same rectangle with width 40, height 20, and a second, contradictory width of 50\nsolidcraft refuses the second dimension at command time; nothing is extruded',
      base40x20, [...conflictBase, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 50 }]),
    expect: 'REFUSAL. The extrude is refused with solidcraft\'s own sentence about the dimension conflicting; the viewport shows no body, and the document is restored (earlier accepted features stay). No part is built from half the rules.', refusal: true, expectRefused: [{ id: 'pull1', contains: 'over-constrain' }], expectBuilt: [] },
  { id: 'diag-redundant', group: 'diag', title: 'Redundant: width dimensioned 40 twice',
    script: soup('the same rectangle with width 40 stated twice. brep-rs and FreeCAD accept this (redundant, builds); solidcraft is stricter',
      base40x20, [...conflictBase, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }]),
    expect: 'REFUSAL by solidcraft, though brep-rs builds 8000 mm3 (volume 40*20*10). This is a documented difference (phase 2: SOLIDCRAFT-STRICTER), not a wrong solid.', refusal: true, brepBuilds: true, closed: 8000, expectRefused: [{ id: 'pull1', contains: 'already determined' }], expectBuilt: [] },
  // ---- refusals ---------------------------------------------------------------------------------------------------
  { id: 'refuse-counterbore-round', group: 'refusal', title: 'Counterbore and a named-edge round',
    script: `const base = cuboid(40, 30, 10)\nconst post = extrude(sketch('top', 5).rect(10, 10), 20)\nhole(base, { across: 6, at: [12, 0], counterbore: { across: 10, deep: 3 } })\nconst other = cuboid(10, 10, 10, { at: [30, 0, 0] })\nround(other.edge('top', 'right'), 1)`,
    expect: 'Mixed: base, post and the other box build; the counterbored hole and the round are each refused with a sentence (the round needs brep-rs name lookup, which the browser does not have).', partial: true, expectRefused: [{ id: 'hole1', contains: 'counterbore' }, { id: 'round1', contains: 'no brep-rs name lookup' }], expectBuilt: ['box1', 'pull1', 'box2'] },
  { id: 'refuse-shell-closed', group: 'refusal', title: 'Shell: a closed hollow box (no open face)',
    script: `// a closed hollow box, 2 mm walls: no face is opened\nconst b = cuboid(40, 40, 20)\nshell(b, { wall: 2 })`,
    expect: 'REFUSAL by this spike\'s translator: a shell needs a face to remove and a closed hollow box is not mapped. brep-rs builds it (40*40*20 - 36*36*16 = 11264 mm3). The box itself still builds (32000).', refusal: true, partial: true, closed: 40 * 40 * 20 - 36 * 36 * 16, expectRefused: [{ id: 'shell1', contains: 'closed hollow box is not mapped' }], expectBuilt: ['box1'] },
  { id: 'refuse-shell-open', group: 'refusal', title: 'Shell with an open face (named pick)',
    script: `// a shell that opens the top face needs a named face pick, which in the browser has no brep-rs lookup\nconst b = cuboid(40, 40, 20)\nshell(b, { wall: 2, open: 'top' })`,
    expect: 'REFUSAL with a plain sentence that the pick cannot be resolved in the browser. The box itself still builds.', refusal: true, partial: true, expectRefused: [{ id: 'shell1', contains: 'no brep-rs name lookup' }], expectBuilt: ['box1'] },
  { id: 'refuse-edge-pick', group: 'refusal', title: 'Fillet on a named edge',
    script: `const b = cuboid(40, 40, 20)\nround(b.edge('top', 'front'), 3)`,
    expect: 'REFUSAL with a plain sentence that the edge pick cannot be resolved in the browser. The box itself still builds.', refusal: true, partial: true, expectRefused: [{ id: 'round1', contains: 'no brep-rs name lookup' }], expectBuilt: ['box1'] },
];
