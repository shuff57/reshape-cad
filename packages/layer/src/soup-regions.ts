// TypeScript port of docs/spikes/solidcraft-referee/contract/soup-regions.mjs (extrude-pocket group). Even-odd profile picks for a
// multi-loop soup sketch. Pure 2-D arithmetic on the rows; no kernel. Behaviour-preserving.
//
// solidcraft's solid.extrude with no `profiles` takes ALL profiles, so a loop standing inside another fills its hole again. The language
// rule is even-odd: depth 0 is material, 1 a hole, 2 material again; shapes side by side are separate pieces; shapes that cross or touch
// are refused. This reads the loops out of the (solved) soup rows, applies the rules and returns one interior point per material region.
import type { SketchFeature } from '@shuff57/reshape-script/model-types';
import type { V2 } from './types.js';

const STEP = Math.PI / 720; // 0.25 degree
// mm: ends this close are chained into one loop. What counts as JOINED is decided in front of this, by the open-outline pre-flight (open-outline.ts: the same
// point within 1e-9, or a coincident rule), which refuses a pull or pocket of a soup with a loose end before this picker runs.
const JOIN_TOL = 1e-5;
const TOUCH_TOL = 1e-3;
const near = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= JOIN_TOL;

/** A soup row as this module reads it (the original reads these fields unguarded, so a malformed row fails the same way). */
interface Row { k: string; id: number; a: V2; b: V2; c: V2; r: number; sense?: string; construction?: boolean }
interface Open { id: number; pts: V2[]; a: V2; b: V2 }
export interface SoupLoop { poly: V2[]; ids: number[]; circle?: true }
export type LoopsResult = { loops: SoupLoop[] } | { sentence: string };
export type PicksResult =
  | { sentence: string }
  | { picks: V2[]; loops: number; depths: number[]; polys: V2[][] };

function arcPoints(g: Row): V2[] {
  const a0 = Math.atan2(g.a[1] - g.c[1], g.a[0] - g.c[0]);
  const a1 = Math.atan2(g.b[1] - g.c[1], g.b[0] - g.c[0]);
  const TAU = Math.PI * 2;
  let sweep = (((a1 - a0) % TAU) + TAU) % TAU; // ccw
  if (g.sense === 'cw') sweep = sweep === 0 ? -TAU : sweep - TAU;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / STEP));
  const r = Math.hypot(g.a[0] - g.c[0], g.a[1] - g.c[1]);
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) { const t = a0 + sweep * i / n; out.push([g.c[0] + r * Math.cos(t), g.c[1] + r * Math.sin(t)]); }
  out[0] = [g.a[0], g.a[1]]; out[n] = [g.b[0], g.b[1]];
  return out;
}
function circlePoints(g: Row): V2[] {
  const n = Math.ceil(2 * Math.PI / STEP);
  return Array.from({ length: n }, (_, i) => [g.c[0] + g.r * Math.cos(2 * Math.PI * i / n), g.c[1] + g.r * Math.sin(2 * Math.PI * i / n)]);
}
function inside(poly: V2[], p: V2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(p: V2, q: V2, r: V2, s: V2): number {
  const o = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p, q, r); const d2 = o(p, q, s); const d3 = o(r, s, p); const d4 = o(r, s, q);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pt = (a: V2, b: V2, c: V2) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l)) : 0; return Math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1]); };
  return Math.min(pt(p, q, r), pt(p, q, s), pt(r, s, p), pt(r, s, q));
}
function polyDist(A: V2[], B: V2[], cap: number): number {
  let best = Infinity;
  const bb = (P: V2[]) => P.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
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

/** loops of a soup: [{poly, ids}] or {sentence} */
export function soupLoops(sk: SketchFeature): LoopsResult {
  const rows = ((sk.geoms ?? []) as unknown as Row[]).filter((g) => !g.construction && g.k !== 'point');
  const loops: SoupLoop[] = [];
  const open: Open[] = [];
  for (const g of rows) {
    if (g.k === 'circle') loops.push({ poly: circlePoints(g), ids: [g.id], circle: true });
    else if (g.k === 'line') open.push({ id: g.id, pts: [g.a, g.b], a: g.a, b: g.b });
    else if (g.k === 'arc') open.push({ id: g.id, pts: arcPoints(g), a: g.a, b: g.b });
    else return { sentence: `sketch ${sk.id} has a ${g.k} drawn in it, which a pull does not read as an outline` };
  }
  const used = new Set<number>();
  const take = (pt: V2) => open.filter((x) => !used.has(x.id) && (near(x.a, pt) || near(x.b, pt)));
  for (const e of open) {
    if (used.has(e.id)) continue;
    used.add(e.id);
    let pts = e.pts.slice();
    let tail = e.b;
    const ids = [e.id];
    while (!near(tail, e.a)) {
      const cand = take(tail);
      const at = `[${tail.map((v) => +v.toFixed(3)).join(', ')}]`;
      if (cand.length === 0) return { sentence: `sketch ${sk.id} has an edge that does not close into a loop (a loose end near ${at}), so it has no outline to pull` };
      if (cand.length > 1) return { sentence: `sketch ${sk.id} has more than two edges meeting near ${at}, so it has no single outline to pull` };
      const x = cand[0]; used.add(x.id); ids.push(x.id);
      const fwd = near(x.a, tail);
      pts = pts.concat((fwd ? x.pts : x.pts.slice().reverse()).slice(1));
      tail = fwd ? x.b : x.a;
    }
    pts.pop();
    loops.push({ poly: pts, ids });
  }
  return { loops };
}

/** Even-odd picks: {picks, loops: n, depths, polys} or {sentence}. */
export function evenOddPicks(sk: SketchFeature): PicksResult {
  const got = soupLoops(sk);
  if ('sentence' in got) return got;
  const loops = got.loops;
  if (loops.length === 0) return { sentence: `sketch ${sk.id} has no closed outline to pull` };
  for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
    const d = polyDist(loops[i].poly, loops[j].poly, TOUCH_TOL);
    if (d <= TOUCH_TOL) return { sentence: `two shapes in sketch ${sk.id} cross or touch each other, so there is no single outline to pull; move them apart or draw one shape` };
  }
  // a loop that crosses itself
  for (const L of loops) {
    if (L.circle) continue; // one circle row cannot cross itself
    const n = L.poly.length;
    if (n > 2000) continue;
    for (let i = 0; i < n; i++) {
      const p = L.poly[i]; const q = L.poly[(i + 1) % n];
      const lox = Math.min(p[0], q[0]); const hix = Math.max(p[0], q[0]); const loy = Math.min(p[1], q[1]); const hiy = Math.max(p[1], q[1]);
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const r = L.poly[j]; const t = L.poly[(j + 1) % n];
        if (Math.max(r[0], t[0]) < lox || Math.min(r[0], t[0]) > hix || Math.max(r[1], t[1]) < loy || Math.min(r[1], t[1]) > hiy) continue;
        if (segDist(p, q, r, t) === 0) return { sentence: `a shape in sketch ${sk.id} crosses itself, so it has no outline to pull` };
      }
    }
  }
  const depth = loops.map((L, i) => loops.reduce((c, M, j) => c + (j !== i && inside(M.poly, L.poly[0]) ? 1 : 0), 0));
  const picks: V2[] = [];
  loops.forEach((L, i) => {
    if (depth[i] % 2 !== 0) return;
    const ys = L.poly.map((p) => p[1]);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    for (const f of [0.5, 0.37, 0.63, 0.23, 0.77, 0.11, 0.89, 0.05, 0.95, 0.31, 0.69]) {
      const y = y0 + (y1 - y0) * f;
      const xs: number[] = [];
      for (const M of loops) for (let k = 0; k < M.poly.length; k++) {
        const p = M.poly[k]; const q = M.poly[(k + 1) % M.poly.length];
        if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) {
        if (xs[k + 1] - xs[k] < 1e-4) continue;
        const m: V2 = [(xs[k] + xs[k + 1]) / 2, y];
        const holders = loops.reduce((c, M) => c + (inside(M.poly, m) ? 1 : 0), 0);
        if (holders === depth[i] + 1 && inside(L.poly, m)) { picks.push([+m[0].toFixed(6), +m[1].toFixed(6)]); return; }
      }
    }
  });
  if (picks.length !== depth.filter((d) => d % 2 === 0).length) return { sentence: `could not find an interior point of every region of sketch ${sk.id}; it is not pulled` };
  return { picks, loops: loops.length, depths: depth, polys: loops.map((L) => L.poly) };
}
