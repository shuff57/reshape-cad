// TypeScript port of docs/spikes/solidcraft-referee/contract/blend-loft.guard.mjs (blend-loft group, round 5; "accepted" in LAYER-CONTRACT.md): the pure half of the group.
// No kernel is named or called. Behaviour-preserving for guardBlend / postCheckBlend: same thresholds, same order of checks, same sentences, same numbers
// (test/blend-loft.differential.test.mjs runs the untouched original against this port). Two additions, each marked ADDED below, close what the group's last
// critic left open ("blend-loft: accepted", Open defects):
//   * NEEDLE: no upper bound on the loft's length against its width for two straight-sided outlines (at length / width >= 1e4 .. 1e6 the kernel drops faces).
//     A loft whose gap is more than NEEDLE_MAX times its sketches' in-plane size is refused.
//   * PRISMATOID: the post-build check covered circle <-> circle only. A ruled loft between two straight-sided outlines with a fixed corner matching has a cross
//     section whose area is quadratic in the height, so Simpson's rule is exact: V = h / 6 (A1 + A2 + 4 Am), Am the area of the outline of the matched corners'
//     midpoints. The guard has already fixed the matching (one parallel matching, the kernel's start-vertex rule agreeing), so every polygon pair it passes is
//     checked against that closed form after the build (prismatoidVolume, postCheckBlend).
//
// The SUPPORTED set (everything else is refused in one sentence):
//   S1 two plain polygons, same corner count, every side parallel (same direction) to its matching side, one unambiguous matching, the kernel's start-vertex rule
//      lands on that matching
//   S2 circle <-> circle
//   S3 regular polygon (4, 5, 6 or 8 corners) with a corner pointing along +u <-> circle
//   S4 axis-aligned rectangle (long side <= 2x short side) <-> circle
//   S5 rounded rectangle (4 equal corners, nearly square) <-> circle
//
// `neutral` (Map sketchId -> the offset the sketch had BEFORE blend() moved it) and `argOrder` (Map blendId -> [first written, second written]) are what the
// doc alone cannot show. The page translates the doc only, so it passes neither: the guard then uses its conservative rule (a sketch a loft uses must not be used
// by any other feature), and the sentences say first / second in the doc's bottom-first order. The interpreter refuses the one case `neutral` exists for (the
// second sketch drawn at a height the gap contradicts) itself, in reshape-script.ts blend().
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { ArcApi } from './types.js';

type P2 = number[];
/** The fields of a sketch / blend the guard reads (a SOLVED doc). */
interface SkView { id: string; kind: string; shape?: string; points?: P2[]; geoms?: unknown[]; frame?: unknown; plane?: string; offset?: number; constraints?: unknown[]; rounds?: unknown }
interface BlView { id: string; kind: string; targets?: string[] }
type Doc = { features: Feature[] };
export interface BlendVerdict { code: string; sentence: string; warp?: number; advice?: { sketch: string; corner: number } | null; d?: number }
export interface BlendGuardCtx { outlineOf: ArcApi['outlineOf']; neutral?: Map<string, number> | null; argOrder?: Map<string, string[]> | null }

export const GAP_MIN = 1e-6;
export const GAP_REL_MIN = 1e-4;
export const RECT_ASPECT_MAX = 2.0;
export const ROUNDED_ASPECT_MAX = 1.1;
export const POLY_CIRCLE_N = [4, 5, 6, 8];
export const CC_TILT_MAX = 5;
export const COARSE_MAX = 40;
export const CIRCLE_R_MIN = 0.5;
export const PC_RATIO_MAX = 15;
export const PC_SIZE_MIN = 0.25;
export const PC_SIZE_MAX = 4;
export const PC_THIN_MIN = 0.3;
export const PC_THIN_MIN_RECT = 1.0;
export const PC_SIZE_MAX_RECT = 2;
export const PAR_TOL = 2e-3;
export const EXACT_PAR_TOL = 1e-9;
export const REG_RADIUS_TOL = 5e-3;
export const REG_ANGLE_TOL = 5e-3;
export const REG_PHASE_TOL = 0.02;
/** ADDED (NEEDLE): the gap may be at most this many times the sketches' in-plane size (diagonal of both outlines' box) for two straight-sided outlines. */
export const NEEDLE_MAX = 1000;
const PLANE_WORD: Record<string, string> = { xy: 'top', xz: 'front', yz: 'side' };
const STARTER: P2[] = [[0, 0], [40, 0], [40, 25], [0, 25]];
const WORDS = ['first', 'second'];
const num = (v: number): string => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

const area2 = (P: P2[]): number => P.reduce((s, a, i) => { const b = P[(i + 1) % P.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
const centroid = (P: P2[]): P2 => {
  let a2 = 0; let cx = 0; let cy = 0;
  P.forEach((p, i) => { const q = P[(i + 1) % P.length]; const k = p[0] * q[1] - q[0] * p[1]; a2 += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; });
  return Math.abs(a2) < 1e-15 ? P[0] : [cx / (3 * a2), cy / (3 * a2)];
};
/** The counter-clockwise loop the kernel ends up with for a list of corners (a clockwise list becomes [P1, P0, Pn-1, ..., P2]; measured, see the original). */
export const ccwLoop = (P: P2[]): P2[] => (area2(P) >= 0 ? P : [P[1], P[0], ...P.slice(2).reverse()]);
const scaleOf = (P: P2[]): number => Math.max(1e-12, ...P.flat().map(Math.abs));

function segsCross(p1: P2, p2: P2, p3: P2, p4: P2): boolean {
  const o = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p3, p4, p1); const d2 = o(p3, p4, p2); const d3 = o(p1, p2, p3); const d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function selfCrossing(P: P2[]): boolean {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return true;
  }
  return false;
}

/** every cyclic shift s of Q (both CCW) for which all side pairs P_i->P_i+1 and Q_i+s->Q_i+s+1 run the SAME direction */
export function parallelShifts(P: P2[], Q: P2[], tol = PAR_TOL): number[] {
  const n = P.length; const out: number[] = [];
  if (Q.length !== n) return out;
  const e = (X: P2[], i: number) => { const a = X[i % n]; const b = X[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  for (let s = 0; s < n; s++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const u = e(P, i); const v = e(Q, i + s);
      const lu = Math.hypot(u[0], u[1]); const lv = Math.hypot(v[0], v[1]);
      if (lu < 1e-12 || lv < 1e-12) { ok = false; break; }
      const cr = u[0] * v[1] - u[1] * v[0]; const d = u[0] * v[0] + u[1] * v[1];
      if (Math.abs(cr) > tol * lu * lv || d <= 0) ok = false;
    }
    if (ok) out.push(s);
  }
  return out;
}

/** smallest over cyclic shifts of the largest sine between matching sides (a shift that turns any side the wrong way scores 9) */
export function parallelDeviation(P: P2[], Q: P2[]): number {
  const n = P.length; if (Q.length !== n) return Infinity;
  const e = (X: P2[], i: number) => { const a = X[i % n]; const b = X[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  let best = Infinity;
  for (let s = 0; s < n; s++) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const u = e(P, i); const v = e(Q, i + s); const lu = Math.hypot(u[0], u[1]); const lv = Math.hypot(v[0], v[1]);
      if (lu < 1e-12 || lv < 1e-12) { m = 9; break; }
      const cr = (u[0] * v[1] - u[1] * v[0]) / (lu * lv); const d = u[0] * v[0] + u[1] * v[1];
      m = Math.max(m, d <= 0 ? 9 : Math.abs(cr));
    }
    best = Math.min(best, m);
  }
  return best;
}

/** The start-vertex rule of the SolidCraft loft (equal corner counts): returns the shift s (P_i pairs with Q_{i+s}) and the angular margin. */
export function truckShift(P: P2[], Q: P2[], leadIsB: boolean): { s: number; margin: number } {
  const n = P.length;
  const ang = (X: P2[], c: P2, k: number) => Math.atan2(X[k][1] - c[1], X[k][0] - c[0]);
  const dist = (a: number, b: number) => { const d = (((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  const cP = centroid(P); const cQ = centroid(Q);
  const lead = leadIsB ? Q : P; const other = leadIsB ? P : Q; const cl = leadIsB ? cQ : cP; const co = leadIsB ? cP : cQ;
  const target = ang(lead, cl, 0);
  const ds = other.map((_, k) => dist(ang(other, co, k), target));
  const order = ds.map((d, k) => [d, k]).sort((a, b) => a[0] - b[0]);
  const k = order[0][1]; const margin = n > 1 ? order[1][0] - order[0][0] : Infinity;
  const s = leadIsB ? ((n - k) % n) : k;
  return { s, margin };
}

const WORLD: Record<string, (c: P2, o: number) => number[]> = { xy: (c, o) => [c[0], c[1], o], xz: (c, o) => [c[0], o, c[1]], yz: (c, o) => [o, c[0], c[1]] };
/** true when the kernel's loft leads with the second (B) section. */
export function leadIsB(plane: string, offA: number, ptsA: P2[], offB: number, ptsB: P2[]): boolean {
  const w = WORLD[plane] ?? WORLD.xy;
  const a = w(centroid(ptsA), offA); const b = w(centroid(ptsB), offB);
  const step = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let big = 0; for (const v of step) if (Math.abs(v) >= Math.abs(big)) big = v;
  return !(big < 0);
}

type Outline = { type: 'circle'; d: number; c: P2 } | { type: 'unreadable' } | { type: 'polygon' | 'arcs'; pts: P2[]; bulges: Record<number, number> };
type Shape = Exclude<Outline, { type: 'unreadable' }>;
type Poly = Extract<Outline, { pts: P2[] }>;
function describeOutline(sk: SkView, outlineOf: BlendGuardCtx['outlineOf']): Outline {
  if (sk.shape === 'circle') {
    const [a, b] = sk.points!; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { type: 'circle', d, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  const o = outlineOf(sk as never) as { ok?: boolean; points: P2[]; bulges?: Record<string, number> } | null;
  if (!o || !o.ok) return { type: 'unreadable' };
  const bulges = Object.entries(o.bulges ?? {}).filter(([, g]) => g);
  return { type: bulges.length ? 'arcs' : 'polygon', pts: o.points.map((p) => [p[0], p[1]]), bulges: Object.fromEntries(bulges.map(([k, g]) => [Number(k), g])) };
}

const isAxisRect = (P: P2[]) => {
  if (P.length !== 4) return null;
  const xs = P.map((p) => p[0]); const ys = P.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
  if (w < 1e-12 || h < 1e-12) return null;
  const tol = 1e-9 * Math.max(w, h);
  for (let i = 0; i < 4; i++) { const a = P[i]; const b = P[(i + 1) % 4]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; }
  const corners = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
  if (!corners.every((c) => P.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= tol))) return null;
  return { w, h, aspect: Math.max(w, h) / Math.min(w, h) };
};
const regularPhase0 = (P: P2[]): boolean => {
  const n = P.length; if (!POLY_CIRCLE_N.includes(n)) return false;
  const c = centroid(P); const r = P.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
  if (Math.max(...r) - Math.min(...r) > REG_RADIUS_TOL * Math.max(...r)) return false;
  const angs = P.map((p) => Math.atan2(p[1] - c[1], p[0] - c[0]));
  const step = 2 * Math.PI / n;
  const sgn = area2(P) >= 0 ? 1 : -1;
  for (let i = 1; i < n; i++) { const d = ((sgn * (angs[i] - angs[i - 1])) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (Math.abs(d - step) > REG_ANGLE_TOL) return false; }
  return angs.some((a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < REG_PHASE_TOL);
};
const roundedRect = (o: Shape) => {
  if (o.type !== 'arcs' || o.pts.length !== 8) return null;
  const idx = Object.keys(o.bulges).map(Number).sort((a, b) => a - b);
  if (idx.length !== 4 || idx.some((v, i) => v !== idx[0] + 2 * i) || (idx[0] !== 0 && idx[0] !== 1)) return null;
  const gs = idx.map((i) => Math.abs(o.bulges[i]));
  if (Math.max(...gs) - Math.min(...gs) > 1e-9 || Math.abs(gs[0] - Math.tan(Math.PI / 8)) > 1e-9) return null;
  const xs = o.pts.map((p) => p[0]); const ys = o.pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
  const straight = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !idx.includes(i));
  const tol = 1e-9 * Math.max(w, h);
  for (const i of straight) { const a = o.pts[i]; const b = o.pts[(i + 1) % 8]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; }
  return { w, h, aspect: Math.max(w, h) / Math.min(w, h) };
};

const extentOf = (o: Shape): number[] => {
  if (o.type === 'circle') { const r = o.d / 2; return [o.c[0] - r, o.c[0] + r, o.c[1] - r, o.c[1] + r]; }
  const xs = o.pts.map((p) => p[0]); const ys = o.pts.map((p) => p[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};
const consumersOf = (doc: Doc, id: string, exceptId: string) => doc.features.filter((f) => f.id !== exceptId && f.id !== id && f.kind !== ('datum' as string)
  && Object.entries(f).some(([k, v]) => k !== 'id' && (v === id || (Array.isArray(v) && v.includes(id)))));

/** Returns null (the loft is in the supported set) or {code, sentence}. `doc` is the SOLVED ModelDoc. */
export function guardBlend(doc: Doc, f0: Feature, { outlineOf, neutral = null, argOrder = null }: BlendGuardCtx): BlendVerdict | null {
  const f = f0 as unknown as BlView;
  const byId = (id: string) => doc.features.find((x) => x.id === id) as unknown as SkView | undefined;
  const argIds = argOrder?.get?.(f.id) ?? null;
  const label = (i: number) => { const k = argIds ? argIds.indexOf(f.targets![i]) : i; return WORDS[k < 0 ? i : k]; };
  const n = f.targets?.length ?? 0;
  if (n !== 2) return { code: 'targets', sentence: `A loft joins exactly two sketches, and this one has ${n === 0 ? 'none' : n === 1 ? 'one' : n}, so choose two.` };
  const sks = f.targets!.map(byId);
  if (sks.some((s) => !s || s.kind !== 'sketch')) return { code: 'not-sketch', sentence: 'A loft needs two sketches, and one of the things given to it is not a sketch.' };
  const sk = sks as SkView[];
  if (sk[0].id === sk[1].id) return { code: 'same', sentence: 'The loft was given the same sketch twice, so both of its ends would be in the same place whatever gap you type; draw a second sketch for the other end.' };
  for (let i = 0; i < 2; i++) if (Array.isArray(sk[i].geoms) && sk[i].geoms!.length > 0 && sk[i].shape !== 'circle') {
    return { code: 'soup', sentence: `The ${label(i)} sketch was drawn with geom() or slot(), and a loft can only use plain outlines (rect, circle or polygon), so redraw it as a plain outline.` };
  }
  for (let i = 0; i < 2; i++) if (sk[i].frame) {
    return { code: 'frame', sentence: `The ${label(i)} sketch is placed with its own origin and direction, which a loft cannot combine with its gap, so draw both sketches on 'top', 'front' or 'side' and give the distance as the gap.` };
  }
  const pl = sk.map((s) => s.plane ?? 'xy');
  if (pl[0] !== pl[1]) return { code: 'planes', sentence: `The two sketches are on different planes ('${PLANE_WORD[pl[0]]}' and '${PLANE_WORD[pl[1]]}'), so there is no single direction to loft along; draw both on the same plane.` };
  for (let i = 0; i < 2; i++) {
    const s = sk[i];
    const starter = s.shape !== 'circle' && s.points?.length === 4 && s.points.every((p, k) => p[0] === STARTER[k][0] && p[1] === STARTER[k][1]) && (s.constraints?.length ?? 0) === 4 && !s.rounds;
    if (starter) return { code: 'undrawn', sentence: `The ${label(i)} sketch has not been drawn yet, so the loft would use the default 40 by 25 rectangle; draw its outline first, for example with rect(20, 20).` };
  }
  const outs: Shape[] = [];
  for (let i = 0; i < 2; i++) {
    const o = describeOutline(sk[i], outlineOf);
    if (o.type === 'unreadable') return { code: 'unreadable', sentence: `The ${label(i)} sketch has no usable outline, so there is nothing to loft; redraw it as a closed shape.` };
    if (o.type === 'circle') { if (!(o.d > 1e-9)) return { code: 'flat', sentence: `The ${label(i)} sketch has no area, so there is nothing to loft to; give it a real size.` }; }
    else {
      const sc = scaleOf(o.pts);
      if (o.type === 'polygon' && o.pts.length >= 4 && selfCrossing(o.pts)) return { code: 'crossing', sentence: `The ${label(i)} sketch crosses itself, so it is not a closed shape; reorder its corners so that no two sides cross.` };
      if (o.pts.length < 3 || Math.abs(area2(o.pts)) < 1e-9 * sc * sc) return { code: 'flat', sentence: `The ${label(i)} sketch has no area (all its points lie on one line), so there is nothing to loft to; give it at least three corners that are not in a row.` };
      if (o.type === 'polygon' && o.pts.some((p, k) => Math.hypot(p[0] - o.pts[(k + 1) % o.pts.length][0], p[1] - o.pts[(k + 1) % o.pts.length][1]) < 1e-9 * sc)) return { code: 'dup', sentence: `Two corners of the ${label(i)} sketch are in the same place, so delete one of them.` };
      if (o.type === 'polygon' && selfCrossing(o.pts)) return { code: 'crossing', sentence: `The ${label(i)} sketch crosses itself, so it is not a closed shape; reorder its corners so that no two sides cross.` };
    }
    outs.push(o);
  }
  const off = sk.map((s) => s.offset ?? 0);
  if (Math.abs(off[1] - off[0]) >= GAP_MIN) {
    const EA0 = extentOf(outs[0]); const EB0 = extentOf(outs[1]);
    const inplane = Math.hypot(Math.max(EA0[1], EB0[1]) - Math.min(EA0[0], EB0[0]), Math.max(EA0[3], EB0[3]) - Math.min(EA0[2], EB0[2]));
    if (Math.abs(off[1] - off[0]) < GAP_REL_MIN * inplane) return { code: 'sliver', sentence: `The gap (${num(+Math.abs(off[1] - off[0]).toPrecision(3))} mm) is under 1/${Math.round(1 / GAP_REL_MIN)} of the sketches' size (${num(+inplane.toPrecision(3))} mm), so the loft would be a sliver too thin to build reliably; give it a bigger gap.` };
  }
  if (Math.abs(off[1] - off[0]) < GAP_MIN) return { code: 'gap0', sentence: 'The two sketches are in the same place (the gap is zero), so there is nothing between them to fill; give the loft a gap above zero.' };
  for (let i = 0; i < 2; i++) {
    const s = sk[i];
    const others = consumersOf(doc, s.id, f.id);
    if (neutral) {
      const was = neutral.get(s.id);
      const moved = was !== undefined && Math.abs(was - (s.offset ?? 0)) > 1e-12;
      if (moved && Math.abs(was!) > 1e-12) return { code: 'datum', sentence: `The ${label(i)} sketch was placed at height ${num(was!)}, but the loft's gap puts it at ${num(s.offset ?? 0)}, so make the two agree by changing the gap or the height the sketch was drawn at.` };
      if (moved && others.length) return { code: 'shared', sentence: `The ${label(i)} sketch is also used by another feature, and a loft moves its second sketch to the gap you give, which would move the other feature too, so draw a separate sketch for the loft.` };
    } else if (others.length) {
      return { code: 'shared', sentence: `The ${label(i)} sketch is also used by another feature, and a loft may move one of its sketches, so draw separate sketches for the loft.` };
    }
  }
  const [A, B] = outs;
  const gap = Math.abs(off[1] - off[0]);
  const EA = extentOf(A); const EB = extentOf(B);
  const diag = Math.hypot(Math.max(EA[1], EB[1]) - Math.min(EA[0], EB[0]), Math.max(EA[3], EB[3]) - Math.min(EA[2], EB[2]), gap);
  const circles = outs.filter((o): o is Extract<Shape, { type: 'circle' }> => o.type === 'circle');
  const rCirc = circles.length ? Math.max(...circles.map((o) => o.d / 2)) : 0;
  if (A.type === 'circle' && B.type === 'circle') {
    const tilt = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1]) / gap;
    if (tilt > CC_TILT_MAX) return { code: 'tilt', sentence: `The second circle is ${num(+(tilt).toFixed(1))} times the gap away sideways, and a loft that leans over that far (more than ${CC_TILT_MAX} times the gap) cannot be built exactly; move the circles closer sideways or make the gap bigger.` };
    if (rCirc < CIRCLE_R_MIN) return { code: 'coarse', sentence: `The larger circle has a radius of ${num(rCirc)} mm, and a loft needs at least ${CIRCLE_R_MIN} mm to be built exactly, so make it bigger.` };
    if (diag / rCirc > COARSE_MAX) return { code: 'coarse', sentence: `The larger circle (radius ${num(rCirc)} mm) is under 1/${COARSE_MAX} of the loft's overall size (${num(+diag.toFixed(1))} mm), which cannot be built exactly; make the circle bigger or the gap smaller.` };
    return null;
  }
  if (circles.length === 1 && (diag / rCirc > PC_RATIO_MAX || rCirc < CIRCLE_R_MIN)) {
    return rCirc < CIRCLE_R_MIN
      ? { code: 'coarse', sentence: `The circle has a radius of ${num(rCirc)} mm, and a loft needs at least ${CIRCLE_R_MIN} mm to be built exactly, so make it bigger.` }
      : { code: 'coarse', sentence: `The circle (radius ${num(rCirc)} mm) is under 1/${PC_RATIO_MAX} of the loft's overall size (${num(+diag.toFixed(1))} mm), which cannot be built exactly; make the circle bigger or the gap and outline smaller.` };
  }
  if (circles.length === 1) {
    const other = (A.type === 'circle' ? B : A) as Poly; const E = other === A ? EA : EB;
    const longSide = Math.max(E[1] - E[0], E[3] - E[2]);
    const isRect = other.type === 'polygon' && !!isAxisRect(other.pts);
    if (!(2 * rCirc / longSide >= PC_SIZE_MIN && 2 * rCirc / longSide <= (isRect ? PC_SIZE_MAX_RECT : PC_SIZE_MAX))) return { code: 'size-mix', sentence: `The circle is ${num(+(2 * rCirc / longSide).toFixed(2))} times as wide as the other outline is long, and it must be between ${PC_SIZE_MIN} and ${isRect ? PC_SIZE_MAX_RECT : PC_SIZE_MAX} times to be built exactly, so resize one of them.` };
    if (gap / longSide < (isRect ? PC_THIN_MIN_RECT : PC_THIN_MIN)) return { code: 'thin', sentence: `The gap is ${num(+(gap / longSide).toFixed(2))} times the long side of the other outline, but a loft between a circle and another shape needs a gap of at least ${isRect ? 'the full long side' : `${PC_THIN_MIN} times the long side`} to be built exactly, so make the gap bigger.` };
  }
  if (A.type === 'arcs' || B.type === 'arcs') {
    const rr = roundedRect(A.type === 'arcs' ? A : B); const other = A.type === 'arcs' ? B : A;
    if (rr && other.type === 'circle' && rr.aspect <= ROUNDED_ASPECT_MAX) return null;
    return { code: 'arcs', sentence: 'A loft with rounded corners only works against a circle, and only when the shape is nearly square (long side at most 1.1 times the short side), so use a circle or straight sides.' };
  }
  if (A.type === 'circle' || B.type === 'circle') {
    const P = (A.type === 'circle' ? B : A) as Poly;
    const rect = isAxisRect(P.pts);
    if (rect && rect.aspect <= RECT_ASPECT_MAX) return null;
    if (regularPhase0(P.pts)) return null;
    return { code: 'circle-poly', sentence: 'A circle can only be lofted to another circle, an axis-aligned rectangle (long side at most twice the short side), or a regular 4, 5, 6 or 8 sided shape with a corner pointing right, and the other outline is none of those.' };
  }
  // polygon <-> polygon
  const Ap = (A as Poly).pts; const Bp = (B as Poly).pts;
  const na = Ap.length; const nb = Bp.length;
  const [nFirst, nSecond] = label(0) === 'first' ? [na, nb] : [nb, na];
  if (na !== nb) return { code: 'count', sentence: `The first sketch has ${nFirst} corners and the second has ${nSecond}, but a loft needs the same number on both, so delete any point that sits in the middle of a straight side.` };
  const P = ccwLoop(Ap); const Q = ccwLoop(Bp);
  const shifts = parallelShifts(P, Q);
  const lead = leadIsB(pl[0], off[0], Ap, off[1], Bp);
  if (shifts.length === 0) {
    const tie = truckShift(P, Q, lead).margin < 1e-6;
    if (tie) return { code: 'tie', sentence: 'The second sketch is turned exactly half way between two corners of the first, so its corners could be matched two ways; turn it until each side is parallel to a side of the first.' };
    const w = parallelDeviation(P, Q); const deg = w >= 9 ? null : Math.asin(Math.min(1, w)) * 180 / Math.PI;
    return { code: 'sides', warp: w, sentence: deg === null
      ? 'Matching sides of these two sketches do not run the same way, so the loft would twist; make each side of the first parallel to its partner in the second, as when a shape is scaled.'
      : `Matching sides of these two sketches are up to ${num(+deg.toFixed(deg < 1 ? 2 : 1))} degrees from parallel, which would twist the loft, so make each side of the first parallel to its partner in the second.` };
  }
  if (shifts.length > 1) return { code: 'ambiguous', sentence: 'The corners of these two sketches could be matched up in more than one way, so change one sketch so only one matching is possible.' };
  const t = truckShift(P, Q, lead);
  if (t.s !== shifts[0] || t.margin < 1e-6) {
    const pass = (Aq: P2[], Bq: P2[]) => {
      const P2_ = ccwLoop(Aq); const Q2 = ccwLoop(Bq); const sh = parallelShifts(P2_, Q2);
      if (sh.length !== 1) return false;
      const tt = truckShift(P2_, Q2, leadIsB(pl[0], off[0], Aq, off[1], Bq));
      return tt.s === sh[0] && tt.margin >= 1e-6;
    };
    const rot = (L: P2[], k: number) => L.slice(k).concat(L.slice(0, k));
    const nth = (k: number) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[k % 10] ?? 'th'}`;
    const order = label(0) === 'first' ? [1, 0] : [0, 1];
    let advice: { sketch: string; corner: number } | null = null;
    for (const j of order) {
      for (let k = 1; k < na && !advice; k++) {
        const ok = j === 0 ? pass(rot(Ap, k), Bp) : pass(Ap, rot(Bp, k));
        if (ok) advice = { sketch: label(j), corner: k + 1 };
      }
      if (advice) break;
    }
    const base = 'The corners of these two sketches would be matched in a different order than the one you drew, which twists the loft';
    return { code: 'start', advice, sentence: advice ? `${base}; list the corners of the ${advice.sketch} sketch starting from its ${nth(advice.corner)} corner instead.` : `${base}, and no other starting corner fixes it, so change one of the two outlines.` };
  }
  // ADDED (NEEDLE): a straight-sided loft far longer than it is wide
  const inplane = Math.hypot(Math.max(EA[1], EB[1]) - Math.min(EA[0], EB[0]), Math.max(EA[3], EB[3]) - Math.min(EA[2], EB[2]));
  if (gap > NEEDLE_MAX * inplane) return { code: 'needle', sentence: `The gap (${num(+gap.toPrecision(3))} mm) is over ${NEEDLE_MAX} times the sketches' size (${num(+inplane.toPrecision(3))} mm), so the loft would be a needle too thin to build reliably; make the gap smaller or the sketches bigger.` };
  return null;
}

export function guardDoc(doc: Doc, ctx: BlendGuardCtx): Map<string, BlendVerdict | null> {
  const out = new Map<string, BlendVerdict | null>();
  for (const f of doc.features) if (f.kind === 'blend') out.set(f.id, guardBlend(doc, f, ctx));
  return out;
}

/**
 * ADDED (PRISMATOID): the exact volume of a ruled loft between two straight-sided outlines on parallel planes `h` apart, corners matched P_i <-> Q_{i+s}
 * (both counter-clockwise). The cross section at height t has the corners (1 - t) P_i + t Q_{i+s}, so its area is quadratic in t and Simpson's rule is exact.
 */
export function prismatoidVolume(P: P2[], Q: P2[], s: number, h: number): number {
  const n = P.length;
  const M = P.map((p, i) => { const q = Q[(i + s) % n]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; });
  return Math.abs(h) / 6 * (Math.abs(area2(P)) / 2 + Math.abs(area2(Q)) / 2 + 4 * Math.abs(area2(M)) / 2);
}

/** The post-build bar of circle <-> circle (the original's) and of a straight-sided pair with slightly warped sides. */
export const POST_BAR = 2.5e-4;
/** ADDED (PRISMATOID): the bar for a straight-sided pair whose matching sides are parallel to EXACT_PAR_TOL (flat side faces: the kernel's volume is exact). */
export const POST_BAR_FLAT = 1e-6;
const POST_SENTENCE = 'The solid built for these two sketches has a volume that is off from the exact value, so it cannot be trusted; make the sketches bigger or the loft shorter.';

/**
 * POST-BUILD check (the independent-measure half of the guard). circle <-> circle: h/3 (A1 + A2 + sqrt(A1 A2)) (the original, its own sentence). ADDED: a
 * straight-sided pair against prismatoidVolume. `kernelVolume` is the volume the kernel reports. Returns null (agrees, or no closed form) or {code, sentence}.
 */
export function postCheckBlend(doc: Doc, f0: Feature, { kernelVolume, outlineOf }: { kernelVolume: number; outlineOf: BlendGuardCtx['outlineOf'] }): BlendVerdict | null {
  const f = f0 as unknown as BlView;
  const sks = (f.targets ?? []).map((id) => doc.features.find((x) => x.id === id) as unknown as SkView | undefined);
  if (sks.length !== 2 || sks.some((x) => !x)) return null;
  const sk = sks as SkView[];
  const h = Math.abs((sk[1].offset ?? 0) - (sk[0].offset ?? 0));
  if (sk.every((x) => x.shape === 'circle')) {
    const rad = (s: SkView) => Math.hypot(s.points![1][0] - s.points![0][0], s.points![1][1] - s.points![0][1]) / 2;
    const r1 = rad(sk[0]); const r2 = rad(sk[1]);
    const A1 = Math.PI * r1 * r1; const A2 = Math.PI * r2 * r2; const exact = h / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
    const d = Math.abs(kernelVolume - exact) / exact;
    return d <= POST_BAR ? null : { code: 'volume', d, sentence: 'The solid built for these two circles has a volume that is off from the exact value, so it cannot be trusted; make the circles bigger or the loft shorter.' };
  }
  if (sk.some((x) => x.shape === 'circle')) return null;
  const os = sk.map((s) => describeOutline(s, outlineOf));
  if (os.some((o) => o.type !== 'polygon')) return null;
  const Ap = (os[0] as Poly).pts; const Bp = (os[1] as Poly).pts;
  if (Ap.length !== Bp.length) return null;
  const P = ccwLoop(Ap); const Q = ccwLoop(Bp);
  const t = truckShift(P, Q, leadIsB(sk[0].plane ?? 'xy', sk[0].offset ?? 0, Ap, sk[1].offset ?? 0, Bp));
  const exact = prismatoidVolume(P, Q, t.s, h);
  if (!(exact > 0)) return null;
  const d = Math.abs(kernelVolume - exact) / exact;
  const bar = parallelDeviation(P, Q) <= EXACT_PAR_TOL ? POST_BAR_FLAT : POST_BAR;
  return d <= bar ? null : { code: 'volume', d, sentence: POST_SENTENCE };
}
