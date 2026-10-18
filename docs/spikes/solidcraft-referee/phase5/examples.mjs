// SPIKE (phase 5), referee/demo only. The friendly-sketch gallery group: five re-expressions of phase 3/4 soup examples (each
// names the soup example it must equal in `equivOf`; verify-equivalence.mjs proves it), two new examples, and the misuse scripts.
// The scripts here are what a student would write; the page runs them through the sandbox with the shim's one-line preamble.
const R = 10, SL = 40;

const hexV = (r, k) => [r * Math.cos(((60 * k - 30) * Math.PI) / 180), r * Math.sin(((60 * k - 30) * Math.PI) / 180)].map((x) => +x.toFixed(6));
const hexPts = Array.from({ length: 6 }, (_, k) => hexV(20, k));

export const FRIENDLY = [
  { id: 'fr-rect-dims', group: 'friendly', equivOf: '2d-rect-dims', title: 'Rectangle with width and height dimensions (hand-drawn start)',
    script: `// a sloppy 28.2 x 17 rectangle near (4,2), dimensioned 30 x 20 with its corner 5 right and 3 up of the origin
const sk = sketch('top')
const r = sk.rectangle([4.2, 2.1], [32.4, 19.1])   // 4 lines, joined, level and plumb
sk.at(r.bottom.a, [5, 3])
sk.length(r.bottom, 30)
sk.length(r.right, 20)
const part = extrude(sk, 10)`,
    expect: 'FRIENDLY re-expression of 2d-rect-dims: the same soup rows, so the same part. One body, 30 x 20 x 10 = 6000 mm3, bbox [5,3,0, 35,23,10]. dof 0.', closed: 6000, dof: 0, bbox: [5, 3, 0, 35, 23, 10] },
  { id: 'fr-plate-hole-dims', group: 'friendly', equivOf: '2d-plate-hole-dims', title: 'Plate with a dimensioned hole (two loops)',
    script: `// a 40 x 25 plate on the origin, with a hole of diameter 10 centred 20 right and 12.5 up of the plate corner
const sk = sketch('top')
const plate = sk.rectangle([0.3, 0.2], [39, 25.6])
const hole = sk.circle([19, 13.5], { r: 4.4 })
sk.at(plate.bottom.a, [0, 0])
sk.length(plate.bottom, 40)
sk.length(plate.right, 25)
sk.diameter(hole, 10)
sk.dx(plate.bottom.a, hole.c, 20)
sk.dy(plate.bottom.a, hole.c, 12.5)
const part = extrude(sk, 10)`,
    expect: 'FRIENDLY re-expression of 2d-plate-hole-dims: 40*25*10 - pi*5^2*10 = 9214.60 mm3. dof 0.', closed: 10000 - Math.PI * 25 * 10, curved: true, dof: 0 },
  { id: 'fr-slot-tangent', group: 'friendly', equivOf: '2d-slot-tangent', title: 'Slot: two lines and two tangent arcs',
    script: `// a slot: lines 40 long, 20 apart, closed by two R10 arcs tangent to them
const sk = sketch('top')
const left = sk.arc([0, 10], [0, 0], [0, 20], 'cw')
const right = sk.arc([40, 10], [40, 20], [40, 0], 'cw')
const top = sk.line([0, 20], [40, 20])
const bottom = sk.line([40, 0], [0, 0])
sk.tangent(top.a, left.b)       // the two ends meet smoothly
sk.tangent(top.b, right.a)
sk.tangent(bottom.a, right.b)
sk.tangent(bottom.b, left.a)
sk.radius(left, 10)
sk.equal(left, right)
sk.horizontal(top)
sk.length(top, 40)
sk.fix(left.c)
const part = extrude(sk, 10)`,
    expect: 'FRIENDLY re-expression of 2d-slot-tangent: (40*20 + pi*10^2)*10 = 11141.59 mm3, bbox [-10,0,0, 50,20,10]. Same known limit (tangent joints ~1e-4 mm off).', closed: (SL * 2 * R + Math.PI * R * R) * 10, curved: true, dof: 0, bbox: [-10, 0, 0, 50, 20, 10] },
  { id: 'fr-triangle-angle', group: 'friendly', equivOf: '2d-triangle-angle', title: 'Triangle with two lengths and an angle dimension',
    script: `// base 40 on the X axis from the origin, side 30, and 120 deg between side 1 and side 2 (exterior angle; interior is 60)
const sk = sketch('top')
const base = sk.line([0.5, 0.4], [39, 1])
const side = sk.line(base.b, [25, 26.5])   // starts on base.b: joined
const back = sk.line(side.b, base.a)       // starts on side.b, ends on base.a: joined both ends
sk.horizontal(base)
sk.at(base.a, [0, 0])
sk.length(base, 40)
sk.length(side, 30)
sk.angle(base, side, 120)
const part = extrude(sk, 10)`,
    expect: 'FRIENDLY re-expression of 2d-triangle-angle: area 0.5*40*30*sin(60 deg), volume 5196.15 mm3. dof 0. Reusing endpoints writes each join with the existing end first, so two join rows read in the other order than the hand-written soup (equal as an unordered pair; see VERIFY.md).', closed: 0.5 * 40 * 30 * Math.sin(Math.PI / 3) * 10, dof: 0 },
  { id: 'fr-hexagon', group: 'friendly', equivOf: '2d-hexagon', title: 'Regular hexagon from equal sides and a construction circle',
    script: `// six lines, equal sides, every vertex on a construction circle of radius 20 centred on the origin, one vertical side
const sk = sketch('top')
const side = sk.lines(${JSON.stringify(hexPts)}, { closed: true })
const ring = sk.circle([0.3, -0.2], { r: 19.4, construction: true })
for (let i = 0; i < 5; i++) sk.equal(side[i], side[i + 1])
for (const s of side) sk.pointOn(s.a, ring)
sk.join(ring.c, sk.origin)
sk.radius(ring, 20)
sk.vertical(side[0])
const part = extrude(sk, 10)`,
    expect: 'FRIENDLY re-expression of 2d-hexagon: area (3*sqrt(3)/2)*20^2, volume 10392.3 mm3. dof 0.', closed: ((3 * Math.sqrt(3)) / 2) * 400 * 10, dof: 0 },
  { id: 'fr-untouched-default', group: 'friendly', title: 'A sketch nothing is drawn on: the interpreter\'s DEFAULT 40 x 25 rectangle (documented, not a friendly feature)',
    script: `// nothing is drawn on this sketch. The interpreter's own default is a 40 x 25 rectangle, and extrude pulls THAT.
// (This is not an error; an emptied sketch via sk.remove() IS refused, see misuse-remove-all.)
const sk = sketch('top')
const part = extrude(sk, 10)`,
    expect: 'DOCUMENTED INTERPRETER DEFAULT, not a friendly-syntax feature. One body 40 x 25 x 10 = 10000 mm3. A student who forgets to draw gets this plate, silently: the shim cannot see extrude().', closed: 10000, bbox: [0, 0, 0, 40, 25, 10] },
  // ---- new ---------------------------------------------------------------------------------------------------------
  { id: 'fr-bracket-rounded', group: 'friendly', title: 'Rounded-corner bracket outline with two holes',
    script: `// a 60 x 40 bracket plate, 8 thick, corners rounded R6 (each arc tangent to both lines), two 6 mm holes
const sk = sketch('top')
const bottom = sk.line([6, 0], [54, 0])
const br = sk.arc([54, 6], bottom.b, [60, 6], 'ccw')     // starts on bottom.b: joined
const right = sk.line(br.b, [60, 34])
const tr = sk.arc([54, 34], right.b, [54, 40], 'ccw')
const top = sk.line(tr.b, [6, 40])
const tl = sk.arc([6, 34], top.b, [0, 34], 'ccw')
const left = sk.line(tl.b, [0, 6])
const bl = sk.arc([6, 6], left.b, bottom.a, 'ccw')       // closes the loop on bottom.a
// smooth joints: each line and arc that share an end are tangent there
sk.tangent(bottom, br); sk.tangent(br, right); sk.tangent(right, tr); sk.tangent(tr, top)
sk.tangent(top, tl); sk.tangent(tl, left); sk.tangent(left, bl); sk.tangent(bl, bottom)
sk.horizontal(bottom); sk.vertical(right); sk.horizontal(top); sk.vertical(left)
sk.radius(br, 6)
sk.equal(br, tr); sk.equal(tr, tl); sk.equal(tl, bl)
sk.length(bottom, 48)
sk.length(right, 28)
sk.at(bl.c, [6, 6])
const h1 = sk.circle([10, 20], { r: 3 })
const h2 = sk.circle([50, 20], { r: 3 })
sk.at(h1.c, [10, 20])
sk.at(h2.c, [50, 20])
sk.diameter(h1, 6)
sk.equal(h1, h2)
const part = extrude(sk, 8)`,
    expect: 'NEW. One body with two holes: (60*40 - (4 - pi)*6^2 - 2*pi*3^2) * 8 = 18500.39 mm3 (curved). Closed form written out in examples.mjs; brep-rs and OCCT measured by make-reference.mjs.',
    closed: (60 * 40 - (4 - Math.PI) * 36 - 2 * Math.PI * 9) * 8, curved: true, dof: 0, bbox: [0, 0, 0, 60, 40, 8] },
  { id: 'fr-symmetric-profile', group: 'friendly', title: 'Symmetric T profile (mirrored about a construction line)',
    script: `// a T: stem 10 wide x 30 tall, cap 40 wide x 10 tall, mirrored about a vertical construction line (the mirror axis)
const sk = sketch('top')
const t = sk.lines([[-4.5, 0.4], [5.3, 0.2], [5.1, 29], [19, 30.5], [20.4, 39], [-21, 40.2], [-19.5, 31], [-5.4, 29.5]], { closed: true })
// t[0] bottom, t[1] stem right, t[2] cap underside right, t[3] cap end right, t[4] cap top, t[5] cap end left, t[6] cap underside left, t[7] stem left
const mirror = sk.line([0, -10], [0, 50], { construction: true })
sk.vertical(mirror)
sk.fix(mirror.a)
sk.length(mirror, 60)
sk.symmetric(t[0].a, t[0].b, mirror)
sk.symmetric(t[1].b, t[7].a, mirror)
sk.symmetric(t[2].b, t[6].a, mirror)
sk.symmetric(t[4].a, t[4].b, mirror)
sk.vertical(t[1]); sk.horizontal(t[2]); sk.vertical(t[3])
sk.length(t[0], 10); sk.length(t[4], 40)
sk.length(t[1], 30); sk.length(t[3], 10)
sk.dy(mirror.a, t[0].a, 10)
const part = extrude(sk, 10)`,
    expect: 'NEW. One body, area 10*30 + 40*10 = 700, volume 7000 mm3 (planar, exact), bbox [-20,0,0, 20,40,10]. dof 0. The mirror axis is a drawn construction line, which brep-rs solves; see fr-symmetric-axis for the sketch axis.',
    closed: 7000, dof: 0, bbox: [-20, 0, 0, 20, 40, 10] },
  { id: 'fr-symmetric-axis', group: 'friendly', title: 'Same T, mirrored about sk.yAxis (solidcraft builds; brep-rs refuses an axis mirror)',
    script: `// the same T, but the mirror line is the sketch's own Y axis (sk.yAxis)
const sk = sketch('top')
const t = sk.lines([[-4.5, 0.4], [5.3, 0.2], [5.1, 29], [19, 30.5], [20.4, 39], [-21, 40.2], [-19.5, 31], [-5.4, 29.5]], { closed: true })
sk.symmetric(t[0].a, t[0].b, sk.yAxis)
sk.symmetric(t[1].b, t[7].a, sk.yAxis)
sk.symmetric(t[2].b, t[6].a, sk.yAxis)
sk.symmetric(t[4].a, t[4].b, sk.yAxis)
sk.vertical(t[1]); sk.horizontal(t[2]); sk.vertical(t[3])
sk.length(t[0], 10); sk.length(t[4], 40)
sk.length(t[1], 30); sk.length(t[3], 10)
sk.pointOn(t[0].a, sk.xAxis)
const part = extrude(sk, 10)`,
    expect: 'NEW. solidcraft maps symmetric-about-axis and point-on-axis (phase 2) and builds 7000 mm3 = the closed form (area 700 * 10). brep-rs REFUSES this sketch ("line -3 has zero length; a mirror line has no direction"; phase 2 recorded the same), so the independent reference here is the closed form only.',
    closed: 7000, dof: 0, bbox: [-20, 0, 0, 20, 40, 10] },
];

// ---- misuse: each must stop the script with ONE plain sentence, build nothing, and leave the viewport on the previous run ----
const HEAD = `const sk = sketch('top')\nconst a = sk.line([0, 0], [40, 0])\nconst b = sk.line(a.b, [40, 20])\nconst ring = sk.circle([10, 10], { r: 4 })\n`;
export const MISUSE = [
  { id: 'misuse-unknown-handle', title: 'Unknown handle: a line has no .mid', script: HEAD + `sk.horizontal(a.mid)\nconst part = extrude(sk, 10)`, line: 5, contains: 'has no .mid' },
  { id: 'misuse-dimension-non-line', title: 'Dimension a non-line: a length on a circle', script: HEAD + `sk.length(ring, 12)\nconst part = extrude(sk, 10)`, line: 5, contains: 'needs the first argument to be a line' },
  { id: 'misuse-tangent-two-lines', title: 'Tangent between two lines', script: HEAD + `sk.tangent(a, b)\nconst part = extrude(sk, 10)`, line: 5, contains: 'two straight lines' },
  { id: 'misuse-other-sketch', title: 'A handle from another sketch', script: HEAD + `const sk2 = sketch('front')\nconst c = sk2.line([0, 0], [10, 0])\nsk.parallel(a, c)\nconst part = extrude(sk, 10)`, line: 7, contains: 'belongs to a different sketch()' },
  { id: 'misuse-removed-entity', title: 'A constraint on a removed entity', script: HEAD + `sk.remove(b)\nsk.vertical(b)\nconst part = extrude(sk, 10)`, line: 6, contains: 'was removed with sk.remove()' },
  { id: 'misuse-undefined-entity', title: 'A constraint on a name never drawn', script: HEAD + `sk.vertical(rigth)\nconst part = extrude(sk, 10)`, line: 5, contains: 'rigth' },
  { id: 'misuse-arity', title: 'Wrong arity: sk.length with no value', script: HEAD + `sk.length(a)\nconst part = extrude(sk, 10)`, line: 5, contains: 'takes 2 arguments' },
  { id: 'misuse-negative-radius', title: 'Negative radius', script: HEAD + `sk.radius(ring, -3)\nconst part = extrude(sk, 10)`, line: 5, contains: 'above 0, but got -3' },
  { id: 'misuse-remove-all', title: 'Remove the only shape (would silently draw the default 40 x 25 plate)', script: `const sk = sketch('top')\nconst a = sk.line([0, 0], [40, 0])\nsk.remove(a)\nconst part = extrude(sk, 10)`, line: 3, contains: 'would leave this sketch with no shapes' },
  { id: 'misuse-reassign-sketch', title: 'Assign to the sketch tool', script: HEAD + `sketch = null\nconst part = extrude(sk, 10)`, line: 5, contains: 'is already a reSHape tool here' },
  { id: 'misuse-line-over-line', title: 'A second line exactly on top of one', script: HEAD + `sk.line(a.a, a.b)\nconst part = extrude(sk, 10)`, line: 5, contains: 'exactly on top of an existing line' },
  { id: 'misuse-nan', title: 'NaN as a dimension', script: HEAD + `sk.length(a, 40 / 0 - 40 / 0)\nconst part = extrude(sk, 10)`, line: 5, contains: 'finite number, but got NaN' },
];
