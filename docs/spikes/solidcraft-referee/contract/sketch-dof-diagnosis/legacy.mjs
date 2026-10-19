// Legacy outline sketches (points + edge/corner constraints) and their conversion to soup rows, so one document can be fed to
// packages/sketch solveSketch, brep-rs, an independent LM, and SolidCraft.
export const H = 10;
export function toSoup(points, cons) {
  const n = points.length;
  const geoms = points.map((p, i) => ({ k: 'line', id: i + 1, a: p, b: points[(i + 1) % n] }));
  const rules = points.map((_, i) => ({ k: 'coincident', a: i + 1, aEnd: 'b', b: ((i + 1) % n) + 1, bEnd: 'a' }));
  const E = (e) => ((e % n) + n) % n + 1;
  for (const c of cons) {
    if (c.kind === 'horizontal' || c.kind === 'vertical') rules.push({ k: c.kind, a: E(c.edge) });
    else if (c.kind === 'length') rules.push({ k: 'distance', a: E(c.edge), aEnd: 'a', b: E(c.edge), bEnd: 'b', value: c.value });
    else if (c.kind === 'equal' || c.kind === 'parallel' || c.kind === 'perpendicular') rules.push({ k: c.kind, a: E(c.edge), b: E(c.other) });
    else if (c.kind === 'distanceX' || c.kind === 'distanceY') rules.push({ k: c.kind, a: c.a + 1, aEnd: 'a', b: c.b + 1, bEnd: 'a', value: c.value });
    else if (c.kind === 'symmetric') rules.push({ k: 'symmetric', a: c.a + 1, aEnd: 'a', b: c.b + 1, bEnd: 'a', c: c.center + 1, cEnd: 'a' });
    else if (c.kind === 'angle') rules.push({ k: 'angle', a: E(c.edge), b: E(c.other), value: c.degrees });
    else if (c.kind === 'lock') rules.push({ k: 'lock', a: c.corner + 1, aEnd: 'a' });
    else throw new Error('toSoup: ' + c.kind);
  }
  return { geoms, rules };
}
export const polyArea = (p) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2;
export function polyCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  p.forEach((q, i) => { const r = p[(i + 1) % p.length]; const c = q[0] * r[1] - r[0] * q[1]; a += c; cx += (q[0] + r[0]) * c; cy += (q[1] + r[1]) * c; });
  return [cx / (3 * a), cy / (3 * a)];
}
const R = [[0, 0], [38, 2], [39, 23], [1, 21]];
const rectHV = [{ kind: 'horizontal', edge: 0 }, { kind: 'vertical', edge: 1 }, { kind: 'horizontal', edge: 2 }, { kind: 'vertical', edge: 3 }];
const r3 = Math.sqrt(3) / 2;
/** fully determined cases: `want` is the closed-form solved polygon. */
export const DETERMINED = [
  { id: 'D1-rect-lengths-lock', kinds: ['horizontal', 'vertical', 'length', 'lock'], pts: R, cons: [...rectHV, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 1, value: 25 }, { kind: 'lock', corner: 0 }], want: [[0, 0], [40, 0], [40, 25], [0, 25]] },
  { id: 'D2-square-by-equal', kinds: ['equal'], pts: [[0, 0], [21, 1], [22, 23], [1, 21]], cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 22 }, { kind: 'equal', edge: 0, other: 1 }], want: [[0, 0], [22, 0], [22, 22], [0, 22]] },
  { id: 'D3-right-trapezoid-parallel-perpendicular-distX', kinds: ['parallel', 'perpendicular', 'distanceX'], pts: [[0, 0], [30, 1], [22, 16], [1, 15]], cons: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 0, value: 30 }, { kind: 'perpendicular', edge: 0, other: 3 }, { kind: 'parallel', edge: 0, other: 2 }, { kind: 'length', edge: 3, value: 16 }, { kind: 'distanceX', a: 1, b: 2, value: -8 }], want: [[0, 0], [30, 0], [22, 16], [0, 16]] },
  { id: 'D4-rect-diagonal-distX-distY', kinds: ['distanceX', 'distanceY'], pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'distanceX', a: 0, b: 2, value: 30 }, { kind: 'distanceY', a: 0, b: 2, value: 20 }], want: [[0, 0], [30, 0], [30, 20], [0, 20]] },
  { id: 'D5-pentagon-symmetric-centre', kinds: ['symmetric'], pts: [[0, 0], [10, 1], [11, 8], [1, 9], [5, 4]], cons: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 0, value: 10 }, { kind: 'vertical', edge: 1 }, { kind: 'length', edge: 1, value: 8 }, { kind: 'horizontal', edge: 2 }, { kind: 'length', edge: 2, value: 10 }, { kind: 'symmetric', a: 0, b: 2, center: 4 }], want: [[0, 0], [10, 0], [10, 8], [0, 8], [5, 4]] },
  { id: 'D6-triangle-angle-120', kinds: ['angle'], pts: [[0, 0], [30, 1], [18, 20]], cons: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 0, value: 30 }, { kind: 'angle', edge: 0, other: 1, degrees: 120 }, { kind: 'length', edge: 1, value: 20 }], want: [[0, 0], [30, 0], [20, 20 * r3]] },
  { id: 'D7-parallelogram', kinds: ['parallel', 'distanceY'], pts: [[0, 0], [30, 1], [40, 16], [11, 15]], cons: [{ kind: 'lock', corner: 0 }, { kind: 'horizontal', edge: 0 }, { kind: 'length', edge: 0, value: 30 }, { kind: 'parallel', edge: 0, other: 2 }, { kind: 'parallel', edge: 1, other: 3 }, { kind: 'distanceX', a: 1, b: 2, value: 10 }, { kind: 'distanceY', a: 1, b: 2, value: 15 }], want: [[0, 0], [30, 0], [40, 15], [10, 15]] },
];
/** under-determined: only invariants + dof are checked. */
export const UNDER = [
  { id: 'U1-rect-hv-lock', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }], dof: 2 },
  { id: 'U2-rect-hv-only', pts: R, cons: rectHV, dof: 4 },
];
/** conflicts / redundancy */
export const CONFLICT = [
  { id: 'X1-two-lengths-one-edge', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }], add: { kind: 'length', edge: 0, value: 30 } },
  { id: 'X2-opposite-sides-different-lengths', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }], add: { kind: 'length', edge: 2, value: 30 } },
  { id: 'X3-equal-vs-two-lengths', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 1, value: 20 }], add: { kind: 'equal', edge: 0, other: 1 } },
  { id: 'X4-lock-vs-horizontal', pts: [[0, 0], [40, 25], [40, 25.5], [0, 25]], cons: [{ kind: 'lock', corner: 0 }, { kind: 'lock', corner: 1 }], add: { kind: 'horizontal', edge: 0 } },
  { id: 'X5-three-lengths-one-edge', pts: R, cons: [{ kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 0, value: 30 }], add: { kind: 'length', edge: 0, value: 20 } },
  { id: 'X6-triangle-three-perpendicular', pts: [[0, 0], [30, 2], [14, 20]], cons: [{ kind: 'perpendicular', edge: 0, other: 1 }, { kind: 'perpendicular', edge: 1, other: 2 }], add: { kind: 'perpendicular', edge: 2, other: 0 } },
];
export const REDUNDANT = [
  { id: 'R1-opposite-sides-equal-and-both-dimensioned', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 1, value: 25 }, { kind: 'length', edge: 2, value: 40 }] },
  { id: 'R2-perpendicular-on-hv-rect', pts: R, cons: [...rectHV, { kind: 'lock', corner: 0 }, { kind: 'length', edge: 0, value: 40 }, { kind: 'length', edge: 1, value: 25 }, { kind: 'perpendicular', edge: 0, other: 1 }] },
];
