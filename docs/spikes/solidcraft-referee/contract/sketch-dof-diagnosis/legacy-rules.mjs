// CONTRACT PIECE (round 4). Independent evaluator for the LEGACY outline rule kinds (packages/sketch Constraint), SIGNED, in plain geometry.
// Shares no code with packages/sketch (residualsOf there returns |r| and its LM stops at a kink, which is why solveSketch only reaches 1e-6..1e-8).
// Used for: (1) the rule check of the legacy guard (does every rule the student wrote hold on the points that will be extruded),
//           (2) polish(): a signed Gauss-Newton / LM pass on the TS solver's answer that reaches ~1e-13 where the TS solver stops at 1e-6..6e-8.
// Edge e runs from corner e to corner e+1 (mod n). Angles in degrees. Residuals are mm (angles are turned into mm with the sketch diagonal).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

export function diagOf(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Number.isFinite(d) && d > 1e-9 ? d : 1;
}
const E = (pts, e) => { const n = pts.length; return [pts[((e % n) + n) % n], pts[(((e + 1) % n) + n) % n]]; };
const edgeVec = (pts, e) => { const [a, b] = E(pts, e); return sub(b, a); };

/** signed residual list, parallel to `constraints` (one number per rule; symmetric returns the larger axis, signed by that axis). `start` = the points before the solve (lock). */
export function signedResiduals(pts, constraints, start = pts, scale = diagOf(start)) {
  const n = pts.length;
  return constraints.map((c) => {
    switch (c.kind) {
      case 'horizontal': { const [a, b] = E(pts, c.edge); return b[1] - a[1]; }
      case 'vertical': { const [a, b] = E(pts, c.edge); return b[0] - a[0]; }
      case 'length': return len(edgeVec(pts, c.edge)) - c.value;
      case 'equal': return len(edgeVec(pts, c.edge)) - len(edgeVec(pts, c.other));
      case 'parallel': case 'perpendicular': {
        const u = edgeVec(pts, c.edge), v = edgeVec(pts, c.other);
        const lu = len(u), lv = len(v);
        if (lu < 1e-12 || lv < 1e-12) return scale; // no direction: maximally wrong
        const s = c.kind === 'parallel' ? cross(u, v) / (lu * lv) : dot(u, v) / (lu * lv);
        return Math.asin(Math.max(-1, Math.min(1, s))) * scale;
      }
      case 'distanceX': return pts[c.b][0] - pts[c.a][0] - c.value;
      case 'distanceY': return pts[c.b][1] - pts[c.a][1] - c.value;
      case 'symmetric': {
        const mx = (pts[c.a][0] + pts[c.b][0]) / 2 - pts[c.center][0], my = (pts[c.a][1] + pts[c.b][1]) / 2 - pts[c.center][1];
        return Math.abs(mx) >= Math.abs(my) ? mx : my;
      }
      case 'angle': {
        const u = edgeVec(pts, c.edge), v = edgeVec(pts, c.other);
        if (len(u) < 1e-12 || len(v) < 1e-12) return scale;
        const turn = Math.atan2(cross(u, v), dot(u, v));
        let want = ((c.degrees * Math.PI) / 180) % (2 * Math.PI);
        if (want > Math.PI) want -= 2 * Math.PI; if (want <= -Math.PI) want += 2 * Math.PI;
        let d = turn - want; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return (d / (2 * Math.PI)) * scale;
      }
      case 'lock': return Math.hypot(pts[c.corner][0] - start[c.corner][0], pts[c.corner][1] - start[c.corner][1]);
      default: return NaN;
    }
  });
}
/** one entry per EQUATION (symmetric has two: x and y), lock rules omitted; used by polish() and legacyDof() so no equation is lost */
export function rowsOf(pts, constraints, start = pts, scale = diagOf(start)) {
  const out = [];
  constraints.forEach((c, i) => {
    if (c.kind === 'lock') return;
    if (c.kind === 'symmetric') { out.push((pts[c.a][0] + pts[c.b][0]) / 2 - pts[c.center][0], (pts[c.a][1] + pts[c.b][1]) / 2 - pts[c.center][1]); return; }
    out.push(signedResiduals(pts, [c], start, scale)[0]);
  });
  return out;
}
export const ruleOk = (r, tol) => Math.abs(r) <= tol;
/** every rule holds to tol (mm), NaN counts as failing; returns {ok, worst:{index,kind,residual}} */
export function checkAll(pts, constraints, start = pts, tolMm = 1e-6) {
  const r = signedResiduals(pts, constraints, start);
  let worst = { index: -1, residual: 0 };
  r.forEach((v, i) => { if (!(Math.abs(v) <= Math.abs(worst.residual))) worst = { index: i, kind: constraints[i].kind, residual: v }; });
  const ok = r.every((v) => Math.abs(v) <= tolMm);
  return { ok, worst, residuals: r };
}

function solveLin(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let i = c + 1; i < n; i++) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
/**
 * Minimum-norm Gauss-Newton on the free coordinates (locked corners and `pinned` corners are not unknowns, as in solveSketch), signed residuals, backtracking line search.
 * Step d = -J^T (J J^T + rho I)^-1 f is the SMALLEST move that cancels the linearised error, so an under-determined sketch is never pushed along a free direction
 * (a plain damped LM did that: it crept a right triangle's free leg to zero length). Starts from `pts`; it never changes which basin the TS solver chose.
 * Returns {points, worst, iterations}. If `worst` is not tiny afterwards the rules are not satisfiable from this basin.
 */
export function polish(pts0, constraints, pinned = [], { maxIter = 80, tol = 1e-13 } = {}) {
  const n = pts0.length; const start = pts0.map((p) => [p[0], p[1]]);
  const fixed = new Set(pinned.map((p) => ((p % n) + n) % n)); for (const c of constraints) if (c.kind === 'lock') fixed.add(((c.corner % n) + n) % n);
  const free = []; for (let i = 0; i < n; i++) if (!fixed.has(i)) free.push(2 * i, 2 * i + 1);
  const scale = diagOf(start);
  const flat0 = []; for (const p of start) flat0.push(p[0], p[1]);
  const expand = (x) => { const all = flat0.slice(); free.forEach((k, j) => { all[k] = x[j]; }); return Array.from({ length: n }, (_, i) => [all[2 * i], all[2 * i + 1]]); };
  // lock residual is 0 by construction (locked corners are not unknowns)
  const res = (x) => rowsOf(expand(x), constraints, start, scale);
  const sumsq = (f) => f.reduce((a, v) => a + v * v, 0);
  let x = free.map((k) => flat0[k]); let f = res(x); let cost = sumsq(f); let it = 0;
  for (; it < maxIter && Math.sqrt(cost) > tol; it++) {
    const m = f.length, nn = x.length; const J = Array.from({ length: m }, () => new Array(nn).fill(0));
    for (let j = 0; j < nn; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j])); const xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h;
      const fp = res(xp), fm = res(xm); for (let i = 0; i < m; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
    }
    const A = Array.from({ length: m }, () => new Array(m).fill(0)); let tr = 0;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) { let v = 0; for (let k = 0; k < nn; k++) v += J[a][k] * J[b][k]; A[a][b] = v; if (a === b) tr += v; }
    const rho = 1e-12 * Math.max(tr / Math.max(m, 1), 1e-30);
    for (let a = 0; a < m; a++) A[a][a] += rho;
    const y = solveLin(A, f.map((v) => -v)); if (!y) break;
    const d = new Array(nn).fill(0); for (let k = 0; k < nn; k++) for (let a = 0; a < m; a++) d[k] += J[a][k] * y[a];
    let accepted = false;
    for (let alpha = 1; alpha > 1e-4; alpha /= 2) {
      const xn = x.map((v, i) => v + alpha * d[i]); const fn = res(xn); const cn = sumsq(fn);
      if (cn < cost) { x = xn; f = fn; cost = cn; accepted = true; break; }
    }
    if (!accepted) break;
  }
  return { points: expand(x), worst: Math.max(0, ...f.map(Math.abs)), iterations: it };
}

/**
 * Degrees of freedom of a LEGACY (outline) sketch, which solveSketch does not report: free coordinates (corners that are neither locked nor pinned) minus the rank of the signed
 * rule Jacobian at `pts`. Also the number of dependent rules (rows minus rank) = redundant rules. Needs `pts` to satisfy the rules (call it on the solved points).
 */
import { rankOf } from './indep.mjs';
export function legacyDof(pts, constraints, pinned = []) {
  const n = pts.length; const fixed = new Set(pinned.map((p) => ((p % n) + n) % n)); for (const c of constraints) if (c.kind === 'lock') fixed.add(((c.corner % n) + n) % n);
  const free = []; for (let i = 0; i < n; i++) if (!fixed.has(i)) free.push(2 * i, 2 * i + 1);
  const flat0 = []; for (const p of pts) flat0.push(p[0], p[1]);
  const expand = (x) => { const all = flat0.slice(); free.forEach((k, j) => { all[k] = x[j]; }); return Array.from({ length: n }, (_, i) => [all[2 * i], all[2 * i + 1]]); };
  const res = (x) => rowsOf(expand(x), constraints, pts);
  const x0 = free.map((k) => flat0[k]); const f0 = res(x0); const J = f0.map(() => new Array(x0.length).fill(0));
  for (let j = 0; j < x0.length; j++) { const h = 1e-6 * Math.max(1, Math.abs(x0[j])); const xp = x0.slice(), xm = x0.slice(); xp[j] += h; xm[j] -= h; const fp = res(xp), fm = res(xm); for (let i = 0; i < f0.length; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h); }
  const rk = rankOf(J, 1e-7);
  return { dof: x0.length - rk, unknowns: x0.length, rank: rk, rules: f0.length, dependentRules: f0.length - rk };
}
