// sketch-geometry solve (round 5). A small, self-contained least-squares solver for soup sketches (.geom rows + rules), with NO kernel and NO brep-rs.
//
// Why it exists: the round-4 guard read "solved rows" from brep-rs' sketch session (archive/brep-rs, retired). The shipped host reads SolidCraft's own solve
// through the @sketch probe of phase2/wrapper2, which the pre-built referee pkg does not expose. This module is the third thing: an independent solve of the
// same rows, started from the rows as typed (what a solver started from the typed sketch converges to nearby), that reports
//   solved    the rows after the solve
//   residual  the largest rule residual BEFORE the solve (mm; 0 means the typed rows already obey every rule and no solver can move them)
//   moved     the largest distance any row moved to obey the rules
//   rank/dof  rank of the Jacobian of the rules at the solution, and (parameters - rank) = how many ways the shape could still slide, resize or turn
//   residualAfter, converged
// A guard rule built on it: if the rules move the rows (moved > tol) and dof > 0, the final shape is a solver's choice -> refuse, in one sentence.
//
// It is NOT a substitute for the host's solver. It is the independent computation the contract needs: where it and SolidCraft's truck disagree on an
// underdetermined sketch, that disagreement is the finding. The rule semantics (signed here) mirror phase7/pane/lib/rule-check.mjs, which checks them with abs().

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

/** parameter layout: id -> { kind, off } and the flat vector */
function layout(geoms) {
  const slot = new Map(); let n = 0; const x = [];
  const push = (...v) => { x.push(...v); n += v.length; };
  for (const g of geoms) {
    slot.set(g.id, { g, off: n });
    if (g.k === 'point') push(g.p[0], g.p[1]);
    else if (g.k === 'line') push(g.a[0], g.a[1], g.b[0], g.b[1]);
    else if (g.k === 'circle') push(g.c[0], g.c[1], g.r);
    else if (g.k === 'arc') push(g.c[0], g.c[1], g.r ?? Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]), g.a[0], g.a[1], g.b[0], g.b[1]);
  }
  return { slot, x, n };
}
function view(slot, x) {
  const get = (id) => {
    const s = slot.get(id); if (!s) return null; const o = s.off; const g = s.g;
    if (g.k === 'point') return { k: 'point', p: [x[o], x[o + 1]] };
    if (g.k === 'line') return { k: 'line', a: [x[o], x[o + 1]], b: [x[o + 2], x[o + 3]] };
    if (g.k === 'circle') return { k: 'circle', c: [x[o], x[o + 1]], r: x[o + 2] };
    return { k: 'arc', c: [x[o], x[o + 1]], r: x[o + 2], a: [x[o + 3], x[o + 4]], b: [x[o + 5], x[o + 6]] };
  };
  return get;
}
const pointOf = (g, end, lock = false) => {
  if (!g) return null;
  if (g.k === 'point') return g.p;
  if (g.k === 'line') return end === 'b' ? g.b : g.a;
  if (g.k === 'circle') return g.c;
  return end === 'c' ? g.c : end === 'b' ? g.b : lock ? g.c : g.a;
};
const lenOf = (g) => (g.k === 'line' ? len(sub(g.b, g.a)) : g.r);

/** Signed residual vector of the rules (and the arcs' own on-circle rows) at x. `start` = geoms as typed (for lock and for the side of tangent / angle). */
function residuals(geoms, rules, slot, x, start, sides) {
  const get = view(slot, x);
  const out = [];
  const P = (id, end, lock) => (id === -1 ? [0, 0] : pointOf(get(id), end, lock));
  // an arc's ends sit on its circle
  for (const g of geoms) if (g.k === 'arc') { const a = get(g.id); out.push(len(sub(a.a, a.c)) - a.r, len(sub(a.b, a.c)) - a.r); }
  rules.forEach((r, i) => {
    if (r.active === false || r.driving === false) return;
    const ga = r.a >= 0 ? get(r.a) : null; const gb = r.b >= 0 ? get(r.b) : null;
    switch (r.k) {
      case 'coincident': { const d = sub(P(r.a, r.aEnd), P(r.b, r.bEnd)); out.push(d[0], d[1]); break; }
      case 'pointOnObject': {
        const p = P(r.a, r.aEnd);
        if (r.b === -2) out.push(p[1]); else if (r.b === -3) out.push(p[0]);
        else if (gb.k === 'line') out.push(cross(sub(gb.b, gb.a), sub(p, gb.a)) / Math.max(len(sub(gb.b, gb.a)), 1e-12));
        else out.push(len(sub(p, gb.c)) - gb.r);
        break;
      }
      case 'horizontal': out.push(ga.a[1] - ga.b[1]); break;
      case 'vertical': out.push(ga.a[0] - ga.b[0]); break;
      case 'parallel': case 'perpendicular': {
        const da = r.a < 0 ? (r.a === -2 ? [1, 0] : [0, 1]) : sub(ga.b, ga.a);
        const db = r.b < 0 ? (r.b === -2 ? [1, 0] : [0, 1]) : sub(gb.b, gb.a);
        const s = Math.max(len(da) * len(db), 1e-12);
        out.push((r.k === 'parallel' ? cross(da, db) : dot(da, db)) / s);
        break;
      }
      case 'equal': out.push(lenOf(ga) - lenOf(gb)); break;
      case 'tangent': {
        const round = (g) => g.k === 'circle' || g.k === 'arc';
        if (r.aEnd !== undefined && r.bEnd !== undefined && ga.k !== 'circle' && gb.k !== 'circle') {
          const Pt = pointOf(ga, r.aEnd);
          if (ga.k === 'line' || gb.k === 'line') {
            const L = ga.k === 'line' ? ga : gb; const C = ga.k === 'line' ? gb : ga; const d = sub(L.b, L.a);
            out.push(dot(sub(Pt, C.c), d) / Math.max(len(d), 1e-12));
          } else { const u = sub(Pt, ga.c); const v = sub(Pt, gb.c); out.push(cross(u, v) / Math.max(len(u) + len(v), 1e-12)); }
          break;
        }
        if (round(ga) && round(gb)) {
          const d = len(sub(ga.c, gb.c));
          out.push(sides[i] === 'internal' ? d - Math.abs(ga.r - gb.r) : d - (ga.r + gb.r));
        } else {
          const L = ga.k === 'line' ? ga : gb; const C = ga.k === 'line' ? gb : ga;
          const sd = cross(sub(L.b, L.a), sub(C.c, L.a)) / Math.max(len(sub(L.b, L.a)), 1e-12);
          out.push((sides[i] ?? 1) * sd - C.r);
        }
        break;
      }
      case 'symmetric': {
        const a = P(r.a, r.aEnd); const b = P(r.b, r.bEnd);
        if (r.cEnd !== undefined) { const c = P(r.c, r.cEnd); out.push((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]); }
        else {
          const L = r.c === -2 ? { a: [0, 0], b: [1, 0] } : r.c === -3 ? { a: [0, 0], b: [0, 1] } : get(r.c);
          const d = sub(L.b, L.a); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const ld = Math.max(len(d), 1e-12);
          out.push(cross(d, sub(m, L.a)) / ld, dot(d, sub(b, a)) / ld);
        }
        break;
      }
      case 'distance': out.push(len(sub(P(r.a, r.aEnd), P(r.b, r.bEnd))) - r.value); break;
      case 'distanceX': out.push(P(r.b, r.bEnd)[0] - P(r.a, r.aEnd)[0] - r.value); break;
      case 'distanceY': out.push(P(r.b, r.bEnd)[1] - P(r.a, r.aEnd)[1] - r.value); break;
      case 'radius': out.push(ga.r - r.value); break;
      case 'diameter': out.push(2 * ga.r - r.value); break;
      case 'angle': {
        const da = sub(ga.b, ga.a); const db = sub(gb.b, gb.a);
        const ang = (Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI;
        let d = (ang - r.value) % 180; if (d > 90) d -= 180; if (d < -90) d += 180;
        out.push(d * (Math.PI / 180) * Math.max(len(da), len(db), 1));
        break;
      }
      case 'lock': {
        const s = start.get(r.a); if (!s) break;
        const a = pointOf(get(r.a), r.aEnd, true); const b = pointOf(s, r.aEnd, true);
        out.push(a[0] - b[0], a[1] - b[1]);
        break;
      }
      default: break;
    }
  });
  return out;
}
/** which side of a tangent the typed rows are on (so a solve keeps the side the student drew) */
function sidesOf(geoms, rules, slot, x) {
  const get = view(slot, x); const sides = {};
  rules.forEach((r, i) => {
    if (r.k !== 'tangent' || (r.aEnd !== undefined && r.bEnd !== undefined)) return;
    const ga = get(r.a); const gb = get(r.b);
    const round = (g) => g.k === 'circle' || g.k === 'arc';
    if (round(ga) && round(gb)) { const d = len(sub(ga.c, gb.c)); sides[i] = Math.abs(d - Math.abs(ga.r - gb.r)) < Math.abs(d - (ga.r + gb.r)) ? 'internal' : 'external'; }
    else { const L = ga.k === 'line' ? ga : gb; const C = ga.k === 'line' ? gb : ga; sides[i] = cross(sub(L.b, L.a), sub(C.c, L.a)) >= 0 ? 1 : -1; }
  });
  return sides;
}

function jacobian(f, x, h) {
  const r0 = f(x); const m = r0.length; const n = x.length; const J = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const xp = x.slice(); const xm = x.slice(); const hj = h * Math.max(1, Math.abs(x[j])); xp[j] += hj; xm[j] -= hj;
    const rp = f(xp); const rm = f(xm);
    for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * hj);
  }
  return { r0, J };
}
function solveLinear(A, b) { // Gaussian elimination with partial pivoting; A is n x n (modified)
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let q = r + 1; q < n; q++) s -= M[r][q] * x[q]; x[r] = s / M[r][r]; }
  return x;
}
/** singular values of J (m x n) by one-sided Jacobi on the columns */
function singularValues(J) {
  const m = J.length; const n = J[0]?.length ?? 0; if (!m || !n) return [];
  const U = Array.from({ length: n }, (_, j) => J.map((row) => row[j])); // columns
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      let a = 0, b = 0, c = 0; for (let i = 0; i < m; i++) { a += U[p][i] * U[p][i]; b += U[q][i] * U[q][i]; c += U[p][i] * U[q][i]; }
      if (Math.abs(c) < 1e-15 * Math.sqrt(a * b) || c === 0) continue;
      off = Math.max(off, Math.abs(c) / Math.sqrt(a * b));
      const zeta = (b - a) / (2 * c); const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta)); const cs = 1 / Math.sqrt(1 + t * t); const sn = cs * t;
      for (let i = 0; i < m; i++) { const up = U[p][i]; const uq = U[q][i]; U[p][i] = cs * up - sn * uq; U[q][i] = sn * up + cs * uq; }
    }
    if (off < 1e-14) break;
  }
  return U.map((col) => Math.sqrt(col.reduce((s, v) => s + v * v, 0))).sort((a, b) => b - a);
}

/**
 * Solve a soup. `soup` = { geoms, rules }. Returns { solved, residual, residualAfter, moved, rank, dof, params, converged, unsupported? }.
 * `solved` has the same row shape as the input (arc rows keep a/b/c/r and sense).
 */
export function solveSoup(soup, opts = {}) {
  const geoms = soup.geoms; const rules = (soup.rules ?? []).filter((r) => r.active !== false);
  const { slot, x: x0, n } = layout(geoms);
  const start = new Map(geoms.map((g) => [g.id, g]));
  const sides = sidesOf(geoms, rules, slot, x0);
  const known = new Set(['coincident', 'pointOnObject', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'tangent', 'symmetric', 'distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle', 'lock']);
  const bad = rules.find((r) => !known.has(r.k));
  if (bad) return { unsupported: `rule kind ${bad.k}`, solved: geoms, residual: null, moved: null, dof: null };
  const scale = Math.max(1, ...x0.map(Math.abs));
  const f = (x) => residuals(geoms, rules, slot, x, start, sides);
  const norm = (r) => Math.max(0, ...r.map(Math.abs));
  let x = x0.slice(); let r = f(x);
  const residual = norm(r);
  const h = 1e-7;
  // ROUND 5: continuation. One LM jump from the drawing to a far-away dimension value can overshoot onto a mirror image or through a degenerate shape; the dimension values are therefore walked
  // from what the drawing measures to what the rules ask in stages (a slider drag), each stage starting from the last. Stage count: a length / radius that changes by a factor k takes ceil(log2 k) stages;
  // an angle 1 per 15 degrees; a signed offset 1 per half sketch size. All rules satisfied already (residual ~ 0): no stages.
  const getStart = view(slot, x0);
  const diag0 = Math.max(1, ...geoms.flatMap((g) => (g.k === 'line' ? [g.a, g.b] : g.k === 'point' ? [g.p] : [g.c, ...(g.a ? [g.a, g.b] : [])])).flat().map(Math.abs));
  const measure = (rr) => {
    const P = (id, end) => (id === -1 ? [0, 0] : pointOf(getStart(id), end));
    try {
      switch (rr.k) {
        case 'distance': return len(sub(P(rr.a, rr.aEnd), P(rr.b, rr.bEnd)));
        case 'distanceX': return P(rr.b, rr.bEnd)[0] - P(rr.a, rr.aEnd)[0];
        case 'distanceY': return P(rr.b, rr.bEnd)[1] - P(rr.a, rr.aEnd)[1];
        case 'radius': return getStart(rr.a).r;
        case 'diameter': return 2 * getStart(rr.a).r;
        case 'angle': { const ga = getStart(rr.a), gb = getStart(rr.b); const da = sub(ga.b, ga.a), db = sub(gb.b, gb.a); return (Math.atan2(cross(da, db), dot(da, db)) * 180) / Math.PI; }
        default: return null;
      }
    } catch { return null; }
  };
  const plan = rules.map((rr) => {
    if (!['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'].includes(rr.k) || rr.driving === false || typeof rr.value !== 'number') return null;
    const v0 = measure(rr); if (v0 === null || !Number.isFinite(v0)) return null;
    const v1 = rr.value;
    if (rr.k === 'angle') { let d = (v1 - v0) % 180; if (d > 90) d -= 180; if (d < -90) d += 180; return { v0, v1: v0 + d, steps: Math.ceil(Math.abs(d) / 15), geo: false }; }
    if (v0 > 0 && v1 > 0 && ['distance', 'radius', 'diameter'].includes(rr.k)) { const k = Math.max(v1 / v0, v0 / v1); return { v0, v1, steps: k > 2 ? Math.ceil(Math.log2(k)) : 1, geo: true }; }
    return { v0, v1, steps: Math.ceil(Math.abs(v1 - v0) / (0.5 * diag0)) || 1, geo: false };
  });
  const K = Math.min(40, Math.max(1, ...plan.map((p) => p?.steps ?? 1)));
  const stageRules = (t) => rules.map((rr, i) => { const p = plan[i]; if (!p || t >= 1) return rr; const v = p.geo ? p.v0 * Math.pow(p.v1 / p.v0, t) : p.v0 + (p.v1 - p.v0) * t; return { ...rr, value: v }; });
  const lm = (fs, xi, iterations) => {
    let xx = xi.slice(); let rr = fs(xx); let lambda = 1e-3; let conv = norm(rr) < 1e-11;
    for (let it = 0; it < iterations && !conv; it++) {
      const { r0, J } = jacobian(fs, xx, h);
      const cost0 = r0.reduce((s2, v) => s2 + v * v, 0);
      const JtJ = Array.from({ length: n }, () => new Array(n).fill(0)); const Jtr = new Array(n).fill(0);
      for (let i = 0; i < J.length; i++) for (let a = 0; a < n; a++) { if (J[i][a] === 0) continue; Jtr[a] += J[i][a] * r0[i]; for (let b = 0; b < n; b++) JtJ[a][b] += J[i][a] * J[i][b]; }
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const A = JtJ.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (1 + v) : 0)));
        const d = solveLinear(A, Jtr.map((v) => -v));
        if (!d) { lambda *= 10; continue; }
        const xn = xx.map((v, i) => v + d[i]); const rn = fs(xn); const cost = rn.reduce((s2, v) => s2 + v * v, 0);
        if (Number.isFinite(cost) && cost < cost0) { xx = xn; rr = rn; lambda = Math.max(lambda / 5, 1e-12); improved = true; break; }
        lambda *= 10;
      }
      if (norm(rr) < 1e-11) conv = true;
      if (!improved) break;
    }
    return { x: xx, r: rr, converged: conv };
  };
  let converged = norm(r) < 1e-11;
  if (!converged) {
    for (let s2 = 1; s2 <= K; s2++) {
      const rs = stageRules(s2 / K);
      const fs = s2 === K ? f : (xx) => residuals(geoms, rs, slot, xx, start, sides);
      const res = lm(fs, x, opts.iterations ?? 200);
      x = res.x;
      if (s2 === K) { r = res.r; converged = res.converged; }
    }
  }
  const residualAfter = norm(f(x));
  // DoF: rank of the Jacobian of the rules at the solution
  const { J } = jacobian(f, x, h);
  const sv = singularValues(J); const top = sv[0] ?? 0;
  const rank = sv.filter((s) => s > 1e-6 * Math.max(top, 1)).length;
  // rebuild solved rows
  const get = view(slot, x);
  const solved = geoms.map((g) => {
    const v = get(g.id);
    if (g.k === 'point') return { ...g, p: v.p };
    if (g.k === 'line') return { ...g, a: v.a, b: v.b };
    if (g.k === 'circle') return { ...g, c: v.c, r: v.r };
    return { ...g, c: v.c, r: v.r, a: v.a, b: v.b };
  });
  let moved = 0;
  for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(x[i] - x0[i]));
  // components: geometry tied together by rules. Only a component the rules actually MOVED has a solver-chosen result, so only its freedoms count.
  const parent = new Map(geoms.map((g) => [g.id, g.id])); const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
  for (const r of rules) { const ids = [r.a, r.b, r.c].filter((q) => typeof q === 'number' && q >= 0 && parent.has(q)); for (let k = 1; k < ids.length; k++) parent.set(find(ids[k]), find(ids[0])); }
  const comps = new Map();
  for (const g of geoms) { const s = slot.get(g.id); const w = g.k === 'point' ? 2 : g.k === 'line' ? 4 : g.k === 'circle' ? 3 : 7; const root = find(g.id); const c = comps.get(root) ?? { ids: [], cols: [], moved: 0 }; c.ids.push(g.id); for (let q = 0; q < w; q++) { c.cols.push(s.off + q); c.moved = Math.max(c.moved, Math.abs(x[s.off + q] - x0[s.off + q])); } comps.set(root, c); }
  let dofMoved = 0; const movedComps = [];
  for (const c of comps.values()) {
    const sub = J.map((row) => c.cols.map((j) => row[j]));
    const rk = singularValues(sub).filter((s) => s > 1e-6 * Math.max(top, 1)).length;
    c.dof = c.cols.length - rk;
    if (c.moved > 1e-6) { dofMoved += c.dof; movedComps.push({ ids: c.ids, moved: c.moved, dof: c.dof }); }
  }
  return { solved, residual, residualAfter, moved, rank, dof: n - rank, dofMoved, movedComps, params: n, converged: converged || residualAfter < 1e-9, scale, stages: K };
}
