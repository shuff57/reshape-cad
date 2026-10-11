// Pattern audit on a box host: each case is a reSHape script plus the FreeCAD construction of the intended result
// (plate 40x20x10 centred at the origin; cuts/adds listed by geometry). A case passes when ours REFUSES in a sentence, or
// BUILDS with volume + bounding box equal to FreeCAD's. A wrong solid (built but different) fails the audit.
const H = `const plate = box(40, 20, 10);\nconst h = hole(plate, { across: 4, at: [-12, 0] });\n`;
const HAT = (x, y) => `const plate = box(40, 20, 10);\nconst h = hole(plate, { across: 4, at: [${x}, ${y}] });\n`;
const SKC = `const sk = sketch('top', 5); sk.circle(4, { at: [-12, 0] });\nconst p = pocket(sk, plate, 4);\n`;
const SKR = `const sk = sketch('top', 5); sk.rect(6, 6, { at: [-12, 0] });\nconst p = join(plate, pull(sk, 4));\n`;
const PL = `const plate = box(40, 20, 10);\n`;
const cyl = (xs, ys, r = 2) => xs.map((x, i) => ({ t: 'cyl', c: [x, ys[i]], r, z: [-5, 5] }));
// mirror() with no { at } is the documented whole-body mirror (a second copy of the part across its own face), not a cut
// pattern, so it is not audited here; mirror(cut, word, { at }) is.
export const CASES = [
  { id: 'hole-line-leaves-plate', src: H + `linearPattern(h, { count: 4, step: 12 });`, fc: cyl([-12, 0, 12, 24], [0, 0, 0, 0]) },
  { id: 'hole-overlap-step4', src: H + `linearPattern(h, { count: 3, step: 4 });`, fc: cyl([-12, -8, -4], [0, 0, 0]) },
  { id: 'hole-far-outside-step100', src: H + `linearPattern(h, { count: 2, step: 100 });`, fc: cyl([-12, 88], [0, 0]) },
  { id: 'hole-single-copy-step30-count3', src: PL + `const h = hole(plate, { across: 4 });\nlinearPattern(h, { count: 3, step: 30 });`, fc: cyl([0, 30, 60], [0, 0, 0]) },
  { id: 'hole-rim', src: HAT(-18, 0) + `linearPattern(h, { count: 2, step: 12 });`, fc: cyl([-18, -6], [0, 0]) },
  { id: 'hole-polar-leaves', src: HAT(15, 0) + `repeatAround(h, { count: 4, axis: 'z' });`, fc: cyl([15, 0, -15, 0], [0, 15, 0, -15]) },
  { id: 'hole-repeat-y-rim', src: HAT(0, 0) + `repeat(h, { count: 3, step: [0, 5, 0] });`, fc: cyl([0, 0, 0], [0, 5, 10]) },
  { id: 'hole-mirror-off-plate', src: H + `mirror(h, 'left-right', { at: 30 });`, fc: cyl([-12, 72], [0, 0]) },
  { id: 'hole-fits-count4-step8', src: H + `linearPattern(h, { count: 4, step: 8 });`, fc: cyl([-12, -4, 4, 12], [0, 0, 0, 0]) },
  { id: 'pocket-leaves-plate', src: PL + SKC + `linearPattern(p, { count: 4, step: 12 });`, fc: [-12, 0, 12, 24].map((x) => ({ t: 'cyl', c: [x, 0], r: 2, z: [1, 5] })) },
  { id: 'pocket-overlap', src: PL + SKC + `linearPattern(p, { count: 3, step: 4 });`, fc: [-12, -8, -4].map((x) => ({ t: 'cyl', c: [x, 0], r: 2, z: [1, 5] })) },
  { id: 'pocket-far-outside', src: PL + SKC + `linearPattern(p, { count: 2, step: 100 });`, fc: [-12, 88].map((x) => ({ t: 'cyl', c: [x, 0], r: 2, z: [1, 5] })) },
  { id: 'pocket-fits', src: PL + SKC + `linearPattern(p, { count: 3, step: 12 });`, fc: [-12, 0, 12].map((x) => ({ t: 'cyl', c: [x, 0], r: 2, z: [1, 5] })) },
  { id: 'pad-leaves-plate', src: PL + SKR + `linearPattern(p, { count: 4, step: 12 });`, fc: [-12, 0, 12, 24].map((x) => ({ t: 'add', lo: [x - 3, -3, 5], hi: [x + 3, 3, 9] })) },
  { id: 'pad-overlap', src: PL + SKR + `linearPattern(p, { count: 3, step: 4 });`, fc: [-12, -8, -4].map((x) => ({ t: 'add', lo: [x - 3, -3, 5], hi: [x + 3, 3, 9] })) },
  { id: 'pad-far-outside', src: PL + SKR + `linearPattern(p, { count: 2, step: 100 });`, fc: [-12, 88].map((x) => ({ t: 'add', lo: [x - 3, -3, 5], hi: [x + 3, 3, 9] })) },
  { id: 'pad-fits', src: PL + SKR + `linearPattern(p, { count: 3, step: 12 });`, fc: [-12, 0, 12].map((x) => ({ t: 'add', lo: [x - 3, -3, 5], hi: [x + 3, 3, 9] })) },
  { id: 'pocket-mirror-off', src: PL + SKC + `mirror(p, 'left-right', { at: 30 });`, fc: [-12, 72].map((x) => ({ t: 'cyl', c: [x, 0], r: 2, z: [1, 5] })) },
  { id: 'pocket-polar-leaves', src: PL + SKC + `repeatAround(p, { count: 4, axis: 'z' });`, fc: [[-12, 0], [0, -12], [12, 0], [0, 12]].map(([x, y]) => ({ t: 'cyl', c: [x, y], r: 2, z: [1, 5] })) },
];
