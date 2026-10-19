// INDEPENDENT oracle for a soup sketch: its own residuals (signed), its own Levenberg-Marquardt, its own numeric Jacobian rank.
// Shares no code with brep-rs, solidcraft or packages/sketch. Answers: is the rule set satisfiable (conflicting?), how many
// degrees of freedom does the solved geometry have (n unknowns - rank J), how many rows are dependent (rows - rank J).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

/** unknown layout: per geom a slice of x */
function layout(geoms) {
  let n = 0; const off = new Map();
  for (const g of geoms) { off.set(g.id, n); n += g.k === 'point' ? 2 : g.k === 'line' ? 4 : g.k === 'circle' ? 3 : 7; }
  return { n, off };
}
function pack(geoms, off, n) {
  const x = new Array(n).fill(0);
  for (const g of geoms) {
    const o = off.get(g.id);
    if (g.k === 'point') { x[o] = g.p[0]; x[o + 1] = g.p[1]; }
    else if (g.k === 'line') { x[o] = g.a[0]; x[o + 1] = g.a[1]; x[o + 2] = g.b[0]; x[o + 3] = g.b[1]; }
    else if (g.k === 'circle') { x[o] = g.c[0]; x[o + 1] = g.c[1]; x[o + 2] = g.r; }
    else { x[o] = g.c[0]; x[o + 1] = g.c[1]; x[o + 2] = g.r; x[o + 3] = g.a[0]; x[o + 4] = g.a[1]; x[o + 5] = g.b[0]; x[o + 6] = g.b[1]; }
  }
  return x;
}
export function unpack(geoms, off, x) {
  return geoms.map((g) => {
    const o = off.get(g.id);
    if (g.k === 'point') return { ...g, p: [x[o], x[o + 1]] };
    if (g.k === 'line') return { ...g, a: [x[o], x[o + 1]], b: [x[o + 2], x[o + 3]] };
    if (g.k === 'circle') return { ...g, c: [x[o], x[o + 1]], r: x[o + 2] };
    return { ...g, c: [x[o], x[o + 1]], r: x[o + 2], a: [x[o + 3], x[o + 4]], b: [x[o + 5], x[o + 6]] };
  });
}

/** build residual function; returns {n, x0, res(x)->number[], rowRule: rule index (or -1 for implicit) per row} or {unsupported} */
export function build(geoms, rules) {
  const { n, off } = layout(geoms);
  const x0 = pack(geoms, off, n);
  const byId = new Map(geoms.map((g) => [g.id, g]));
  const start = new Map(geoms.map((g) => [g.id, g]));
  const rows = []; // {rule, f:(G)=>number[]}
  const pt = (G, id, end, lock) => {
    if (id === -1) return [0, 0];
    const g = G.get(id);
    if (g.k === 'point') return g.p;
    if (g.k === 'line') return end === 'b' ? g.b : g.a;
    if (g.k === 'circle') return g.c;
    return end === 'c' ? g.c : end === 'b' ? g.b : lock ? g.c : g.a;
  };
  const dirOf = (G, id) => (id === -2 ? [1, 0] : id === -3 ? [0, 1] : sub(G.get(id).b, G.get(id).a));
  const lenOf = (G, id) => { const g = G.get(id); return g.k === 'line' ? len(sub(g.b, g.a)) : g.r; };
  // implicit arc equations
  for (const g of geoms) if (g.k === 'arc') rows.push({ rule: -1, f: (G) => { const a = G.get(g.id); return [len(sub(a.a, a.c)) - a.r, len(sub(a.b, a.c)) - a.r]; } });
  rules.forEach((r, i) => {
    if (r.active === false) return;
    const push = (f) => rows.push({ rule: i, f });
    switch (r.k) {
      case 'coincident': push((G) => sub(pt(G, r.a, r.aEnd), pt(G, r.b, r.bEnd))); break;
      case 'pointOnObject': push((G) => {
        const p = pt(G, r.a, r.aEnd);
        if (r.b === -2) return [p[1]]; if (r.b === -3) return [p[0]];
        const g = G.get(r.b);
        if (g.k === 'line') return [cross(sub(g.b, g.a), sub(p, g.a)) / len(sub(g.b, g.a))];
        return [len(sub(p, g.c)) - g.r];
      }); break;
      case 'horizontal': push((G) => { const g = G.get(r.a); return [g.a[1] - g.b[1]]; }); break;
      case 'vertical': push((G) => { const g = G.get(r.a); return [g.a[0] - g.b[0]]; }); break;
      case 'parallel': push((G) => { const a = dirOf(G, r.a), b = dirOf(G, r.b); return [cross(a, b) / (len(a) * len(b))]; }); break;
      case 'perpendicular': push((G) => { const a = dirOf(G, r.a), b = dirOf(G, r.b); return [dot(a, b) / (len(a) * len(b))]; }); break;
      case 'equal': push((G) => [lenOf(G, r.a) - lenOf(G, r.b)]); break;
      case 'distance': push((G) => [len(sub(pt(G, r.a, r.aEnd), pt(G, r.b, r.bEnd))) - r.value]); break;
      case 'distanceX': push((G) => [pt(G, r.b, r.bEnd)[0] - pt(G, r.a, r.aEnd)[0] - r.value]); break;
      case 'distanceY': push((G) => [pt(G, r.b, r.bEnd)[1] - pt(G, r.a, r.aEnd)[1] - r.value]); break;
      case 'radius': push((G) => [G.get(r.a).r - r.value]); break;
      case 'diameter': push((G) => [2 * G.get(r.a).r - r.value]); break;
      case 'angle': push((G) => {
        const a = dirOf(G, r.a), b = dirOf(G, r.b);
        const d = (Math.atan2(cross(a, b), dot(a, b)) * 180) / Math.PI - r.value;
        const w = ((d % 180) + 270) % 180 - 90; // wrap to [-90,90): lines have no direction
        return [(w * Math.PI) / 180];
      }); break;
      case 'lock': { const s = start.get(r.a); const p0 = pt(start, r.a, r.aEnd, true); void s; push((G) => sub(pt(G, r.a, r.aEnd, true), p0)); break; }
      case 'symmetric': push((G) => {
        const a = pt(G, r.a, r.aEnd), b = pt(G, r.b, r.bEnd);
        if (r.cEnd !== undefined) { const c = pt(G, r.c, r.cEnd); return [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]]; }
        const d = dirOf(G, r.c); const o = r.c === -2 || r.c === -3 ? [0, 0] : G.get(r.c).a; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return [cross(d, sub(m, o)) / len(d), dot(d, sub(b, a)) / len(d)];
      }); break;
      case 'tangent': {
        push((G) => {
          const ga = G.get(r.a), gb = G.get(r.b);
          const round = (g) => g.k === 'circle' || g.k === 'arc';
          if (r.aEnd !== undefined && r.bEnd !== undefined) {
            const P = pt(G, r.a, r.aEnd);
            if (ga.k === 'line' || gb.k === 'line') { const Lg = ga.k === 'line' ? ga : gb, C = ga.k === 'line' ? gb : ga; const d = sub(Lg.b, Lg.a); return [dot(sub(P, C.c), d) / len(d)]; }
            const u = sub(P, ga.c), v = sub(P, gb.c); return [cross(u, v) / Math.max(len(u) + len(v), 1e-12)];
          }
          if (round(ga) && round(gb)) { const d = len(sub(ga.c, gb.c)); return [r.mode === 'internal' ? d - Math.abs(ga.r - gb.r) : d - (ga.r + gb.r)]; }
          const Lg = ga.k === 'line' ? ga : gb, C = ga.k === 'line' ? gb : ga;
          return [Math.abs(cross(sub(Lg.b, Lg.a), sub(C.c, Lg.a))) / len(sub(Lg.b, Lg.a)) - C.r];
        }); break;
      }
      default: rows.unsupported = (rows.unsupported ?? []).concat(r.k);
    }
  });
  if (rows.unsupported) return { unsupported: rows.unsupported };
  const res = (x) => { const G = new Map(unpack(geoms, off, x).map((g) => [g.id, g])); return rows.flatMap((rw) => rw.f(G)); };
  const rowRule = rows.flatMap((rw) => { const k = rw.f(new Map(unpack(geoms, off, x0).map((g) => [g.id, g]))).length; return Array(k).fill(rw.rule); });
  return { n, x0, res, rowRule, off };
}

function jac(res, x) {
  const f0 = res(x); const m = f0.length; const n = x.length;
  const J = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]));
    const xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h;
    const fp = res(xp), fm = res(xm);
    for (let i = 0; i < m; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  return { J, f0 };
}
/** rank by Gaussian elimination with full pivoting, relative tolerance */
export function rankOf(Jin, tol = 1e-6) {
  const A = Jin.map((r) => r.slice()); const m = A.length; const n = m ? A[0].length : 0;
  let mx = 0; for (const r of A) for (const v of r) mx = Math.max(mx, Math.abs(v));
  if (mx === 0) return 0;
  let rank = 0; const rowsUsed = new Array(m).fill(false); const colsUsed = new Array(n).fill(false);
  for (;;) {
    let best = 0, bi = -1, bj = -1;
    for (let i = 0; i < m; i++) if (!rowsUsed[i]) for (let j = 0; j < n; j++) if (!colsUsed[j] && Math.abs(A[i][j]) > best) { best = Math.abs(A[i][j]); bi = i; bj = j; }
    if (bi < 0 || best < tol * mx) break;
    rowsUsed[bi] = true; colsUsed[bj] = true; rank++;
    for (let i = 0; i < m; i++) if (!rowsUsed[i]) { const f = A[i][bj] / A[bi][bj]; if (f !== 0) for (let j = 0; j < n; j++) A[i][j] -= f * A[bi][j]; }
  }
  return rank;
}
function solveLin(A, b) { // gaussian, partial pivot
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
/** Levenberg-Marquardt from x0. */
export function lm(res, x0, iters = 400) {
  let x = x0.slice(); let lam = 1e-3; let f = res(x); let cost = f.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < iters && cost > 1e-24; it++) {
    const { J } = jac(res, x); const n = x.length;
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0)); const Jtf = new Array(n).fill(0);
    for (let i = 0; i < J.length; i++) for (let a = 0; a < n; a++) { if (J[i][a] === 0) continue; Jtf[a] += J[i][a] * f[i]; for (let b = 0; b < n; b++) JtJ[a][b] += J[i][a] * J[i][b]; }
    let improved = false;
    for (let t = 0; t < 12; t++) {
      const A = JtJ.map((r, a) => r.map((v, b) => v + (a === b ? lam * (v || 1) : 0)));
      const d = solveLin(A, Jtf.map((v) => -v));
      if (!d) { lam *= 10; continue; }
      const xn = x.map((v, i) => v + d[i]); const fn = res(xn); const cn = fn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; f = fn; cost = cn; lam = Math.max(lam / 5, 1e-12); improved = true; break; }
      lam *= 8;
    }
    if (!improved) break;
  }
  return { x, cost, maxRes: Math.max(0, ...f.map(Math.abs)) };
}

/** Full analysis. */
export function analyse(geoms, rules) {
  const b = build(geoms, rules);
  if (b.unsupported) return { unsupported: b.unsupported };
  const sol = lm(b.res, b.x0);
  const consistent = sol.maxRes < 1e-7;
  const { J } = jac(b.res, sol.x);
  const rk = rankOf(J);
  return { consistent, maxRes: sol.maxRes, unknowns: b.n, rows: J.length, rank: rk, dof: b.n - rk, dependentRows: J.length - rk,
    solved: unpack(geoms, b.off, sol.x), b, x: sol.x };
}
