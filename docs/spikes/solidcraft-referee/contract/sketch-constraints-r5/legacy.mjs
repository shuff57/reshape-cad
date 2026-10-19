// LEGACY PANEL RULES (round 2, group 'sketch-constraints'). Proposed translator code; lives only in the contract dir.
//
// A plain outline (sk.polygon / sk.rect) with panel rules (across, up, length, equal, parallel, perpendicular, pin, distX, distY, symmetric, angle) is solved by
// OUR TypeScript solver (packages/sketch, 300-iteration cap, TOL 1e-7 per residual) inside solveDoc(); SolidCraft only ever receives the already-solved
// polygon, so its numbers say nothing about SolidCraft. Two defences are measured here:
//   (A) legacyResiduals(): an INDEPENDENT plain-geometry evaluation of every legacy constraint on the polygon solveDoc returns; a violation is refused
//       (the compromise polygon of an over-constrained doc is built silently today: round-1 evidence 648.7 mm2 for a 30x20 with a 35 edge).
//   (B) legacyToSoup(): the same rules expressed as soup rows so SolidCraft's own solver solves them (route B), then the guarded route applies.
// Conventions (read from packages/sketch/dist/sketch-solve.js residualsOf): edge i runs corner i -> corner i+1 (wrapping), 0-based inside the doc;
// distanceX a b v:  x[b] - x[a] = v ; symmetric a b c: corner c is the MIDPOINT of corners a and b ; angle: signed turn from edge direction to the other
// edge direction, mod 360 ; lock: the corner stays where the polygon was written.
const N = (pts) => pts.length;
const e2c = (i, n) => [i, (i + 1) % n];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
const dotp = (a, b) => a[0] * b[0] + a[1] * b[1];
const crossp = (a, b) => a[0] * b[1] - a[1] * b[0];

/** independent residual of every legacy constraint on `pts`. mm for lengths and offsets; unit-less sine / cosine for parallel / perpendicular; degrees for angle. `written` = polygon as written (for lock). */
export function legacyResiduals(pts, constraints, written) {
  const n = N(pts);
  return constraints.map((c, idx) => {
    const edge = (e) => { const [a, b] = e2c(e, n); return sub(pts[b], pts[a]); };
    let r, unit = 'mm';
    switch (c.kind) {
      case 'horizontal': r = Math.abs(edge(c.edge)[1]); break;
      case 'vertical': r = Math.abs(edge(c.edge)[0]); break;
      case 'length': r = Math.abs(len(edge(c.edge)) - c.value); break;
      case 'equal': r = Math.abs(len(edge(c.edge)) - len(edge(c.other))); break;
      case 'parallel': r = Math.abs(crossp(edge(c.edge), edge(c.other))) / (len(edge(c.edge)) * len(edge(c.other))); unit = 'sin'; break;
      case 'perpendicular': r = Math.abs(dotp(edge(c.edge), edge(c.other))) / (len(edge(c.edge)) * len(edge(c.other))); unit = 'cos'; break;
      case 'distanceX': r = Math.abs(pts[c.b][0] - pts[c.a][0] - c.value); break;
      case 'distanceY': r = Math.abs(pts[c.b][1] - pts[c.a][1] - c.value); break;
      case 'symmetric': r = Math.hypot((pts[c.a][0] + pts[c.b][0]) / 2 - pts[c.center][0], (pts[c.a][1] + pts[c.b][1]) / 2 - pts[c.center][1]); break;
      case 'angle': {
        const da = edge(c.edge), db = edge(c.other);
        const turn = (Math.atan2(crossp(da, db), dotp(da, db)) * 180) / Math.PI;
        let d = (turn - c.degrees) % 360; if (d < -180) d += 360; if (d > 180) d -= 360;
        r = Math.abs(d); unit = 'deg'; break;
      }
      case 'lock': r = written ? len(sub(pts[c.corner], written[c.corner])) : 0; break;
      default: r = null;
    }
    return { index: idx, kind: c.kind, residual: r, unit };
  });
}
export const LEGACY_TOL = { mm: 1e-9, sin: 1e-9, cos: 1e-9, deg: 1e-7 };
/** the rows that are not met, at the stated tolerance (default: 1e-9 mm, the planar bar) */
export function legacyViolations(pts, constraints, written, tol = LEGACY_TOL) {
  const scale = Math.max(1, Math.max(...pts.flat().map(Math.abs)) / 40);
  return legacyResiduals(pts, constraints, written).filter((x) => x.residual !== null && x.residual > (x.unit === 'mm' ? tol.mm * scale : tol[x.unit]));
}

/** legacy outline + panel rules -> soup {geoms, rules}; lines 1..n are edges 0..n-1 (id = edge + 1) */
export function legacyToSoup(points, constraints) {
  const n = points.length;
  const geoms = points.map((p, i) => ({ k: 'line', id: i + 1, a: [...p], b: [...points[(i + 1) % n]] }));
  const rules = geoms.map((g, i) => ({ k: 'coincident', a: g.id, aEnd: 'b', b: ((i + 1) % n) + 1, bEnd: 'a' }));
  const lineOf = (e) => e + 1;
  for (const c of constraints) {
    switch (c.kind) {
      case 'horizontal': rules.push({ k: 'horizontal', a: lineOf(c.edge) }); break;
      case 'vertical': rules.push({ k: 'vertical', a: lineOf(c.edge) }); break;
      case 'length': rules.push({ k: 'distance', a: lineOf(c.edge), aEnd: 'a', b: lineOf(c.edge), bEnd: 'b', value: c.value }); break;
      case 'equal': rules.push({ k: 'equal', a: lineOf(c.edge), b: lineOf(c.other) }); break;
      case 'parallel': rules.push({ k: 'parallel', a: lineOf(c.edge), b: lineOf(c.other) }); break;
      case 'perpendicular': rules.push({ k: 'perpendicular', a: lineOf(c.edge), b: lineOf(c.other) }); break;
      case 'distanceX': rules.push({ k: 'distanceX', a: lineOf(c.a), aEnd: 'a', b: lineOf(c.b), bEnd: 'a', value: c.value }); break;
      case 'distanceY': rules.push({ k: 'distanceY', a: lineOf(c.a), aEnd: 'a', b: lineOf(c.b), bEnd: 'a', value: c.value }); break;
      case 'symmetric': rules.push({ k: 'symmetric', a: lineOf(c.a), aEnd: 'a', b: lineOf(c.b), bEnd: 'a', c: lineOf(c.center), cEnd: 'a' }); break;
      case 'angle': rules.push({ k: 'angle', a: lineOf(c.edge), b: lineOf(c.other), value: c.degrees }); break;
      case 'lock': rules.push({ k: 'lock', a: lineOf(c.corner), aEnd: 'a' }); break;
      default: return null;
    }
  }
  return { geoms, rules };
}
