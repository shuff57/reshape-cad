// Round 5, group 'sketch-constraints'. The EXPECTED solid of a solved sketch, computed without any kernel: the independent measure the guard compares SolidCraft's build to.
//   expectedSolid(T, height) -> { ok:true, volume, bbox:[x0,y0,z0,x1,y1,z1], com:[x,y,z], bodies, faces|null, picks:[[x,y]], loops, depths, planar }  |  { ok:false, sentence }
// T = solved soup rows (line {a,b}, arc {c,r,a,b,sense}, circle {c,r}, point, construction rows ignored), in the sketch's own (u,v) plane; the solid is the even-odd fill of the closed
// loops (depth 0 = material, 1 = hole, 2 = material again ...), extruded 0..height along the sketch normal. Areas are exact: a polygon of the loop's end points plus one circular segment
// per arc (1/2 r^2 (theta - sin theta)), a circle is pi r^2. The centroid is exact for the same pieces. Crossing / touching / self-crossing loops are refused (soup-regions.mjs).
import { soupLoops } from '../soup-regions.mjs';
import { arcSweep } from './geom.mjs';

const JOIN = 1e-5;
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= JOIN;
const TAU = Math.PI * 2;

/** closed loops as ordered edge lists: [{ circle?:g, edges:[{g, fwd}] }] or { sentence } */
function walk(T) {
  const rows = T.filter((g) => !g.construction && g.k !== 'point');
  const loops = [];
  const open = [];
  for (const g of rows) {
    if (g.k === 'circle') loops.push({ circle: g, edges: [] });
    else if (g.k === 'line' || g.k === 'arc') open.push(g);
    else return { sentence: `Geometry ${g.id} is a ${g.k}, which the sketch cannot draw as an outline.` };
  }
  const used = new Set();
  for (const e of open) {
    if (used.has(e.id)) continue;
    used.add(e.id);
    const edges = [{ g: e, fwd: true }];
    let tail = e.b;
    while (!near(tail, e.a)) {
      const cand = open.filter((x) => !used.has(x.id) && (near(x.a, tail) || near(x.b, tail)));
      if (cand.length === 0) return { sentence: `The outline does not close into a loop (a loose end near [${tail.map((v) => +v.toFixed(3)).join(', ')}]), so there is nothing to extrude; check the rules that join the ends.` };
      const x = cand[0]; used.add(x.id);
      const fwd = near(x.a, tail);
      edges.push({ g: x, fwd });
      tail = fwd ? x.b : x.a;
    }
    loops.push({ edges });
  }
  return { loops };
}
const start = (e) => (e.fwd ? e.g.a : e.g.b);
const end = (e) => (e.fwd ? e.g.b : e.g.a);
/** signed sweep of an arc edge in its direction of travel (ccw positive) */
function sweepOf(e) { const { sw } = arcSweep(e.g); return e.fwd ? sw : -sw; }
/** exact signed area and first moments (integral of x dA, y dA) of a loop */
function loopMoments(L) {
  if (L.circle) { const g = L.circle; const A = Math.PI * g.r * g.r; return { A, mx: A * g.c[0], my: A * g.c[1], pts: [] }; }
  let A = 0, mx = 0, my = 0;
  for (const e of L.edges) {
    const p = start(e), q = end(e);
    const c = p[0] * q[1] - q[0] * p[1];
    A += c / 2; mx += ((p[0] + q[0]) * c) / 6; my += ((p[1] + q[1]) * c) / 6;
    if (e.g.k === 'arc') {
      const th = sweepOf(e), r = Math.hypot(e.g.a[0] - e.g.c[0], e.g.a[1] - e.g.c[1]);
      // circular segment between the chord and the arc: area r^2/2 (th - sin th) (signed), centroid on the bisector at distance 4 r sin^3(th/2) / (3 (th - sin th)) from the centre
      const seg = 0.5 * r * r * (th - Math.sin(th));
      const a0 = Math.atan2(p[1] - e.g.c[1], p[0] - e.g.c[0]);
      const mid = a0 + th / 2;
      const dd = Math.abs(th - Math.sin(th)) < 1e-14 ? r : (4 * r * Math.sin(th / 2) ** 3) / (3 * (th - Math.sin(th)));
      A += seg; mx += seg * (e.g.c[0] + dd * Math.cos(mid)); my += seg * (e.g.c[1] + dd * Math.sin(mid));
    }
  }
  return { A, mx, my };
}
/** exact bbox of a loop */
function loopBox(L) {
  if (L.circle) { const g = L.circle; return [g.c[0] - g.r, g.c[1] - g.r, g.c[0] + g.r, g.c[1] + g.r]; }
  const xs = [], ys = [];
  for (const e of L.edges) {
    xs.push(e.g.a[0], e.g.b[0]); ys.push(e.g.a[1], e.g.b[1]);
    if (e.g.k === 'arc') {
      const { a0, sw } = arcSweep(e.g); const r = Math.hypot(e.g.a[0] - e.g.c[0], e.g.a[1] - e.g.c[1]);
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        const rel = sw >= 0 ? (((ang - a0) % TAU) + TAU) % TAU : (((a0 - ang) % TAU) + TAU) % TAU;
        if (rel <= Math.abs(sw)) { xs.push(e.g.c[0] + r * Math.cos(ang)); ys.push(e.g.c[1] + r * Math.sin(ang)); }
      }
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---- regions (a copy of soup-regions.mjs evenOddPicks with two changes: loops joined by a TANGENT rule may touch, and the nesting depth is a vote of several boundary points, not the first one,
// because a boundary point of an internally tangent circle can sit exactly on the outer circle) ---------------------------------------------------------------------------------------------
const TOUCH_TOL = 1e-3;
function inside(poly, p) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(p, q, r, s) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p, q, r); const d2 = o(p, q, s); const d3 = o(r, s, p); const d4 = o(r, s, q);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (a, b, c) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l)) : 0; return Math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1]); };
  return Math.min(pt(p, q, r), pt(p, q, s), pt(r, s, p), pt(r, s, q));
}
function polyDist(A, B, cap) {
  let best = Infinity;
  const bb = (P) => P.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const a = bb(A); const b = bb(B);
  if (a[0] > b[2] + cap || b[0] > a[2] + cap || a[1] > b[3] + cap || b[1] > a[3] + cap) return Infinity;
  for (let i = 0; i < A.length; i++) {
    const p = A[i]; const q = A[(i + 1) % A.length];
    const lo = [Math.min(p[0], q[0]) - cap, Math.min(p[1], q[1]) - cap]; const hi = [Math.max(p[0], q[0]) + cap, Math.max(p[1], q[1]) + cap];
    for (let j = 0; j < B.length; j++) {
      const r = B[j]; const s = B[(j + 1) % B.length];
      if (Math.min(r[0], s[0]) > hi[0] || Math.max(r[0], s[0]) < lo[0] || Math.min(r[1], s[1]) > hi[1] || Math.max(r[1], s[1]) < lo[1]) continue;
      best = Math.min(best, segDist(p, q, r, s));
      if (best <= 0) return 0;
    }
  }
  return best;
}
/** {picks, loops, depths, polys} or {sentence}. touchOk: list of [geomIdA, geomIdB] pairs (joined by a tangent rule) whose loops may touch. */
function regionsOf(T, touchOk = []) {
  const got = soupLoops({ id: 'sk', geoms: T });
  if (got.sentence) return got;
  const loops = got.loops;
  if (loops.length === 0) return { sentence: 'The sketch has no closed outline to extrude.' };
  const allowed = (i, j) => touchOk.some(([a, b]) => (loops[i].ids.includes(a) && loops[j].ids.includes(b)) || (loops[i].ids.includes(b) && loops[j].ids.includes(a)));
  for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
    if (allowed(i, j)) continue;
    const d = polyDist(loops[i].poly, loops[j].poly, TOUCH_TOL);
    if (d <= TOUCH_TOL) return { sentence: 'Two shapes in the sketch cross or touch each other, so there is no single outline to extrude; move them apart or draw one shape.' };
  }
  for (const L of loops) {
    if (L.circle) continue;
    const n = L.poly.length;
    if (n > 2000) continue;
    for (let i = 0; i < n; i++) {
      const p = L.poly[i]; const q = L.poly[(i + 1) % n];
      const lox = Math.min(p[0], q[0]); const hix = Math.max(p[0], q[0]); const loy = Math.min(p[1], q[1]); const hiy = Math.max(p[1], q[1]);
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const r = L.poly[j]; const t = L.poly[(j + 1) % n];
        if (Math.max(r[0], t[0]) < lox || Math.min(r[0], t[0]) > hix || Math.max(r[1], t[1]) < loy || Math.min(r[1], t[1]) > hiy) continue;
        if (segDist(p, q, r, t) === 0) return { sentence: 'A shape in the sketch crosses itself, so it has no outline to extrude.' };
      }
    }
  }
  // nesting depth = how many OTHER loops contain this one, by a vote of 5 boundary points (a loop is wholly inside or outside another once crossings are excluded)
  const vote = (L, M) => { let c = 0; const n = L.poly.length; for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) if (inside(M.poly, L.poly[Math.min(n - 1, Math.floor(n * f))])) c++; return c >= 3; };
  const depth = loops.map((L, i) => loops.reduce((c, M, j) => c + (j !== i && vote(L, M) ? 1 : 0), 0));
  const picks = [];
  loops.forEach((L, i) => {
    if (depth[i] % 2 !== 0) return;
    const ys = L.poly.map((p) => p[1]);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    for (const f of [0.5, 0.37, 0.63, 0.23, 0.77, 0.11, 0.89, 0.05, 0.95, 0.31, 0.69]) {
      const y = y0 + (y1 - y0) * f;
      const xs = [];
      for (const M of loops) for (let k = 0; k < M.poly.length; k++) {
        const p = M.poly[k]; const q = M.poly[(k + 1) % M.poly.length];
        if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) {
        if (xs[k + 1] - xs[k] < 1e-4) continue;
        const m = [(xs[k] + xs[k + 1]) / 2, y];
        const holders = loops.reduce((c, M) => c + (inside(M.poly, m) ? 1 : 0), 0);
        if (holders === depth[i] + 1 && inside(L.poly, m)) { picks.push([+m[0].toFixed(6), +m[1].toFixed(6)]); return; }
      }
    }
  });
  if (picks.length !== depth.filter((d) => d % 2 === 0).length) return { sentence: 'The sketch has a region whose inside could not be found, so it is not extruded.' };
  return { picks, loops: loops.length, depths: depth };
}

export function expectedSolid(T, height, { touchOk = [] } = {}) {
  const w = walk(T);
  if (w.sentence) return { ok: false, sentence: w.sentence };
  // regions + crossing / touching / self-crossing refusals, by the same code the translator uses for a multi-shape pull
  const eo = regionsOf(T, touchOk);
  if (eo.sentence) return { ok: false, sentence: eo.sentence };
  // evenOddPicks lists loops in soupLoops' order: circles first, then chains in row order; walk() uses the same order
  if (eo.depths.length !== w.loops.length) return { ok: false, sentence: 'The outline could not be read into loops, so nothing was built.' };
  let A = 0, mx = 0, my = 0, box = null, edgesAll = 0, planar = true;
  w.loops.forEach((L, i) => {
    const m = loopMoments(L); const sgn = Math.sign(m.A) || 1; const sign = eo.depths[i] % 2 === 0 ? 1 : -1;
    A += sign * Math.abs(m.A); mx += sign * sgn * m.mx; my += sign * sgn * m.my;
    if (eo.depths[i] === 0) { const b = loopBox(L); box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b; }
    edgesAll += L.circle ? 1 : L.edges.length;
    if (L.circle || L.edges.some((e) => e.g.k === 'arc')) planar = false;
  });
  const bodies = eo.picks.length;
  if (!(A > 0) || !box) return { ok: false, sentence: 'The outline has no solid area to extrude.' };
  return {
    ok: true, volume: A * height, bbox: [box[0], box[1], 0, box[2], box[3], height], com: [mx / A, my / A, height / 2], bodies,
    faces: planar ? edgesAll + 2 * bodies : null, picks: eo.picks, loops: w.loops.length, depths: eo.depths, planar, area: A,
  };
}
