// SPIKE, referee only (contract / extrude-pocket group), ROUND 3. Appends to CASES (extrude-pocket-cases.mjs + -r2). The critic's round-2 gaps:
//   1. a pad whose join step only TOUCHES the base along a line or at a point (inconsistent: built with 2 shells / refused with raw kernel text)
//   2. 'no usable outline' sentence names an internal function; a polygon with a repeated vertex is refused though it is a valid outline
//   3. brep-rs is not an oracle for through + midplane (it is wrong in more cases than tm-mid-front)
//   4. a slanted ROUND tool that crosses an existing hole / pocket passes a bounding-box guard and takes minutes
//   5. a sketch drawn as rows whose end points coincide but have no coincident rule
//   6. a slanted round pull is built by solid.loft: its side is a spline, not a cylinder
// Closed forms are written here with no kernel involved; where none is given the reference is live OCCT.
import { H } from './extrude-pocket-cases.mjs';
import { CASES } from './extrude-pocket-cases.mjs';

const { R, Cc, P, prism, box, sub, uni, sheared, PI, add_, mul } = H;
void P; void mul;

// ---- 1. join (pad) contact ---------------------------------------------------------------------------------------------------------
const F_JOINTOUCH = 'pad = join(base, pull) where the pad only TOUCHES the base along a line or at a point (edge or corner contact) -- refused';
const F_JOINFACE = 'pad = join(base, pull) that shares a face, overlaps or leaves a gap -- the controls next to the edge/point contact refusals';
const BASE = "const sA = sketch('top'); sA.rect(60, 60, { at: [30, 30] }); const base = pull(sA, 20);";
const BASEBOX = box(0, 0, 0, 60, 60, 20);
const jc = (id, feature, expect, padDraw, note, an, o = {}) => add_({ id, feature, expect, note, curved: !!o.curved, analytic: an, script: `${BASE} ${padDraw} const pad = join(base, pull(sB, ${o.h ?? 10}${o.opt ?? ''}));` });
// edge contact: the pad's bottom edge lies on the base's top edge
jc('jc-x-edge-top', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 20); sB.rect(10, 40, { at: [65, 30] });", 'pad x 60..70 on the plane z=20: touches the base along the line x=60, z=20, y 10..50 (the critic\'s refused-with-raw-text orientation)');
jc('jc-y-edge-top', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 20); sB.rect(40, 10, { at: [30, 65] });", 'the same along the other axis: line y=60, z=20, x 10..50');
jc('jc-z-edge', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 0); sB.rect(10, 10, { at: [65, 65] });", 'pad beside the base, corner to corner: touches along the vertical line (60,60), z 0..20', undefined, { h: 20 });
jc('jc-corner-point', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 20); sB.rect(10, 10, { at: [65, 65] });", 'pad on the top plane z=20 beside the base: touches at the single point (60,60,20)');
jc('jc-x-edge-below', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 0); sB.rect(10, 40, { at: [65, 30] });", 'pad hanging below z=0 and beside the base: line x=60, z=0, y 10..50', undefined, { h: -10 });
jc('jc-corner-point-below', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 0); sB.rect(10, 10, { at: [-5, -5] });", 'pad below the base corner (0,0,0): point contact', undefined, { h: -10 });
jc('jc-edge-tilted', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 20); sB.rect(10, 40, { at: [65, 30] });", 'pad pulled with a taper of 10 degrees, still only meeting the base along the top edge', undefined, { h: 10, opt: ', { taper: 10 }' });
// two plain pulls joined (no base box): z-line contact between two squares standing corner to corner
add_({ id: 'jc-pull-pull-corner', feature: F_JOINTOUCH, expect: 'refuse', note: 'join(pull, pull): two squares standing corner to corner share the vertical line x=20, y=20',
  script: "const s1 = sketch('top'); s1.rect(20, 20, { at: [10, 10] }); const a = pull(s1, 10); const s2 = sketch('top'); s2.rect(20, 20, { at: [30, 30] }); const b = pull(s2, 10); const pad = join(a, b);" });
// a cylinder lying on the plate: tangent line contact
add_({ id: 'jc-tangent-cylinder', feature: F_JOINTOUCH, expect: 'refuse', curved: true, note: 'a cylinder of d10 along Y whose lowest line rests on the top face of a 60 x 60 x 10 plate: tangent line contact',
  script: "const s1 = sketch('top'); s1.rect(60, 60, { at: [30, 30] }); const plate = pull(s1, 10); const s2 = sketch('front', 50); s2.circle(10, { at: [30, 15] }); const rod = pull(s2, 40); const pad = join(plate, rod);" });
// controls: face contact, overlap, gap
const FACE = (id, padDraw, an, o = {}) => jc(id, F_JOINFACE, 'build', padDraw, o.note ?? '', an, o);
FACE('jcc-face-side', "const sB = sketch('top', 0); sB.rect(10, 40, { at: [65, 30] });", () => uni(BASEBOX, box(60, 10, 0, 70, 50, 20)), { h: 20, note: 'control: pad shares part of the face x=60' });
FACE('jcc-face-top', "const sB = sketch('top', 20); sB.rect(10, 10, { at: [30, 30] });", () => uni(BASEBOX, box(25, 25, 20, 35, 35, 30)), { note: 'control: pad stands on the top face' });
FACE('jcc-face-top-flush-edge', "const sB = sketch('top', 20); sB.rect(10, 10, { at: [5, 5] });", () => uni(BASEBOX, box(0, 0, 20, 10, 10, 30)), { note: 'control: pad on the top face with two sides flush with the base edges' });
FACE('jcc-face-overhang', "const sB = sketch('top', 20); sB.rect(20, 20, { at: [60, 30] });", () => uni(BASEBOX, box(50, 20, 20, 70, 40, 30)), { note: 'control: pad half over the edge, half on the top face' });
FACE('jcc-overlap-corner', "const sB = sketch('top', 10); sB.rect(20, 20, { at: [60, 60] });", () => ({ volume: 72000 + 4000 - 1000 }), { note: 'control: pad overlapping the base corner by a volume' });
FACE('jcc-gap-line', "const sB = sketch('top', 20); sB.rect(10, 40, { at: [66, 30] });", () => uni(BASEBOX, box(61, 10, 20, 71, 50, 30)), { note: 'control: a 1 mm gap, two separate pieces (a disjoint join is allowed)' });
FACE('jcc-gap-corner', "const sB = sketch('top', 21); sB.rect(10, 10, { at: [66, 66] });", () => uni(BASEBOX, box(61, 61, 21, 71, 71, 31)), { note: 'control: a 1 mm gap in every direction, two separate pieces' });
add_({ id: 'jcc-pull-pull-face', feature: F_JOINFACE, note: 'control: join(pull, pull) sharing a face',
  script: "const s1 = sketch('top'); s1.rect(20, 20, { at: [10, 10] }); const a = pull(s1, 10); const s2 = sketch('top'); s2.rect(20, 20, { at: [30, 10] }); const b = pull(s2, 10); const pad = join(a, b);",
  analytic: () => box(0, 0, 0, 40, 20, 10) });
add_({ id: 'jcc-cyl-sunk', feature: F_JOINFACE, curved: true, note: 'control: the same rod sunk 1 mm into the plate',
  script: "const s1 = sketch('top'); s1.rect(60, 60, { at: [30, 30] }); const plate = pull(s1, 10); const s2 = sketch('front', 50); s2.circle(10, { at: [30, 14] }); const rod = pull(s2, 40); const pad = join(plate, rod);" });

// gaps just above and just below the touching tolerance (1e-6 mm), and parts that are not blocks
jc('jcc-gap-edge-1e-3', F_JOINFACE, 'build', "const sB = sketch('top', 20); sB.rect(10, 40, { at: [65.001, 30] });", 'control: a 0.001 mm gap along the edge: apart, two pieces', () => uni(BASEBOX, box(60.001, 10, 20, 70.001, 50, 30)));
jc('jc-gap-edge-1e-7', F_JOINTOUCH, 'refuse', "const sB = sketch('top', 20); sB.rect(10, 40, { at: [65.0000001, 30] });", 'a 1e-7 mm gap along the edge is touching for truck: refused like the exact contact');
const PL60J = "const s1 = sketch('top'); s1.rect(60, 60, { at: [30, 30] }); const plate = pull(s1, 10);";
add_({ id: 'jcc-pin-in-bore', feature: F_JOINFACE, curved: true, note: 'control, parts that are not blocks and whose boxes overlap: a d8 pin standing in a d10 bore of the plate (1 mm clearance all round) is two separate pieces',
  script: `${PL60J} const sh = sketch('top', 10); sh.circle(10, { at: [30, 30] }); const hole = pocket(sh, plate, 10, { through: true }); const sp = sketch('top'); sp.circle(8, { at: [30, 30] }); const pin = join(hole, pull(sp, 10));`,
  analytic: () => ({ volume: 36000 - PI * 25 * 10 + PI * 16 * 10 }) });
add_({ id: 'jc-tangent-rods', feature: F_JOINTOUCH, expect: 'refuse', curved: true, note: 'two d10 rods lying side by side, touching along a line (tangent)',
  script: "const s1 = sketch('front', 50); s1.circle(10, { at: [10, 5] }); const a = pull(s1, 40); const s2 = sketch('front', 50); s2.circle(10, { at: [20, 5] }); const b = pull(s2, 40); const pad = join(a, b);" });
add_({ id: 'jcc-rods-boxes-touch-apart', feature: F_JOINFACE, expect: 'refuse', curved: true, note: 'OVER-REFUSAL BY DESIGN: two rods whose bounding boxes share the plane x=15 but whose surfaces are 4.5 mm apart (centres 10 and 7 mm apart in x and z, radius 5): the boxes touch, the rods do not, no shell merges; the conservative rule cannot see the difference and refuses',
  script: "const s1 = sketch('front', 50); s1.circle(10, { at: [10, 5] }); const a = pull(s1, 40); const s2 = sketch('front', 50); s2.circle(10, { at: [20, 12] }); const b = pull(s2, 40); const pad = join(a, b);" });
add_({ id: 'jc-L-edge-touch', feature: F_JOINTOUCH, expect: 'refuse', note: 'an L-shaped base (not a block) and a block that touches only its top edge: the base is not a block, the rule is the conservative one',
  script: "const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[20,20],[20,60],[0,60]]); const base = pull(s1, 20); const s2 = sketch('top', 20); s2.rect(10, 20, { at: [65, 10] }); const pad = join(base, pull(s2, 10));" });
add_({ id: 'jcc-L-face-pad', feature: F_JOINFACE, note: 'control: the same L-shaped base with the pad standing on its top face',
  script: "const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[20,20],[20,60],[0,60]]); const base = pull(s1, 20); const s2 = sketch('top', 20); s2.rect(10, 10, { at: [30, 10] }); const pad = join(base, pull(s2, 10));",
  analytic: () => ({ volume: (60 * 20 + 20 * 40) * 20 + 100 * 10 }) });

// ---- 2. outlines ------------------------------------------------------------------------------------------------------------------
const F_OUTLINE = 'pull/pocket outlines that repeat a point or have no area';
const od = (id, expect, draw, note, an, o = {}) => add_({ id, feature: F_OUTLINE, expect, note, curved: !!o.curved, analytic: an, script: `const sk = sketch('top'); ${draw} const part = pull(sk, 10);` });
od('od-rect-zero-w', 'refuse', 'sk.rect(0, 10);', 'rect(0,10): a side of 0 mm (the critic\'s case)');
od('od-rect-zero-h', 'refuse', 'sk.rect(10, 0);', 'rect(10,0)');
od('od-polygon-collinear', 'refuse', 'sk.polygon([[0,0],[5,0],[10,0]]);', 'three points on one line');
od('od-polygon-collinear-4', 'refuse', 'sk.polygon([[0,0],[5,0],[10,0],[3,0]]);', 'four points on one line');
od('od-polygon-dup-mid', 'build', 'sk.polygon([[0,0],[10,0],[10,0],[10,10],[0,10]]);', 'the same point twice in a row (the critic\'s case): a plain 10 x 10 square', () => prism('top', 0, R(0, 0, 10, 10), 0, 10));
od('od-polygon-dup-last', 'build', 'sk.polygon([[0,0],[10,0],[10,10],[0,10],[0,10]]);', 'the last point repeated', () => prism('top', 0, R(0, 0, 10, 10), 0, 10));
od('od-polygon-closed-explicit', 'build', 'sk.polygon([[0,0],[10,0],[10,10],[0,10],[0,0]]);', 'the first point repeated at the end (a closed list)', () => prism('top', 0, R(0, 0, 10, 10), 0, 10));
od('od-polygon-dup-triple', 'build', 'sk.polygon([[0,0],[10,0],[10,0],[10,0],[10,10],[0,10]]);', 'the same point three times in a row', () => prism('top', 0, R(0, 0, 10, 10), 0, 10));
od('od-polygon-dup-L', 'build', 'sk.polygon([[0,0],[30,0],[30,10],[30,10],[10,10],[10,25],[0,25]]);', 'a repeated point on a concave L', () => ({ volume: (30 * 10 + 10 * 15) * 10 }));
od('od-polygon-dup-two-places', 'build', 'sk.polygon([[0,0],[0,0],[10,0],[10,10],[10,10],[0,10]]);', 'two different repeated points', () => prism('top', 0, R(0, 0, 10, 10), 0, 10));
add_({ id: 'od-pocket-dup', feature: F_OUTLINE, note: 'a pocket outline with a repeated point',
  script: "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 10); const sk = sketch('top', 10); sk.polygon([[10,10],[20,10],[20,10],[20,20],[10,20]]); const cut = pocket(sk, plate, 4);",
  analytic: () => sub(box(0, 0, 0, 40, 30, 10), box(10, 10, 6, 20, 20, 10)) });
od('od-polygon-dup-round', 'build', "sk.polygon([[0,0],[40,0],[40,25],[40,25],[0,25]]); sk.round(2, 5);", 'a repeated point on a polygon whose corner 2 is rounded with r5 (corner removed: r^2 (1 - pi/4) = 5.365 mm2)', () => ({ volume: (1000 - 25 * (1 - PI / 4)) * 10 }), { curved: true });
od('od-circle-zero', 'refuse', 'sk.circle(0);', 'circle of diameter 0');

// ---- 5. rows only, coincident end points without a coincident rule ----------------------------------------------------------------
const F_ROWS = 'sketch drawn as rows (lines) whose end points coincide exactly but with no coincident rule between them, pulled';
const sq = (gap) => `sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [30, 0] }, { k: 'line', id: 2, a: [30, 0], b: [30, 20] }, { k: 'line', id: 3, a: [30, 20], b: [0, 20] }, { k: 'line', id: 4, a: [0, ${20 - gap}], b: [0, 0] }]);`;
add_({ id: 'ro-no-rules-exact', feature: F_ROWS, note: 'four lines, end points exactly equal, no rules at all', script: `const sk = sketch('top'); ${sq(0)} const part = pull(sk, 10);`, analytic: () => prism('top', 0, R(0, 0, 30, 20), 0, 10) });
add_({ id: 'ro-no-rules-gap-1e-4', feature: F_ROWS, expect: 'refuse', note: 'the same with a 0.0001 mm gap at one corner: must be refused', script: `const sk = sketch('top'); ${sq(1e-4)} const part = pull(sk, 10);` });
add_({ id: 'ro-no-rules-gap-1e-6', feature: F_ROWS, expect: 'refuse', note: 'a 1e-6 gap: truck wants the loop closed exactly ("profile loop is not closed"), brep-rs refuses too', script: `const sk = sketch('top'); ${sq(1e-6)} const part = pull(sk, 10);` });
add_({ id: 'ro-with-rules', feature: F_ROWS, note: 'control: the same four lines WITH four coincident rules', script: `const sk = sketch('top'); ${sq(0)} sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]); const part = pull(sk, 10);`, analytic: () => prism('top', 0, R(0, 0, 30, 20), 0, 10) });
add_({ id: 'ro-no-rules-pocket', feature: F_ROWS, note: 'a pocket from rows with no rules', script: `const s1 = sketch('top'); s1.rect(60, 40, { at: [30, 20] }); const plate = pull(s1, 10); const sk = sketch('top', 10); ${sq(0)} const cut = pocket(sk, plate, 4);`, analytic: () => sub(box(0, 0, 0, 60, 40, 10), box(0, 0, 6, 30, 20, 10)) });

// ---- 4. slanted round tool crossing an existing hole / pocket ---------------------------------------------------------------------
const F_SLANTX = 'pocket options: direction with a ROUND shape into a part that already has a hole, a pocket or a step (a slanted bore that crosses or runs beside them) -- refused';
const PL60 = "const s1 = sketch('top'); s1.rect(60, 60, { at: [30, 30] }); const plate = pull(s1, 10);";
const HOLE20 = "const sh = sketch('top', 10); sh.circle(20, { at: [30, 30] }); const hole = pocket(sh, plate, 10, { through: true });";
const POCK = "const sp = sketch('top', 10); sp.rect(20, 20, { at: [35, 30] }); const pk = pocket(sp, plate, 6);";
add_({ id: 'sx-hole-cross', feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: 'plate 60 x 60 x 10 with a d20 through hole; a d6 slanted bore (1,0,-1) from (16,30) 8 deep runs into the hole wall (the critic\'s 188 s case)',
  script: `${PL60} ${HOLE20} const sk = sketch('top', 10); sk.circle(6, { at: [16, 30] }); const cut = pocket(sk, hole, 8, { direction: [1, 0, -1] });` });
add_({ id: 'sx-pocket-cross', feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: 'plate with a 20 x 20 x 6 pocket; a d6 slanted bore runs into the pocket wall (the critic\'s 48 s case)',
  script: `${PL60} ${POCK} const sk = sketch('top', 10); sk.circle(6, { at: [16, 30] }); const cut = pocket(sk, pk, 8, { direction: [1, 0, -1] });` });
add_({ id: 'sx-hole-clear', feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: 'a slanted bore that stays clear of the hole (ends 3 mm before its wall): still refused, the part is no longer a plain block',
  script: `${PL60} ${HOLE20} const sk = sketch('top', 10); sk.circle(6, { at: [6, 30] }); const cut = pocket(sk, hole, 4, { direction: [1, 0, -1] });` });
// more crossings of the same two kinds, to find the slow ones the critic measured (188 s / 48 s); all must be refused, none is run unguarded except by extrude-pocket-slant-timing.mjs
for (const [id, x, depth] of [['sx-hole-cross-a', 14, 5], ['sx-hole-cross-b', 10, 10], ['sx-hole-cross-c', 12, 6], ['sx-hole-cross-d', 17, 4], ['sx-hole-cross-e', 8, 9]]) {
  add_({ id, feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: `d6 slanted bore (1,0,-1) from x=${x}, ${depth} deep, into the plate with the d20 through hole (hole wall at x=20)`,
    script: `${PL60} ${HOLE20} const sk = sketch('top', 10); sk.circle(6, { at: [${x}, 30] }); const cut = pocket(sk, hole, ${depth}, { direction: [1, 0, -1] });` });
}
for (const [id, x, depth] of [['sx-pocket-cross-a', 14, 8], ['sx-pocket-cross-b', 20, 6], ['sx-pocket-cross-c', 18, 5]]) {
  add_({ id, feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: `d6 slanted bore from x=${x}, ${depth} deep, into the plate with a 20 x 20 x 6 pocket (x 25..45, y 20..40)`,
    script: `${PL60} ${POCK} const sk = sketch('top', 10); sk.circle(6, { at: [${x}, 30] }); const cut = pocket(sk, pk, ${depth}, { direction: [1, 0, -1] });` });
}
add_({ id: 'sx-plain-block', feature: F_SLANTX, curved: true, note: 'control: the same d6 slanted bore into a plain 60 x 60 x 10 block builds',
  script: `${PL60} const sk = sketch('top', 10); sk.circle(6, { at: [16, 30] }); const cut = pocket(sk, plate, 5, { direction: [1, 0, -1] });`,
  analytic: () => sub(box(0, 0, 0, 60, 60, 10), sheared('top', 10, Cc(16, 30, 6), [0, 0, 0], [5, 0, -5])) });
add_({ id: 'sx-pad-then-slant', feature: F_SLANTX, expect: 'refuse', curved: true, noShipped: true, note: 'a part that is a plate with a pad on it (an L section): not a plain block, the slanted round bore is refused',
  script: `${PL60} const s2 = sketch('top', 10); s2.rect(20, 60, { at: [10, 30] }); const stepp = join(plate, pull(s2, 6)); const sk = sketch('top', 10); sk.circle(6, { at: [40, 30] }); const cut = pocket(sk, stepp, 5, { direction: [1, 0, -1] });` });
add_({ id: 'sx-straight-cross', feature: F_SLANTX, curved: true, note: 'control: a STRAIGHT round bore crossing the same hole\'s wall is fast and exact (straight tools have no such risk)',
  script: `${PL60} ${HOLE20} const sk = sketch('top', 10); sk.circle(6, { at: [22, 30] }); const cut = pocket(sk, hole, 8);` });

add_({ id: 'sx-straight-after-slant', feature: F_SLANTX, curved: true, note: 'control: a slanted d6 bore into the plain block, THEN a straight d6 bore that crosses it: the straight tool has no such risk',
  script: `${PL60} const sk = sketch('top', 10); sk.circle(6, { at: [16, 30] }); const cut = pocket(sk, plate, 5, { direction: [1, 0, -1] }); const sk2 = sketch('top', 10); sk2.circle(6, { at: [22, 30] }); const cut2 = pocket(sk2, cut, 8);` });

// ---- 6. slanted round pull is built by loft ----------------------------------------------------------------------------------------
const F_LOFTFACE = 'a slanted round pull (pull of a circle or a rounded outline with { direction }): built by solid.loft, so its side is a spline surface, not a cylinder; accuracy and what can be done to it afterwards';
add_({ id: 'lf-slant-circle-pull', feature: F_LOFTFACE, curved: true, note: 'd10 circle pulled 10 along (1,0,1)',
  script: "const sk = sketch('top'); sk.circle(10, { at: [0, 0] }); const part = pull(sk, 10, { direction: [1, 0, 1] });",
  analytic: () => ({ volume: PI * 25 * 10, bbox: [-5, -5, 0, 15, 5, 10], com: [5, 0, 5] }) });
add_({ id: 'lf-straight-circle-pull', feature: F_LOFTFACE, curved: true, note: 'control: the same circle pulled straight is an extrusion with a true cylinder face',
  script: "const sk = sketch('top'); sk.circle(10, { at: [0, 0] }); const part = pull(sk, 10);",
  analytic: () => ({ volume: PI * 25 * 10, bbox: [-5, -5, 0, 5, 5, 10], com: [0, 0, 5] }) });
add_({ id: 'lf-slant-hole', feature: F_LOFTFACE, expect: 'refuse', curved: true, note: 'a straight hole bored into a slanted round pull',
  script: "const sk = sketch('top'); sk.circle(16, { at: [0, 0] }); const part = pull(sk, 10, { direction: [1, 0, 1] }); const sh = sketch('top', 10); sh.circle(4, { at: [10, 0] }); const bore = pocket(sh, part, 6);" });

// closed form with no kernel: oblique cylinder r8 (centre x = z, z 0..10) minus a straight bore r2 at x=8 (hole() centres on the target's box centre x=5, +3):
// removal = integral over z of the lens area of the discs (8,0;r2) and (z,0;r8). Computed here with 200000 midpoint steps. (The live-OCCT reference in this harness is the
// STRAIGHT cylinder with the hole, because occt-build ignores `direction`: it is not an oracle for this case, hence no OCCT comparison is made.)
const lens = (r1, r2, d) => {
  if (d >= r1 + r2) return 0; if (d <= Math.abs(r1 - r2)) return PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)); const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return a + b - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
};
const slantHole = () => {
  // volume, and the moments in x and z, by slicing z (400 slices) and integrating the chord lengths of each slice in x (3000 steps): no kernel
  let V = 0; let mx = 0; let mz = 0; const NZ = 400; const NX = 3000;
  for (let i = 0; i < NZ; i++) {
    const z = (i + 0.5) * 10 / NZ; const dz = 10 / NZ;
    let a = 0; let ax = 0;
    for (let k = 0; k < NX; k++) {
      const x = -8 + 26 * (k + 0.5) / NX; const dx = 26 / NX;
      const c1 = 64 - (x - z) ** 2; if (c1 <= 0) continue;
      const c2 = 4 - (x - 8) ** 2;
      const half = c2 > 0 ? Math.sqrt(c1) - Math.min(Math.sqrt(c1), Math.sqrt(c2)) : Math.sqrt(c1);
      a += 2 * half * dx; ax += x * 2 * half * dx;
    }
    V += a * dz; mx += ax * dz; mz += z * a * dz;
  }
  return { volume: V, com: [mx / V, 0, mz / V], bbox: [-8, -8, 0, 18, 8, 10] };
};
add_({ id: 'lf-slant-hole2', feature: F_LOFTFACE, curved: true, note: 'a hole() bored into a slanted round pull (a straight d4 bore at x=8 through the oblique cylinder d16)',
  script: "const sk = sketch('top'); sk.circle(16, { at: [0, 0] }); const part = pull(sk, 10, { direction: [1, 0, 1] }); const h = hole(part, { across: 4, at: [3, 0] });",
  analytic: () => slantHole() });

// ---- 3. through + midplane: is brep-rs an oracle? (the critic found more disagreements than tm-mid-front) --------------------------------------------------------------------
const F_THRUMID = 'pocket options: through:true together with midplane: cut the whole part both ways';
const P20 = "const s1 = sketch('top'); s1.rect(60, 60, { at: [30, 30] }); const plate = pull(s1, 20);";
const tm3 = (id, plane, off, circ, o, note, an) => add_({ id, feature: F_THRUMID, curved: true, note, analytic: an,
  script: `${P20} const sk = sketch('${plane}', ${off}); sk.circle(8, { at: [${circ[0]}, ${circ[1]}] }); const cut = pocket(sk, plate, ${o.depth ?? 25}, { ${o.reversed ? 'reversed: true, ' : ''}through: true, midplane: true });` });
const TM3V = (len) => ({ volume: 72000 - PI * 16 * len, bbox: [0, 0, 0, 60, 60, 20], com: [30, 30, 10] });
tm3('tm3-front-circle', 'front', 30, [30, 10], {}, 'plate 60 x 60 x 20, d8 circle on the front plane at the mid depth, h25, through + midplane: the whole 60 mm in y is cut: 72000 - 16 pi 60', () => TM3V(60));
tm3('tm3-front-circle-rev', 'front', 30, [30, 10], { reversed: true }, 'the same reversed (the critic: SC 69048.57 vs brep-rs 70253.50)', () => TM3V(60));
tm3('tm3-front-circle-off10', 'front', 10, [30, 10], {}, 'the sketch near the y=0 face (offset 10): midplane + through still cuts the whole part both ways', () => TM3V(60));
tm3('tm3-side-circle', 'side', 30, [30, 10], { depth: 10 }, 'side plane circle h10 (the critic: SC 69048.57 vs brep-rs 69967.07): the whole 60 mm in x is cut', () => TM3V(60));
tm3('tm3-side-circle-rev', 'side', 30, [30, 10], { depth: 10, reversed: true }, 'the same reversed', () => TM3V(60));
for (const off of [0, 5, 20, 45, 60]) {
  tm3(`tm3-front-off${off}`, 'front', off, [30, 10], {}, `front plane, sketch at offset ${off} (y=${off}), through + midplane: still the whole 60 mm in y`, () => TM3V(60));
  tm3(`tm3-front-rev-off${off}`, 'front', off, [30, 10], { reversed: true }, `the same reversed, offset ${off}`, () => TM3V(60));
}
for (const off of [0, 10, 45, 60]) tm3(`tm3-side-off${off}`, 'side', off, [30, 10], { depth: 10 }, `side plane, sketch at offset ${off} (x=${off}), h10, through + midplane: still the whole 60 mm in x`, () => TM3V(60));
tm3('tm3-top-circle', 'top', 10, [30, 30], { depth: 5 }, 'top plane, sketch at mid height z=10: the whole 20 mm in z is cut', () => ({ volume: 72000 - PI * 16 * 20, bbox: [0, 0, 0, 60, 60, 20], com: [30, 30, 10] }));

export const R3_FEATURES = { F_JOINTOUCH, F_JOINFACE, F_OUTLINE, F_ROWS, F_SLANTX, F_LOFTFACE };
void CASES;
