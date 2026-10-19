// SPIKE, referee only (contract / extrude-pocket group), ROUND 4. Appends to CASES (extrude-pocket-cases.mjs + -r2 + -r3). The critic's round-3 findings:
//   1. a taper on a sketch with holes / several shapes was REFUSED although the kernel builds it correctly (ring +5 and -5, two disjoint tapered rects)
//   2. timing of ordinary round tools was not bounded (12 round holes took 78 s)
//   3. a pad on a degenerate (flat) sketch had no row of its own
//   4. floors and steps of 1e-4 mm were refused with a sentence that said SolidCraft cannot keep them apart, which was not true for 1e-4
// Closed forms are written here with no kernel involved (Simpson over exact profile areas: area(d) is quadratic in d, so Simpson is exact).
import { H } from './extrude-pocket-cases.mjs';
import { CASES } from './extrude-pocket-cases.mjs';

const { R, Cc, P, offsetPoly, tapered, sub, PI, add_, PLATEBOX, PLATE, prism } = H;
const byId = (id) => { const c = CASES.find((x) => x.id === id); if (!c) throw new Error(`r4: no such case ${id}`); return c; };

export const F_TAPER_SOUP = 'pull/pocket option {taper} on a sketch with holes or several shapes (nested loops are holes, shapes side by side stay apart) -- built when no wall folds, no hole closes and no two shapes grow into each other';
export const F_TAPER_SOUP_X = 'pull/pocket option {taper} on a sketch with holes or several shapes that closes a hole, folds a wall or lets two shapes grow into each other -- refused';
export const F_COUNT = 'pull/pocket of many separate shapes in one sketch (twelve, twenty-four round holes): time and the limit of 24 shapes';
export const F_PADFLAT = 'pad = join(base, pull(sketch,h)) where the sketch is flat (collinear points, zero area, a circle of diameter 0): the kernel itself refuses in raw text, the contract in one plain sentence';
export const F_FLOOR = 'pocket floors and join steps from 1e-6 to 1e-2 mm (a pocket that stops a hair short of a face, a step a hair high): raw SolidCraft against the exact answer';

// ---- composite profiles (area, centroid, box) ---------------------------------------------------------------------------------------
const plus = (A, B) => { const a = A.area + B.area; return { area: a, cen: [(A.area * A.cen[0] + B.area * B.cen[0]) / a, (A.area * A.cen[1] + B.area * B.cen[1]) / a], bb: [Math.min(A.bb[0], B.bb[0]), Math.min(A.bb[1], B.bb[1]), Math.max(A.bb[2], B.bb[2]), Math.max(A.bb[3], B.bb[3])] }; };
const minus = (A, B) => { const a = A.area - B.area; return { area: a, cen: [(A.area * A.cen[0] - B.area * B.cen[0]) / a, (A.area * A.cen[1] - B.area * B.cen[1]) / a], bb: A.bb }; };
const SK = "const sk = sketch('top'); ";

// ---- 1. pt-ring, sp-soup-taper, spk-soup-taper are now builds ---------------------------------------------------------------------------
{
  const c = byId('pt-ring'); c.expect = 'build'; c.feature = F_TAPER_SOUP; c.note = `${c.note}; ROUND 4: the critic measured this as buildable (OCCT DraftAngle 14911.36 against truck 14911.62 for a different ring), the refusal was over-conservative`;
}
{
  const c = byId('sp-soup-taper'); c.expect = 'build'; c.feature = F_TAPER_SOUP; c.curved = true;
  c.analytic = () => tapered('top', 0, (d) => minus(R(-20 - d, -15 - d, 20 + d, 15 + d), Cc(0, 0, 10 - 2 * d)), 10, 5, 1);
  c.note = 'a 40 x 30 plate with a d10 hole, pulled 10 with taper 5: the plate grows by 0.875 per side, the hole shrinks by the same';
}
{
  const c = byId('spk-soup-taper'); c.expect = 'build'; c.feature = F_TAPER_SOUP; c.curved = true;
  c.analytic = () => sub(PLATEBOX, tapered('top', 10, (d) => plus(Cc(10, 15, 8 + 2 * d), Cc(30, 15, 8 + 2 * d)), 4, 5, -1));
  c.note = 'two d8 round pockets with taper 5, 4 deep: each cone widens by 4 * tan(5) = 0.35 per side at the bottom';
}

// ---- 2. new tapered soups that build -------------------------------------------------------------------------------------------------
const tsoup = ({ id, plane = 'top', off = 0, body, profAt, h, deg, o = {}, curved, note, sgn, x }) => add_({
  id, feature: x ? F_TAPER_SOUP_X : F_TAPER_SOUP, curved, note, expect: x ? 'refuse' : 'build',
  script: `const sk = sketch('${plane}'${off ? `, ${off}` : ''}); ${body} pull(sk, ${h}, { taper: ${deg}${Object.entries(o).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')} });`,
  analytic: x ? undefined : () => tapered(plane, off, profAt, Math.abs(h), deg, sgn ?? (h < 0 ? -1 : 1) * (o.reversed ? -1 : 1)),
});
const RING = (d) => minus(Cc(0, 0, 40 + 2 * d), Cc(0, 0, 20 - 2 * d));
tsoup({ id: 'ts-ring-neg', body: 'sk.circle(40); sk.circle(20);', profAt: RING, h: 10, deg: -5, curved: true, note: 'ring, taper -5: the outer wall shrinks, the hole grows (every wall leans the same way)' });
tsoup({ id: 'ts-rect-hole-neg', body: 'sk.rect(40, 30); sk.circle(10);', profAt: (d) => minus(R(-20 - d, -15 - d, 20 + d, 15 + d), Cc(0, 0, 10 - 2 * d)), h: 10, deg: -8, curved: true });
tsoup({ id: 'ts-two-rects', body: 'sk.rect(10, 10, { at: [-15, 0] }); sk.rect(10, 10, { at: [15, 0] });', profAt: (d) => plus(R(-20 - d, -5 - d, -10 + d, 5 + d), R(10 - d, -5 - d, 20 + d, 5 + d)), h: 10, deg: 10, note: 'two separate pieces, each tapered; 20 mm apart, they grow 1.76 mm each' });
tsoup({ id: 'ts-two-circles-neg', body: 'sk.circle(16, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] });', profAt: (d) => plus(Cc(-20, 0, 16 + 2 * d), Cc(20, 0, 16 + 2 * d)), h: 10, deg: -10, curved: true });
tsoup({ id: 'ts-nested-three', body: 'sk.rect(60, 60); sk.rect(40, 40); sk.rect(20, 20);', profAt: (d) => plus(minus(R(-30 - d, -30 - d, 30 + d, 30 + d), R(-20 + d, -20 + d, 20 - d, 20 - d)), R(-10 - d, -10 - d, 10 + d, 10 + d)), h: 10, deg: 3, note: 'a frame and a block standing in its hole: the 10 mm gap between them closes by 2 * 0.52 = 1.05' });
{
  const tri = [[-20, -20], [20, -20], [0, 20]]; const sq = [[-2, -10], [2, -10], [2, -6], [-2, -6]];
  tsoup({ id: 'ts-poly-hole', body: 'sk.polygon([[-20, -20], [20, -20], [0, 20]]); sk.rect(4, 4, { at: [0, -8] });', profAt: (d) => minus(P(offsetPoly(tri, d)), P(offsetPoly(sq, -d))), h: 8, deg: 4, note: 'a triangle with a square hole, polygons with mitre corners' });
}
tsoup({ id: 'ts-front-ring', plane: 'front', off: 4, body: 'sk.circle(40); sk.circle(20);', profAt: RING, h: 10, deg: 5, curved: true, note: 'front plane at offset 4: the sweep goes -Y' });
tsoup({ id: 'ts-ring-negheight', body: 'sk.circle(40); sk.circle(20);', profAt: RING, h: -10, deg: 5, curved: true, note: 'negative height pulls the other way' });
tsoup({ id: 'ts-ring-reversed', body: 'sk.circle(40); sk.circle(20);', profAt: RING, h: 10, deg: 5, o: { reversed: true }, curved: true });
tsoup({ id: 'ts-gap-ok', body: 'sk.rect(10, 10, { at: [-6.8, 0] }); sk.rect(10, 10, { at: [6.8, 0] });', profAt: (d) => plus(R(-11.8 - d, -5 - d, -1.8 + d, 5 + d), R(1.8 - d, -5 - d, 11.8 + d, 5 + d)), h: 10, deg: 10, note: 'a 3.6 mm gap, the walls close 2 * 1.763 = 3.527 of it: 0.073 mm is left, the pieces stay apart' });
// pockets
add_({ id: 'tsk-ring', feature: F_TAPER_SOUP, curved: true, expect: 'build', note: 'a ring-shaped taper cut leaves a round island standing: the cut widens with depth',
  script: `${PLATE} const sk = sketch('top', 10); sk.circle(20, { at: [20, 15] }); sk.circle(8, { at: [20, 15] }); pocket(sk, plate, 4, { taper: 3 });`,
  analytic: () => sub(PLATEBOX, tapered('top', 10, (d) => minus(Cc(20, 15, 20 + 2 * d), Cc(20, 15, 8 - 2 * d)), 4, 3, -1)) });
add_({ id: 'tsk-two-holes-neg', feature: F_TAPER_SOUP, curved: true, expect: 'build', note: 'two round pockets with a negative taper: each narrows with depth',
  script: `${PLATE} const sk = sketch('top', 10); sk.circle(8, { at: [10, 15] }); sk.circle(8, { at: [30, 15] }); pocket(sk, plate, 4, { taper: -5 });`,
  analytic: () => sub(PLATEBOX, tapered('top', 10, (d) => plus(Cc(10, 15, 8 + 2 * d), Cc(30, 15, 8 + 2 * d)), 4, -5, -1)) });
add_({ id: 'tsk-rect-hole-rects', feature: F_TAPER_SOUP, expect: 'build', note: 'two rectangular pockets tapered +6, 5 deep',
  script: `${PLATE} const sk = sketch('top', 10); sk.rect(8, 6, { at: [10, 15] }); sk.rect(8, 6, { at: [30, 15] }); pocket(sk, plate, 5, { taper: 6 });`,
  analytic: () => sub(PLATEBOX, tapered('top', 10, (d) => plus(R(6 - d, 12 - d, 14 + d, 18 + d), R(26 - d, 12 - d, 34 + d, 18 + d)), 5, 6, -1)) });
// refusals: a wall folds, a hole closes, shapes run into each other, a hole grows out through the wall
tsoup({ id: 'tx-two-overlap', body: 'sk.rect(10, 10, { at: [-6, 0] }); sk.rect(10, 10, { at: [6, 0] });', h: 10, deg: 20, x: true, note: 'a 2 mm gap, the walls close 2 * 3.64: the two tapered bodies would overlap (truck leaves two overlapping bodies)' });
tsoup({ id: 'tx-gap-just-collide', body: 'sk.rect(10, 10, { at: [-6.75, 0] }); sk.rect(10, 10, { at: [6.75, 0] });', h: 10, deg: 10, x: true, note: 'a 3.5 mm gap against 3.527 mm of wall travel: they meet 0.027 mm before the end' });
tsoup({ id: 'tx-hole-closes', body: 'sk.rect(40, 30); sk.circle(6);', h: 10, deg: 30, x: true, curved: true, note: 'a d6 hole shrinking 5.77 per side closes before the end' });
tsoup({ id: 'tx-ring-neg-cross', body: 'sk.circle(12); sk.circle(4);', h: 10, deg: -30, x: true, curved: true, note: 'taper -30: the outer circle shrinks to r0.23 while the hole grows to r7.77 and runs out through the wall' });
tsoup({ id: 'tx-island-grows-into-wall', body: 'sk.rect(60, 60); sk.rect(24, 24); sk.rect(20, 20);', h: 10, deg: 10, x: true, note: 'a block standing 2 mm inside a hole: the hole shrinks 1.76 and the block grows 1.76' });
tsoup({ id: 'tx-fold-outer', body: 'sk.rect(20, 12); sk.rect(4, 4);', h: 10, deg: -45, x: true, note: 'the outer rectangle (12 wide) shrinks 10 per side: folds' });
// the interpreter-level combinations stay refused (one sentence each)
add_({ id: 'tc-soup-taper-midplane', feature: 'pull/pocket option {taper} together with midplane', expect: 'refuse', script: `${SK}sk.rect(40, 30); sk.circle(10); pull(sk, 10, { taper: 5, midplane: true });`, note: 'taper + midplane on a sketch with a hole' });

// ---- 3. many shapes in one sketch -----------------------------------------------------------------------------------------------------
const GRID = (n, cols, d, w, h) => { let s = ''; for (let i = 0; i < n; i++) s += `sk.circle(${d}, { at: [${5 + 10 * (i % cols)}, ${5 + 10 * Math.floor(i / cols)}] }); `; return s; };
const BIGPLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[100,0],[100,100],[0,100]]); const plate = pull(s1, 10);";
for (const n of [2, 4, 8, 12, 24]) {
  add_({ id: `ct-holes-${n}`, feature: F_COUNT, curved: true, expect: 'build', note: `${n} d4 round pockets in one sketch, 4 deep, in a 100 x 100 x 10 plate`,
    script: `${BIGPLATE} const sk = sketch('top', 10); ${GRID(n, 9, 4)} pocket(sk, plate, 4);`, analytic: () => ({ volume: 100000 - n * PI * 4 * 4 }), noShipped: n > 12 });
}
for (const n of [25, 48]) {
  add_({ id: `ct-holes-${n}`, feature: F_COUNT, curved: true, expect: 'refuse', note: `${n} d4 round pockets in one sketch: over the limit of 24 shapes`, noShipped: true,
    script: `${BIGPLATE} const sk = sketch('top', 10); ${GRID(n, 9, 4)} pocket(sk, plate, 4);` });
}
add_({ id: 'ct-pull-24-discs', feature: F_COUNT, curved: true, expect: 'build', note: '24 separate d4 discs pulled 5 (24 pieces)', noShipped: true,
  script: `const sk = sketch('top'); ${GRID(24, 9, 4)} pull(sk, 5);`, analytic: () => ({ volume: 24 * PI * 4 * 5 }) });

// ---- 4. a pad on a flat sketch ----------------------------------------------------------------------------------------------------------
const PADFLAT = (id, draw, note, o = {}) => add_({ id, feature: F_PADFLAT, expect: 'refuse', note, script: `${PLATE} const s2 = sketch('top', 10); ${draw} const pad = join(plate, pull(s2, 5${o.opt ?? ''}));` });
PADFLAT('pf-collinear-3', 's2.polygon([[0,0],[5,0],[10,0]]);', 'three points on one line');
PADFLAT('pf-collinear-4', 's2.polygon([[2,2],[8,2],[14,2],[6,2]]);', 'four points on one line');
PADFLAT('pf-zero-height-rect', 's2.rect(0, 10, { at: [20, 15] });', 'a rectangle 0 mm wide');
PADFLAT('pf-circle-zero', 's2.circle(0, { at: [20, 15] });', 'a circle of diameter 0');
PADFLAT('pf-collinear-taper', 's2.polygon([[0,0],[5,0],[10,0]]);', 'flat outline with a taper', { opt: ', { taper: 5 }' });

// ---- 5. floors and steps: pocket depth 10 - g in a 10 mm plate; a boss whose side sticks out of the plate edge by g -------------------------
// expect: the contract refuses a floor or step of 1e-4 mm or less (NEAR_FLUSH); the controls above that build. (The raw table is in extrude-pocket-floor-sweep.txt.)
for (const g of [1e-6, 1e-5, 3e-5, 1e-4, 2e-4, 5e-4, 1e-3, 1e-2, 0.1]) {
  const refuse = g <= 1e-4;
  add_({ id: `fl-floor-${g}`, feature: F_FLOOR, expect: refuse ? 'refuse' : 'build', note: `blind pocket 20 x 10 stopping ${g} mm short of the bottom face of a 10 mm plate`,
    script: `${PLATE} const sk = sketch('top', 10); sk.rect(20, 10, { at: [20, 15] }); pocket(sk, plate, ${+(10 - g).toFixed(7)});`,
    analytic: refuse ? undefined : () => ({ volume: 12000 - 200 * (10 - g) }) });
}
// join steps: truck's join DROPS a step thinner than about 4e-4 of the part's size (0.03-0.05 mm on this plate); the guard refuses up to 2.5e-5 of the diagonal
// outright and the join-consistency check sees the rest, so every gap below 0.05 mm is refused here and 0.1 mm builds (measured, extrude-pocket-floor-sweep.txt)
for (const g of [1e-6, 1e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 1e-2, 0.1]) {
  const refuse = g < 0.05;
  add_({ id: `fl-step-${g}`, feature: F_FLOOR, expect: refuse ? 'refuse' : 'build', note: `a boss pulled 10 down from the top face whose side is ${g} mm outside the plate edge`,
    script: `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [${35 + g}, 15] }); const pad = join(plate, pull(s2, -10));`,
    analytic: refuse ? undefined : () => ({ volume: 12000 + g * 100 }) });
}
// the same on a part ten times larger: the steps that get dropped scale with the part
const BIG10 = "const s1 = sketch('top'); s1.polygon([[0,0],[400,0],[400,300],[0,300]]); const plate = pull(s1, 100);";
for (const g of [0.001, 0.01, 0.1, 1]) {
  const refuse = g < 0.5;
  add_({ id: `fl-step10-${g}`, feature: F_FLOOR, expect: refuse ? 'refuse' : 'build', note: `the same boss on a 400 x 300 x 100 plate, ${g} mm outside the edge`,
    script: `${BIG10} const s2 = sketch('top', 100); s2.rect(100, 100, { at: [${350 + g}, 150] }); const pad = join(plate, pull(s2, -100));`,
    analytic: refuse ? undefined : () => ({ volume: 12000000 + g * 10000 }) });
}
void prism; void byId;
