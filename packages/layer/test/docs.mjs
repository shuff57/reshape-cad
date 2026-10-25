// Hand-written and generated ModelDocs for the differential test. Plain data only.
const V = (x, y, z) => [x, y, z];
export const box = (id, size = [20, 20, 10], center = [0, 0, 0], extra = {}) => ({ id, kind: 'box', size, center, ...extra });
export const cyl = (id, radius = 8, height = 12, center = [0, 0, 0], extra = {}) => ({ id, kind: 'cylinder', radius, height, center, ...extra });
export const sphere = (id, radius = 6, center = [0, 0, 0]) => ({ id, kind: 'sphere', radius, center });
export const cone = (id, radius = 6, height = 10, center = [0, 0, 0], extra = {}) => ({ id, kind: 'cone', radius, height, center, ...extra });
export const torus = (id, ringRadius = 10, tubeRadius = 2, center = [0, 0, 0], extra = {}) => ({ id, kind: 'torus', ringRadius, tubeRadius, center, ...extra });
export const prism = (id, sides = 6, radius = 7, height = 9, center = [0, 0, 0], extra = {}) => ({ id, kind: 'prism', sides, radius, height, center, ...extra });
export const wedge = (id, width = 12, depth = 8, height = 6, center = [0, 0, 0], extra = {}) => ({ id, kind: 'wedge', width, depth, height, center, ...extra });
export const rect = (id, w = 20, h = 12, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [w, 0], [w, h], [0, h]], ...extra });
export const circ = (id, r = 5, cx = 0, cy = 0, extra = {}) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[cx - r, cy], [cx + r, cy]], ...extra });
export const extrude = (id, target, height = 10, extra = {}) => ({ id, kind: 'extrude', target, height, ...extra });
export const pocket = (id, target, into, depth = 3, extra = {}) => ({ id, kind: 'pocket', target, into, depth, ...extra });
export const revolve = (id, target, angle = 360) => ({ id, kind: 'revolve', target, angle });
export const groove = (id, target, into, angle = 360) => ({ id, kind: 'groove', target, into, angle });
export const blend = (id, targets) => ({ id, kind: 'blend', targets });
export const combine = (id, op, targets) => ({ id, kind: 'combine', op, targets });
export const mirror = (id, target, plane = 'yz') => ({ id, kind: 'mirror', target, plane });
export const pattern = (id, target, extra) => ({ id, kind: 'pattern', target, mode: 'linear', count: 3, step: [25, 0, 0], ...extra });
export const hole = (id, target, extra) => ({ id, kind: 'hole', target, diameter: 4, depth: 30, center: [0, 0, 0], axis: 'z', ...extra });
export const shell = (id, target, open, thickness = 2) => ({ id, kind: 'shell', target, thickness, ...(open ? { open } : {}) });
export const move = (id, target, offset = [5, 0, 0], copy = false) => ({ id, kind: 'move', target, offset, copy });
export const rotate = (id, target, angles = [0, 0, 45]) => ({ id, kind: 'rotate', target, angles });
export const fillet = (id, target, edge, size = 1, style = 'fillet') => ({ id, kind: 'fillet', target, edge, size, style });
export const draft = (id, target, face, angle = 3, extra) => ({ id, kind: 'draft', target, ...(face ? { face } : {}), angle, pull: 'z', neutral: 0, ...extra });
export const datum = (id, extra) => ({ id, kind: 'datum', type: 'plane', plane: 'xy', offset: 5, ...extra });

// topological names
export const prim = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
export const cap = (feature, end) => ({ cause: 'cap', feature, kind: 'face', end });
export const swept = (feature, from, edge) => ({ cause: 'swept', feature, kind: 'face', from, edge });
export const carried = (feature, of) => ({ cause: 'carried', feature, kind: 'face', of });
export const between = (feature, a, b) => ({ cause: 'between', feature, kind: 'edge', of: [a, b] });

// soup sketches
export const line = (id, a, b, extra) => ({ k: 'line', id, a, b, ...extra });
export const arcG = (id, c, r, a, b, sense = 'ccw', extra) => ({ k: 'arc', id, c, r, a, b, sense, ...extra });
export const circG = (id, c, r, extra) => ({ k: 'circle', id, c, r, ...extra });
export const pointG = (id, p, extra) => ({ k: 'point', id, p, ...extra });
export const soup = (id, geoms, rules, extra) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points: [], geoms, rules, ...extra });
const rectGeoms = (w = 30, h = 20) => [line(1, [0, 0], [w, 0]), line(2, [w, 0], [w, h]), line(3, [w, h], [0, h]), line(4, [0, h], [0, 0])];
const rectJoins = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
];
const rectRules = [...rectJoins, { k: 'horizontal', a: 1 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 2 }, { k: 'vertical', a: 4 },
  { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 20 }, { k: 'lock', a: 1, aEnd: 'a' }];

export const SOUPS = {
  rect: () => soup('s1', rectGeoms(), rectRules),
  washerHole: () => soup('s1', [...rectGeoms(), circG(5, [15, 10], 4)], [...rectRules, { k: 'radius', a: 5, value: 4 }, { k: 'distanceX', a: -1, b: 5, bEnd: 'c', value: 15 }, { k: 'distanceY', a: -1, b: 5, bEnd: 'c', value: 10 }]),
  arcSlot: () => soup('s1', [line(1, [0, 0], [20, 0]), arcG(2, [20, 5], 5, [20, 0], [20, 10], 'ccw'), line(3, [20, 10], [0, 10]), arcG(4, [0, 5], 5, [0, 10], [0, 0], 'ccw')], [
    { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
    { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'tangent', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'equal', a: 2, b: 4 }, { k: 'parallel', a: 1, b: 3 }, { k: 'horizontal', a: 1 }]),
  cwArc: () => soup('s1', [line(1, [0, 0], [10, 0]), arcG(2, [10, 5], 5, [10, 0], [10, 10], 'cw'), line(3, [10, 10], [0, 10]), line(4, [0, 10], [0, 0])], [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'radius', a: 2, value: 5 }]),
  symmetric: () => soup('s1', [line(1, [0, 0], [10, 0]), line(2, [0, 5], [10, 5]), pointG(3, [5, 2.5]), line(4, [5, -3], [5, 8], { construction: true })], [
    { k: 'symmetric', a: 1, aEnd: 'a', b: 2, bEnd: 'a', c: 4 }, { k: 'symmetric', a: 1, aEnd: 'b', b: 2, bEnd: 'b', c: 3, cEnd: 'a' }, { k: 'perpendicular', a: 1, b: -3 }, { k: 'pointOnObject', a: 3, b: 4 }]),
  angle: () => soup('s1', [line(1, [0, 0], [10, 0]), line(2, [0, 0], [6, 6]), line(3, [6, 6], [0, 8])], [{ k: 'angle', a: 1, b: 2, value: 45 }, { k: 'angle', a: 1, b: 3, value: 30, quadrant: 2 }, { k: 'diameter', a: 1, value: 3 }]),
  distances: () => soup('s1', [line(1, [0, 0], [10, 0]), line(2, [0, 3], [10, 3])], [{ k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 10 }, { k: 'distanceY', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: -3 }, { k: 'distanceX', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 0 }, { k: 'distanceX', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 0, driving: false }, { k: 'distance', a: 1, b: 2, value: -4 }, { k: 'distance', a: 1, aEnd: 'a', b: 2, bEnd: 'a', value: 3, driving: false }, { k: 'radius', a: 1, value: 2 }]),
  inactive: () => soup('s1', rectGeoms(), [...rectRules, { k: 'horizontal', a: 2, active: false }, { k: 'lock', a: 3, driving: false }]),
  badRef: () => soup('s1', rectGeoms(), [{ k: 'coincident', a: 1, aEnd: 'b', b: 9, bEnd: 'a' }, { k: 'horizontal', a: -2 }, { k: 'weird', a: 1 }, { k: 'tangent', a: 1, b: 2 }, { k: 'tangent', a: 1, aEnd: 'a', b: 2, bEnd: 'a' }, { k: 'distance', a: 1, b: 2, value: 'x' }]),
  badIds: () => soup('s1', [line(2, [0, 0], [5, 0]), pointG(5, [1, 1]), { k: 'spline', id: 3 }], [{ k: 'coincident', a: 2, aEnd: 'a', b: 5, bEnd: 'b' }, { k: 'pointOnObject', a: 5, b: 2 }, { k: 'horizontal', a: 3 }, { k: 'coincident', a: 3, b: 2, bEnd: 'a' }]),
  tangentModes: () => soup('s1', [circG(1, [0, 0], 5), circG(2, [10, 0], 5), line(3, [0, 5], [10, 5]), circG(4, [3, 0], 2)], [{ k: 'tangent', a: 1, b: 2, mode: 'external' }, { k: 'tangent', a: 1, b: 4, mode: 'external' }, { k: 'tangent', a: 3, b: 1, side: 1 }, { k: 'tangent', a: 3, b: 2, side: -1 }, { k: 'equal', a: 1, b: 3 }, { k: 'pointOnObject', a: 4, aEnd: 'c', b: -2 }]),
  lockCircle: () => soup('s1', [circG(1, [5, 5], 3), pointG(2, [1, 1])], [{ k: 'lock', a: 1 }, { k: 'lock', a: 2 }, { k: 'diameter', a: 1, value: 6 }]),
  nested: () => soup('s1', [...rectGeoms(40, 30), line(5, [10, 10], [20, 10]), line(6, [20, 10], [20, 20]), line(7, [20, 20], [10, 20]), line(8, [10, 20], [10, 10])], [...rectJoins, { k: 'coincident', a: 5, aEnd: 'b', b: 6, bEnd: 'a' }, { k: 'coincident', a: 6, aEnd: 'b', b: 7, bEnd: 'a' }, { k: 'coincident', a: 7, aEnd: 'b', b: 8, bEnd: 'a' }, { k: 'coincident', a: 8, aEnd: 'b', b: 5, bEnd: 'a' }]),
};

/** [name, doc, mtMode] -- hand-written. */
export function handDocs() {
  const out = [];
  const add = (name, ...features) => out.push([name, { version: 1, features }]);
  add('empty');
  add('every-primitive', box('b1'), cyl('c1', 5, 8, [30, 0, 0]), sphere('s1'), cone('k1'), torus('t1'), prism('p1'), wedge('w1'));
  add('rotated-primitives', box('b1', [10, 10, 10], [5, 5, 5], { rotate: [0, 0, 30] }), cyl('c1', 4, 9, [0, 0, 0], { rotate: [90, 0, 0] }), cone('k1', 3, 6, [1, 2, 3], { rotate: [0, 45, 0] }), prism('p1', 5, 4, 5, [0, 0, 0], { rotate: [10, 20, 30] }), wedge('w1', 4, 4, 4, [0, 0, 0], { rotate: [0, 0, 90] }), torus('t1', 8, 1, [2, 0, 0], { rotate: [45, 0, 0] }));
  add('rotated-at-origin', box('b1', [10, 10, 10], [0, 0, 0], { rotate: [0, 0, 30] }));
  add('prism-sides', prism('p1', 2, 5), prism('p2', 20, 5), prism('p3', 7.4, 5));
  add('rounded-primitives', box('b1', [20, 20, 10], [0, 0, 0], { round: 2 }), box('b2', [20, 20, 10], [30, 0, 0], { round: 1, roundStyle: 'chamfer' }), cyl('c1', 6, 10, [60, 0, 0], { round: 1 }), cyl('c2', 6, 10, [90, 0, 0], { round: 6, roundStyle: 'chamfer' }), sphere('s1'), { ...cone('k1'), round: 1 });
  add('rounded-rotated', box('b1', [20, 20, 10], [4, 0, 0], { round: 1, rotate: [0, 0, 20] }));
  add('plain-extrude', rect('sk1'), extrude('e1', 'sk1', 8));
  add('circle-extrude', circ('sk1', 6, 3, 4), extrude('e1', 'sk1', 5));
  add('sketch-planes', { ...rect('sk1'), plane: 'xz', offset: 3 }, { ...rect('sk2'), plane: 'yz' }, { ...rect('sk3'), frame: { origin: [0, 0, 4], u: [1, 0, 0], v: [0, 1, 0] } }, extrude('e1', 'sk1'), extrude('e2', 'sk2'), extrude('e3', 'sk3'));
  add('bulged-outline', { ...rect('sk1'), bulges: { 1: 0.5, 3: -0.3 } }, extrude('e1', 'sk1', 4));
  add('rounded-corner-outline', { ...rect('sk1'), rounds: { 0: 2, 2: 3 } }, extrude('e1', 'sk1', 4), { ...rect('sk2'), chamfers: { 1: 2 } }, extrude('e2', 'sk2', 4));
  add('degenerate-outline', { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [0, 0], [0, 0]] }, extrude('e1', 'sk1', 4));
  add('extrude-options', rect('sk1'), extrude('e1', 'sk1', 5, { midplane: true }), extrude('e2', 'sk1', 5, { reversed: true }), extrude('e3', 'sk1', 5, { taper: 5 }), extrude('e4', 'sk1', 5, { length2: 2 }), extrude('e5', 'sk1', 5, { direction: [1, 0, 0] }), extrude('e6', 'sk1', 5, { alongNormal: true }));
  add('extrude-of-nothing', extrude('e1', 'nope', 3), box('b1'), extrude('e2', 'b1', 3));
  add('pocket-plate', box('b1', [40, 30, 10], [0, 0, 0]), rect('sk1', 10, 8), pocket('p1', 'sk1', 'b1', 4), circ('sk2', 3, 5, 5), pocket('p2', 'sk2', 'b1', 2));
  add('pocket-options', box('b1'), rect('sk1'), pocket('p1', 'sk1', 'b1', 3, { through: true }), pocket('p2', 'sk1', 'b1', 3, { midplane: true }), pocket('p3', 'sk1', 'b1', 3, { reversed: true }));
  add('pocket-no-body', rect('sk1'), pocket('p1', 'sk1', 'zz', 3), pocket('p2', 'zz', 'sk1', 3));
  add('revolve-groove', rect('sk1', 6, 20), revolve('r1', 'sk1', 360), rect('sk2', 2, 3), groove('g1', 'sk2', 'r1', 360), rect('sk3', 2, 3), groove('g2', 'sk3', 'r1', 90), revolve('r2', 'sk1', 120));
  add('groove-bad', rect('sk1'), groove('g1', 'sk1', 'nope'), box('b1'), box('b2'), combine('c1', 'union', ['b1', 'b2']), groove('g2', 'sk1', 'c1'));
  add('blend', rect('sk1'), { ...rect('sk2', 10, 10), offset: 15 }, blend('l1', ['sk1', 'sk2']), blend('l2', ['sk1']), blend('l3', ['sk1', 'sk2', 'sk1']), blend('l4', ['sk1', 'nope']));
  add('blend-soup', SOUPS.rect(), rect('sk2', 10, 10), blend('l1', ['s1', 'sk2']));
  add('combine-ops', box('b1'), box('b2', [10, 10, 10], [5, 5, 0]), combine('c1', 'union', ['b1', 'b2']), box('b3'), box('b4', [4, 4, 20]), combine('c2', 'subtract', ['b3', 'b4']), box('b5'), box('b6', [10, 10, 10], [3, 0, 0]), combine('c3', 'intersect', ['b5', 'b6']));
  add('combine-bad', box('b1'), combine('c1', 'union', ['b1']), combine('c2', 'union', ['b1', 'zz']), box('b2'), combine('c3', 'union', ['b1', 'b2']), combine('c4', 'union', ['b1', 'b2']));
  add('move-rotate-mirror', box('b1', [10, 10, 10], [5, 3, 0]), move('m1', 'b1', [1, 2, 3]), rotate('r1', 'b1', [0, 0, 30]), box('b2', [10, 10, 10], [5, 3, 1]), mirror('x1', 'b2', 'xz'), box('b3', [4, 4, 4], [-6, 0, 0]), mirror('x2', 'b3', 'yz'), box('b4', [4, 4, 4], [0, 0, 6]), mirror('x3', 'b4', 'xy'));
  add('move-copy', box('b1'), move('m1', 'b1', [3, 0, 0], true));
  add('rotate-axes', box('b1', [10, 20, 30], [4, 4, 4]), rotate('r1', 'b1', [10, 20, 30]), box('b2'), rotate('r2', 'b2', [0, 0, 0]), box('b3', [4, 4, 4], [0, 0, 0]), rotate('r3', 'b3', [0, 15, 0]));
  add('pattern-linear', box('b1', [5, 5, 5]), pattern('p1', 'b1', { count: 3 }), box('b2', [5, 5, 5]), pattern('p2', 'b2', { count: 5 }), box('b3'), pattern('p3', 'b3', { count: 1 }), box('b4'), pattern('p4', 'b4', { step: [0, 0, 0] }));
  add('pattern-circular', cyl('c1', 2, 5, [10, 0, 0]), pattern('p1', 'c1', { mode: 'circular', count: 6, axis: 'z' }), cyl('c2', 2, 5, [10, 0, 0]), pattern('p2', 'c2', { mode: 'circular', count: 4, totalAngle: 180 }), cyl('c3', 2, 5), pattern('p3', 'c3', { mode: 'circular', count: 3, axis: 'x', totalAngle: 360 }));
  add('pattern-of-bodies', box('b1'), pattern('p1', 'b1', { count: 2 }), move('m1', 'p1', [0, 5, 0]), hole('h1', 'p1', {}));
  add('holes', box('b1', [40, 30, 10]), hole('h1', 'b1', { center: [5, 5, 0] }), hole('h2', 'b1', { center: [-5, -5, 0], diameter: 6, axis: 'x' }), hole('h3', 'b1', { corners: { dx: 10, dy: 8 } }), hole('h4', 'b1', { axis: 'y', diameter: 2, depth: 7 }));
  add('hole-options', box('b1'), hole('h1', 'b1', { counterbore: { diameter: 8, depth: 2 } }), hole('h2', 'b1', { countersink: { diameter: 8, angleDeg: 90 } }), hole('h3', 'zz', {}), hole('h4', 'b1', { axis: undefined }));
  add('hole-after-consumed', box('b1'), box('b2'), combine('c1', 'union', ['b1', 'b2']), hole('h1', 'b1', {}), hole('h2', 'c1', {}), hole('h3', 'c1', { center: [3, 0, 0] }), move('m1', 'c1'), pocket('pp', 'nosk', 'c1'));
  add('shell-faces', box('b1', [30, 30, 12]), shell('s1', 'b1', prim('b1', '+z')), box('b2', [30, 30, 12]), shell('s2', 'b2', prim('b2', '-x'), 6), cyl('c1', 8, 14), shell('s3', 'c1', prim('c1', '+z'), 1), cyl('c2', 8, 14), shell('s4', 'c2', prim('c2', 'side')));
  add('shell-bad', box('b1'), shell('s1', 'b1'), box('b2'), shell('s2', 'b2', prim('b2', 'nope')), box('b3'), shell('s3', 'b3', prim('zz', '+z')), box('b4', [10, 10, 10], [0, 0, 0], { rotate: [0, 0, 5] }), shell('s4', 'b4', prim('b4', '+z')), sphere('sp'), shell('s5', 'sp', prim('sp', '+z')), box('b5', [10, 10, 10], [0, 0, 0], { round: 1 }), shell('s6', 'b5', prim('b5', '+x')), shell('s7', 'zz', prim('b5', '+x')));
  add('shell-cap-swept', rect('sk1', 20, 20), extrude('e1', 'sk1', 10), shell('s1', 'e1', cap('e1', 'top')), rect('sk2', 20, 20), extrude('e2', 'sk2', 10), shell('s2', 'e2', swept('e2', 'sk2', 1)), rect('sk3', 20, 20, { bulges: { 0: 0.3 } }), extrude('e3', 'sk3', 10), shell('s3', 'e3', swept('e3', 'sk3', 0)), rect('sk4', 20, 20), extrude('e4', 'sk4', 10), shell('s4', 'e4', cap('e4', 'middle')), shell('s5', 'e4', swept('e4', 'sk9', 0)), shell('s6', 'e4', swept('e4', 'sk4', 9)));
  add('shell-cap-options', rect('sk1'), extrude('e1', 'sk1', 10, { reversed: true }), shell('s1', 'e1', cap('e1', 'top')), circ('sk2'), extrude('e2', 'sk2', 8), shell('s2', 'e2', swept('e2', 'sk2', 0)), shell('s3', 'e2', cap('e2', 'bottom')), { ...rect('sk3'), plane: 'xz' }, extrude('e3', 'sk3', 6), shell('s4', 'e3', cap('e3', 'bottom')), shell('s5', 'e3', cap('e3', 'top')), shell('s6', 'e3', swept('e3', 'sk3', 2)));
  add('shell-soup-swept', SOUPS.rect(), extrude('e1', 's1', 6), shell('s1b', 'e1', swept('e1', 's1', 0)), shell('s1c', 'e1', cap('e1', 'top')));
  add('shell-rounded-split-made', box('b1'), shell('s1', 'b1', { cause: 'rounded', feature: 'b1', kind: 'face', from: 'sk1', corner: 1 }), box('b2'), shell('s2', 'b2', { cause: 'split', feature: 'b2', kind: 'face', of: prim('b2', '+z'), at: [0, 0, 0] }), box('b3'), shell('s3', 'b3', { cause: 'made', feature: 'b3', kind: 'face' }), box('b4'), shell('s4', 'b4', { cause: 'zzz', feature: 'b4', kind: 'face' }), box('b5'), shell('s5', 'b5', { cause: 'primitive', feature: 'b5', kind: 'edge', part: '+z' }));
  add('fillet-edges', box('b1', [20, 20, 10]), fillet('f1', 'b1', between('b1', prim('b1', '+z'), prim('b1', '+x')), 1), box('b2', [20, 20, 10]), fillet('f2', 'b2', between('b2', prim('b2', '+z'), prim('b2', '-y')), 1, 'chamfer'), box('b3'), fillet('f3', 'b3', between('b3', prim('b3', '+z'), prim('b3', '-z')), 1), box('b4'), fillet('f4', 'b4', between('b4', prim('b4', '+z'), prim('b4', '+x')), 9));
  add('fillet-cylinder-rim', cyl('c1', 8, 10), fillet('f1', 'c1', between('c1', prim('c1', '+z'), prim('c1', 'side')), 1), cyl('c2', 8, 10), fillet('f2', 'c2', between('c2', prim('c2', '-z'), prim('c2', 'side')), 1, 'chamfer'));
  add('fillet-bad', box('b1'), fillet('f1', 'b1', prim('b1', '+z'), 1), box('b2'), { id: 'f2', kind: 'fillet', target: 'b2', edge: { cause: 'between', feature: 'b2', kind: 'edge', of: [prim('b2', '+z')] }, size: 1, style: 'fillet' }, box('b3'), fillet('f3', 'b3', between('zz', prim('b3', '+z'), prim('b3', '+x')), 1), box('b4'), fillet('f4', 'b4', between('b4', prim('b4', '+z'), { cause: 'rounded', feature: 'b4', kind: 'face', from: 'sk', corner: 0 }), 1), fillet('f5', 'zz', between('b4', prim('b4', '+z'), prim('b4', '+x')), 1));
  add('fillet-after-ops', box('b1', [30, 30, 10]), hole('h1', 'b1', { center: [0, 0, 0] }), fillet('f1', 'b1', between('b1', prim('b1', '+z'), prim('b1', '+x')), 1), box('b2', [30, 30, 10]), rect('sk', 5, 5), pocket('p1', 'sk', 'b2', 3), fillet('f2', 'b2', between('b2', prim('b2', '+z'), prim('b2', '+y')), 1), fillet('f3', 'b2', between('b2', carried('p1', prim('b2', '+z')), prim('b2', '+y')), 1));
  add('fillet-through-combine', box('b1'), box('b2', [10, 10, 10], [10, 0, 0]), combine('c1', 'union', ['b1', 'b2']), fillet('f1', 'c1', between('c1', carried('c1', prim('b1', '+z')), carried('c1', prim('b1', '+y'))), 1), box('b3'), box('b4', [4, 4, 4], [0, 0, 5]), combine('c2', 'subtract', ['b3', 'b4']), fillet('f2', 'c2', between('c2', carried('c2', prim('b4', '-z')), carried('c2', prim('b3', '+x'))), 1), shell('s1', 'c2', carried('c2', prim('b3', '+z'))), shell('s2', 'c1', carried('c1', prim('b4', '+z'))));
  add('draft', box('b1'), draft('d1', 'b1', prim('b1', '+x'), 5), box('b2'), draft('d2', 'b2', null, 5), box('b3'), draft('d3', 'b3', prim('b3', '+y'), 2, { whole: true }), box('b4'), draft('d4', 'b4', prim('b4', '+z'), 1, { pull: 'x', neutral: 2 }));
  add('datum-and-sketch-on-datum', datum('d1'), { ...rect('sk1'), onDatum: 'd1', offset: 5 }, extrude('e1', 'sk1', 4), datum('d2', { frame: { origin: [0, 0, 2], u: [1, 0, 0], v: [0, 1, 0] } }));
  add('unknown-kinds', { id: 'z1', kind: 'loftish' }, box('b1'), { id: 'z2', kind: 'sweep', target: 'b1' });
  add('dependency-chain', box('b1'), box('b2', [4, 4, 4], [0, 0, 0]), combine('c1', 'subtract', ['b1', 'b2']), move('m1', 'b1'), move('m2', 'c1'), rotate('r1', 'c1'), mirror('x1', 'c1'), hole('h1', 'c1', {}), fillet('f1', 'c1', between('c1', prim('b1', '+z'), prim('b1', '+x'))));
  add('ghost-and-boom', box('ghost1'), box('b1'), move('m1', 'ghost1'), box('boom1'), move('m2', 'b1'));
  add('fail-by-rule', box('b1'), fillet('f1', 'b1', between('b1', prim('b1', '+z'), prim('b1', '+x')), 9), shell('s1', 'b1', prim('b1', '+z'), 9), blend('l', []), rect('a', 2, 2), rect('b', 3, 3), rect('c', 4, 4), blend('l2', ['a', 'b', 'c']), pattern('p', 'b1', { count: 5 }));
  add('soup-extrudes', SOUPS.rect(), extrude('e1', 's1', 5), { ...SOUPS.washerHole(), id: 's2' }, extrude('e2', 's2', 5), { ...SOUPS.arcSlot(), id: 's3' }, extrude('e3', 's3', 5), { ...SOUPS.cwArc(), id: 's4' }, extrude('e4', 's4', 5));
  add('soup-more', { ...SOUPS.symmetric(), id: 's1' }, extrude('e1', 's1', 5), { ...SOUPS.angle(), id: 's2' }, extrude('e2', 's2', 5), { ...SOUPS.distances(), id: 's3' }, extrude('e3', 's3', 5), { ...SOUPS.inactive(), id: 's4' }, extrude('e4', 's4', 5), { ...SOUPS.nested(), id: 's5' }, extrude('e5', 's5', 5));
  add('soup-refused', { ...SOUPS.badRef(), id: 's1' }, extrude('e1', 's1', 5), { ...SOUPS.badIds(), id: 's2' }, extrude('e2', 's2', 5), { ...SOUPS.tangentModes(), id: 's3' }, extrude('e3', 's3', 5), { ...SOUPS.lockCircle(), id: 's4' }, extrude('e4', 's4', 5));
  add('soup-pocket-revolve', box('b1', [40, 40, 10], [15, 10, 0]), SOUPS.rect(), pocket('p1', 's1', 'b1', 3), { ...SOUPS.rect(), id: 's2' }, revolve('r1', 's2', 360), { ...SOUPS.rect(), id: 's3' }, groove('g1', 's3', 'b1'));
  add('soup-geom-key', { id: 's1', kind: 'sketch', plane: 'xz', offset: 2, points: [], geom: [line(1, [0, 0], [10, 0]), line(2, [10, 0], [10, 10]), line(3, [10, 10], [0, 0])], rules: [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }] }, extrude('e1', 's1', 3));
  add('soup-circle-shape-wins', { id: 's1', kind: 'sketch', plane: 'xy', offset: 0, shape: 'circle', points: [[0, 0], [10, 0]], geoms: [line(1, [0, 0], [1, 1])], rules: [] }, extrude('e1', 's1', 3));
  add('soup-empty-geoms', { id: 's1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [5, 0], [5, 5]], geoms: [], rules: [] }, extrude('e1', 's1', 3));
  add('move-of-a-sketch-throws', rect('sk1'), move('m1', 'sk1', [1, 0, 0]));
  add('malformed-doc-fields', { id: 'b1', kind: 'box' }, { id: 'c1', kind: 'cylinder', center: [0, 0, 0] }, { id: 'e1', kind: 'extrude', height: 3 }, { id: 'h1', kind: 'hole', target: 'b1' }, { id: 'p1', kind: 'pattern', target: 'b1', mode: 'linear', count: 3 });
  return out;
}

// -------------------------------------------------------------------------------------------- seeded generator
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function generatedDoc(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const feats = [];
  const solids = []; const sketches = []; const prims = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const nSteps = 4 + Math.floor(r() * 9);
  const anySolid = () => (solids.length && r() > 0.06 ? pick(solids) : pick(['zz', ...sketches, 'zz2']));
  const anySketch = () => (sketches.length && r() > 0.06 ? pick(sketches) : pick(['nope', ...solids]));
  const pm = () => pick(['+x', '-x', '+y', '-y', '+z', '-z', 'side', 'bad']);
  const faceName = () => {
    const t = r();
    const f = prims.length ? pick(prims) : { id: 'zz', kind: 'box' };
    if (t < 0.55) return prim(f.id, pm());
    if (t < 0.7) return cap(pick(solids.concat(['e0'])), pick(['top', 'bottom', 'top']));
    if (t < 0.8) { const s = pick(sketches.concat(['sk0'])); return swept(pick(solids.concat(['e0'])), s, Math.floor(r() * 5)); }
    if (t < 0.93) return carried(pick(solids.concat(['c0'])), prim(f.id, pm()));
    return { cause: pick(['rounded', 'split', 'made', 'odd']), feature: f.id, kind: 'face', from: 'sk1', corner: 0 };
  };
  const edgeName = () => (r() < 0.92 ? (() => { const f = prims.length ? pick(prims) : { id: 'zz' }; const host = r() < 0.7 ? f.id : pick(solids.concat(['q0'])); return between(host, faceName(), faceName()); })() : faceName());
  for (let s = 0; s < nSteps; s++) {
    const t = r();
    let f;
    if (t < 0.22) {
      const k = pick(['box', 'box', 'cylinder', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge']);
      const i = id(k[0]); const c = [num(-6, 6), num(-6, 6), num(-3, 3)];
      const rot = r() < 0.2 ? { rotate: [pick([0, 0, 30]), pick([0, 15]), pick([0, 45])] } : {};
      const rnd = r() < 0.15 && (k === 'box' || k === 'cylinder' || k === 'cone') ? { round: num(0.5, 3), ...(r() < 0.5 ? { roundStyle: 'chamfer' } : {}) } : {};
      if (k === 'box') f = box(i, [num(5, 40), num(5, 40), num(3, 20)], c, { ...rot, ...rnd });
      else if (k === 'cylinder') f = cyl(i, num(2, 12), num(3, 20), c, { ...rot, ...rnd });
      else if (k === 'sphere') f = sphere(i, num(2, 9), c);
      else if (k === 'cone') f = cone(i, num(2, 9), num(3, 12), c, { ...rot, ...rnd });
      else if (k === 'torus') f = torus(i, num(6, 14), num(1, 3), c, rot);
      else if (k === 'prism') f = prism(i, Math.floor(r() * 12) + 1, num(2, 9), num(3, 12), c, rot);
      else f = wedge(i, num(3, 12), num(3, 12), num(3, 10), c, rot);
      prims.push(f); solids.push(f.id);
    } else if (t < 0.4) {
      const i = id('sk'); const u = r();
      if (u < 0.25) f = circ(i, num(2, 8), num(-3, 3), num(-3, 3));
      else if (u < 0.45) f = rect(i, num(5, 30), num(5, 30), { bulges: { [Math.floor(r() * 4)]: num(-0.75, 0.75) } });
      else if (u < 0.55) f = rect(i, num(10, 30), num(10, 30), { rounds: { [Math.floor(r() * 4)]: num(0.5, 3) } });
      else if (u < 0.65) f = { ...rect(i, 20, 20), plane: pick(['xy', 'xz', 'yz']), offset: num(-4, 4) };
      else if (u < 0.78) { const sp = pick(Object.keys(SOUPS)); f = { ...SOUPS[sp](), id: i }; }
      else f = rect(i, num(4, 40), num(4, 40));
      sketches.push(f.id);
    } else if (t < 0.52) {
      f = extrude(id('e'), anySketch(), num(1, 20), r() < 0.12 ? { [pick(['midplane', 'reversed', 'taper', 'length2'])]: 1 } : {});
      solids.push(f.id);
    } else if (t < 0.58) { f = pocket(id('p'), anySketch(), anySolid(), num(1, 8)); }
    else if (t < 0.63) { f = revolve(id('r'), anySketch(), pick([360, 360, 180])); solids.push(f.id); }
    else if (t < 0.66) { f = groove(id('g'), anySketch(), anySolid(), pick([360, 90])); }
    else if (t < 0.69) { f = blend(id('l'), [anySketch(), anySketch(), ...(r() < 0.3 ? [anySketch()] : [])]); solids.push(f.id); }
    else if (t < 0.74) { f = combine(id('c'), pick(['union', 'subtract', 'intersect']), [anySolid(), anySolid(), ...(r() < 0.2 ? [anySolid()] : [])]); solids.push(f.id); }
    else if (t < 0.77) f = mirror(id('x'), anySolid(), pick(['xy', 'xz', 'yz']));
    else if (t < 0.81) f = pattern(id('pt'), anySolid(), r() < 0.5 ? { count: Math.floor(r() * 5) + 1 } : { mode: 'circular', count: Math.floor(r() * 6) + 2, axis: pick(['x', 'y', 'z']), ...(r() < 0.2 ? { totalAngle: 90 } : {}) });
    else if (t < 0.86) f = hole(id('h'), anySolid(), { diameter: num(1, 8), depth: num(3, 40), center: [num(-8, 8), num(-8, 8), num(-2, 2)], axis: pick(['x', 'y', 'z']), ...(r() < 0.25 ? { corners: { dx: num(2, 9), dy: num(2, 9) } } : {}), ...(r() < 0.1 ? { counterbore: { diameter: 6, depth: 2 } } : {}) });
    else if (t < 0.9) f = shell(id('s'), anySolid(), r() < 0.9 ? faceName() : undefined, num(0.5, 7));
    else if (t < 0.93) f = move(id('m'), anySolid(), [num(-9, 9), num(-9, 9), num(-9, 9)], r() < 0.2);
    else if (t < 0.95) f = rotate(id('rt'), anySolid(), [pick([0, 30]), pick([0, 15]), pick([0, 45, 90])]);
    else if (t < 0.98) f = fillet(id('f'), anySolid(), edgeName(), num(0.25, 6), pick(['fillet', 'chamfer']));
    else if (t < 0.99) f = draft(id('d'), anySolid(), r() < 0.8 ? faceName() : null, num(1, 6), r() < 0.2 ? { whole: true } : {});
    else f = r() < 0.5 ? datum(id('dm')) : { id: id('u'), kind: pick(['loftish', 'sweep']) };
    feats.push(f);
  }
  return { version: 1, features: feats };
}
