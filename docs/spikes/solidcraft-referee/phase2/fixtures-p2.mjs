// SPIKE, referee only. Phase 2 fixtures: constrained sketches (geoms + rules, before solving), each with the reference
// values that exist for it:
//   closed  : closed-form area (mm^2) of the solved profile; volume = area * H (never a kernel number)
//   bbox    : closed-form world bbox [x0,y0,z0,x1,y1,z1] of the extruded solid
//   expectDof : the degrees of freedom the doc is DESIGNED to leave (hand count in the comment next to the rules)
// The gauntlet variants (docs/replica/freecad/gauntlet/variants/sketch-defs.mjs) are imported, not copied; their FreeCAD
// reference (dof / conflicting / redundant / in-plane bbox) is read from variants/refs/ by the runner.
import { SKETCH_VARIANTS } from '../../../replica/freecad/gauntlet/variants/sketch-defs.mjs';

export const H = 10; // extrude height for every fixture

const L = (id, a, b, extra = {}) => ({ k: 'line', id, a, b, ...extra });
const join = (i, j) => ({ k: 'coincident', a: i, aEnd: 'b', b: j, bEnd: 'a' });
const loopJoins = (n, first = 1) => Array.from({ length: n }, (_, i) => join(first + i, first + ((i + 1) % n)));
const len = (i) => ({ k: 'distance', a: i, aEnd: 'a', b: i, bEnd: 'b' });
const withValue = (r, value) => ({ ...r, value });
const rectGeoms = (x0, y0, x1, y1) => [L(1, [x0, y0], [x1, y0]), L(2, [x1, y0], [x1, y1]), L(3, [x1, y1], [x0, y1]), L(4, [x0, y1], [x0, y0])];
const rectShape = () => [...loopJoins(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const atOrigin = (id, end = 'a') => ({ k: 'coincident', a: id, aEnd: end, b: -1, bEnd: 'a' });

const hexV = (r, k) => [r * Math.cos(((60 * k - 30) * Math.PI) / 180), r * Math.sin(((60 * k - 30) * Math.PI) / 180)];
const hexLines = Array.from({ length: 6 }, (_, k) => L(k + 1, hexV(20, k), hexV(20, (k + 1) % 6)));

/** closed-form `closed` areas below are written as arithmetic so a reader can check them by eye. */
export const OWN = [
  {
    id: 'own-rect-rough-dims', group: 'rect with dimensions',
    desc: 'a hand-drawn 28 x 17 rectangle near (4,2); the rules dimension it 30 x 20 with the corner 5 right and 3 up of the origin',
    plane: 'xy', geoms: rectGeoms(4.2, 2.1, 32.4, 19.1),
    rules: [...rectShape(), withValue({ k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'a' }, 5), withValue({ k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a' }, 3), withValue(len(1), 30), withValue(len(2), 20)],
    // 16 - 8 joins - 4 h/v - 2 (dx,dy) - 2 (lengths) = 0
    expectDof: 0, closed: 30 * 20, bbox: [5, 3, 0, 35, 23, H],
  },
  {
    id: 'own-symmetric-trapezoid', group: 'symmetric profile',
    desc: 'an isosceles trapezoid mirrored about the Y axis: both parallel sides are symmetric rows about axis -3; base 40, top 20, height 15',
    plane: 'xy', geoms: [L(1, [-19, 0.5], [21, 0.3]), L(2, [21, 0.3], [9.5, 14]), L(3, [9.5, 14], [-10.5, 15]), L(4, [-10.5, 15], [-19, 0.5])],
    rules: [...loopJoins(4),
      { k: 'symmetric', a: 1, aEnd: 'a', b: 1, bEnd: 'b', c: -3 }, { k: 'symmetric', a: 3, aEnd: 'a', b: 3, bEnd: 'b', c: -3 },
      withValue(len(1), 40), withValue(len(3), 20),
      withValue({ k: 'distanceY', a: 1, aEnd: 'a', b: 3, bEnd: 'a' }, 15), { k: 'pointOnObject', a: 1, aEnd: 'a', b: -2 }],
    // 16 - 8 joins - 4 (two symmetric, 2 rows each; they imply horizontal) - 2 lengths - 1 height - 1 on X axis = 0
    expectDof: 0, closed: ((40 + 20) / 2) * 15, bbox: [-20, 0, 0, 20, 15, H],
  },
  {
    id: 'own-symmetric-3pt-rect', group: 'symmetric profile',
    desc: 'a rectangle whose opposite corners are symmetric about a centre point (the 3-point symmetric form), centre on the origin; 36 x 24',
    plane: 'xy', geoms: [...rectGeoms(-17, -13, 18.5, 12.5), { k: 'point', id: 5, p: [0.4, -0.3] }],
    rules: [...rectShape(), { k: 'symmetric', a: 1, aEnd: 'a', b: 3, bEnd: 'a', c: 5, cEnd: 'a' },
      { k: 'coincident', a: 5, aEnd: 'a', b: -1, bEnd: 'a' }, withValue(len(1), 36), withValue(len(2), 24)],
    // 16 + 2 (point) - 8 - 4 - 2 (midpoint) - 2 (centre on origin) - 2 (lengths) = 0
    expectDof: 0, closed: 36 * 24, bbox: [-18, -12, 0, 18, 12, H],
  },
  {
    id: 'own-triangle-length-angle', group: 'polygon with angle and length dimensions',
    desc: 'a triangle: base 40 from the origin, side 30, and 120 deg (exterior; 60 deg interior) between them',
    plane: 'xy', geoms: [L(1, [0.5, 0.4], [39, 1]), L(2, [39, 1], [25, 26.5]), L(3, [25, 26.5], [0.5, 0.4])],
    rules: [...loopJoins(3), { k: 'horizontal', a: 1 }, atOrigin(1), withValue(len(1), 40), withValue(len(2), 30), { k: 'angle', a: 1, b: 2, value: 120 }],
    // 12 - 6 joins - 1 h - 2 origin - 2 lengths - 1 angle = 0
    expectDof: 0, closed: 0.5 * 40 * 30 * Math.sin(Math.PI / 3), bbox: [0, 0, 0, 40, 30 * Math.sin(Math.PI / 3), H],
  },
  {
    id: 'own-hexagon-equal-oncircle', group: 'polygon with angle and length dimensions',
    desc: 'a regular hexagon from primitives: 5 equal rows, 6 vertices pointOnObject a construction circle (centre on the origin, r 20), one vertical side',
    plane: 'xy', geoms: [...hexLines, { k: 'circle', id: 7, c: [0.3, -0.2], r: 19.4, construction: true }],
    rules: [...loopJoins(6), ...[1, 2, 3, 4, 5].map((i) => ({ k: 'equal', a: i, b: i + 1 })),
      ...[1, 2, 3, 4, 5, 6].map((i) => ({ k: 'pointOnObject', a: i, aEnd: 'a', b: 7 })),
      { k: 'coincident', a: 7, aEnd: 'c', b: -1, bEnd: 'a' }, { k: 'radius', a: 7, value: 20 }, { k: 'vertical', a: 1 }],
    // 24 + 3 - 12 joins - 5 equal - 6 on circle - 2 centre - 1 radius - 1 vertical = 0
    expectDof: 0, closed: ((3 * Math.sqrt(3)) / 2) * 400, bbox: [-20 * Math.cos(Math.PI / 6), -20, 0, 20 * Math.cos(Math.PI / 6), 20, H],
  },
  {
    id: 'own-circle-diameter', group: 'circle radius/diameter',
    desc: 'a circle drawn r 6 at (9,6); diameter 14 with its centre 10 right and 5 up of the origin',
    plane: 'xy', geoms: [{ k: 'circle', id: 1, c: [9, 6], r: 6 }],
    rules: [withValue({ k: 'diameter', a: 1 }, 14), withValue({ k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'c' }, 10), withValue({ k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'c' }, 5)],
    // 3 - 1 - 1 - 1 = 0
    expectDof: 0, closed: Math.PI * 49, bbox: [3, -2, 0, 17, 12, H],
  },
  {
    id: 'own-washer-dims', group: 'rect with dimensions',
    desc: 'a 40 x 25 plate with a hole: circle diameter 10 whose centre is dimensioned 20 / 12.5 from the plate corner (two loops, one a hole)',
    plane: 'xy', geoms: [...rectGeoms(0.3, 0.2, 39, 25.6), { k: 'circle', id: 5, c: [19, 13.5], r: 4.4 }],
    rules: [...rectShape(), atOrigin(1), withValue(len(1), 40), withValue(len(2), 25),
      withValue({ k: 'diameter', a: 5 }, 10), withValue({ k: 'distanceX', a: 1, aEnd: 'a', b: 5, bEnd: 'c' }, 20), withValue({ k: 'distanceY', a: 1, aEnd: 'a', b: 5, bEnd: 'c' }, 12.5)],
    // 16 + 3 - 8 - 4 - 2 origin - 2 lengths - 3 (circle) = 0
    expectDof: 0, closed: 40 * 25 - Math.PI * 25, bbox: [0, 0, 0, 40, 25, H],
  },
  {
    id: 'own-l-shape-dims', group: 'polygon with angle and length dimensions',
    desc: 'an L-shaped polygon of 6 lines: all horizontal/vertical, dimensioned 40, 12, 25, 18 from the origin',
    plane: 'xy', geoms: [L(1, [0.4, 0.3], [40, 0]), L(2, [40, 0], [40.5, 12]), L(3, [40.5, 12], [15, 11.5]), L(4, [15, 11.5], [15.2, 30]), L(5, [15.2, 30], [0, 30.4]), L(6, [0, 30.4], [0.4, 0.3])],
    rules: [...loopJoins(6), ...[1, 3, 5].map((i) => ({ k: 'horizontal', a: i })), ...[2, 4, 6].map((i) => ({ k: 'vertical', a: i })), atOrigin(1),
      withValue(len(1), 40), withValue(len(2), 12), withValue(len(3), 25), withValue(len(4), 18)],
    // 24 - 12 - 6 - 2 - 4 = 0
    expectDof: 0, closed: 40 * 12 + 15 * 18, bbox: [0, 0, 0, 40, 30, H],
  },
  {
    id: 'own-xz-plane-rect', group: 'rect with dimensions',
    desc: 'the same kind of dimensioned rectangle on the xz plane (frame check: our extrude runs along u x v = -Y)',
    plane: 'xz', geoms: rectGeoms(0.2, 0.3, 20.4, 9.7),
    rules: [...rectShape(), atOrigin(1), withValue(len(1), 20), withValue(len(2), 10)],
    // 16 - 8 - 4 - 2 - 2 = 0
    expectDof: 0, closed: 200, bbox: [0, -H, 0, 20, 0, 10],
  },
  {
    id: 'own-right-trapezoid-par-perp', group: 'polygon with angle and length dimensions',
    desc: 'a right trapezoid from parallel + perpendicular rows, a signed (negative) distanceX on the slanted side, base 30, left 16',
    plane: 'xy', geoms: [L(1, [0.3, 0.2], [30, 0.4]), L(2, [30, 0.4], [21, 16]), L(3, [21, 16], [0.5, 15.5]), L(4, [0.5, 15.5], [0.3, 0.2])],
    rules: [...loopJoins(4), { k: 'horizontal', a: 1 }, { k: 'perpendicular', a: 1, b: 4 }, { k: 'parallel', a: 1, b: 3 }, atOrigin(1),
      withValue(len(1), 30), withValue(len(4), 16), withValue({ k: 'distanceX', a: 2, aEnd: 'a', b: 2, bEnd: 'b' }, -8)],
    // 16 - 8 - 1 - 1 - 1 - 2 - 2 - 1 = 0
    expectDof: 0, closed: ((30 + 22) / 2) * 16, bbox: [0, 0, 0, 30, 16, H],
  },
  {
    id: 'own-slot-dims-from-points', group: 'slot-like tangent arcs',
    desc: 'a slot written head-to-tail (every segment runs a -> b into the next, the orientation brep-rs\'s profile builder wants for tangent joints) with tangent joints, dimensioned by distanceX of the cap centres instead of a line length: cap r 5, centres 25 apart on the x axis',
    plane: 'xy',
    geoms: [L(1, [0.2, -5.1], [25.3, -4.9]),
      { k: 'arc', id: 2, c: [25, 0.1], r: 5, a: [25.1, -5], b: [25.3, 4.8], sense: 'ccw' },
      L(3, [25.3, 5.2], [-0.1, 4.9]),
      { k: 'arc', id: 4, c: [0.1, 0], r: 5, a: [0, 5.1], b: [-0.2, -5], sense: 'ccw' }],
    rules: [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
      { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'a', b: 2, bEnd: 'b' },
      { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
      { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'tangent', a: 1, aEnd: 'a', b: 4, bEnd: 'b' },
      { k: 'horizontal', a: 1 }, withValue({ k: 'radius', a: 2 }, 5), { k: 'equal', a: 2, b: 4 },
      { k: 'coincident', a: 4, aEnd: 'c', b: -1, bEnd: 'a' }, withValue({ k: 'distanceX', a: 4, aEnd: 'c', b: 2, bEnd: 'c' }, 25)],
    // 18 - 8 (coincident x4) - 4 (tangent x4) - 1 h - 1 radius - 1 equal - 2 centre - 1 dx = 0 (dy of the centres is implied by h + two equal tangent caps)
    expectDof: 0, closed: 25 * 10 + Math.PI * 25, bbox: [-5, -5, 0, 30, 5, H],
  },
];

// ---- gauntlet closed forms (arithmetic from each variant's own description) -------------------------------------------------
const slotArea = (Lx, R) => Lx * 2 * R + Math.PI * R * R;
const GAUNTLET_CLOSED = {
  'sk-rect-dof__corner-origin-25x60': 25 * 60,
  'sk-rect-dof__offset-corner-30x18': 30 * 18,
  'sk-rect-dof__square-by-equal': 22 * 22,
  'sk-rect-dof__right-triangle': 0.5 * 30 * 20,
  'sk-rect-dof__parallelogram': 30 * 15,
  'sk-rect-dof__circle-pinned': Math.PI * 49,
  'sk-rect-underconstrained__width-and-height': 30 * 15,
  'sk-rect-underconstrained__circle-radius-only': Math.PI * 16,
  'sk-circle-arc-tangent__slot-r6-L30-anchored': slotArea(30, 6),
  'sk-circle-arc-tangent__slot-r6-L30-floating': slotArea(30, 6),
  'sk-circle-arc-tangent__slot-r12-L18-anchored': slotArea(18, 12),
  'sk-circle-arc-tangent__slot-arc-first-order': slotArea(30, 6),
  'sk-circle-arc-tangent__slot-extra-radius': slotArea(30, 6),
  'sk-conflict__clean-30x20': 30 * 20,
  // two tangent circles: disjoint touching discs / a disc with a tangent internal hole (closed forms; brep-rs refuses both)
  'sk-circle-arc-tangent__circle-circle-external': Math.PI * (64 + 25),
  'sk-circle-arc-tangent__circle-circle-no-mode': Math.PI * (64 + 25),
  'sk-circle-arc-tangent__circle-circle-internal': Math.PI * (64 - 25),
};

export function gauntletFixtures() {
  return SKETCH_VARIANTS.map((v) => ({
    id: v.id, group: v.piece, desc: v.desc, plane: 'xy', geoms: v.oursGeom, rules: v.oursRules, gauntlet: true,
    closed: GAUNTLET_CLOSED[v.id] ?? null,
  }));
}
