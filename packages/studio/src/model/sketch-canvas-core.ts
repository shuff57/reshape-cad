// The pure logic of SketchCanvas2D (SPEC-sketcher2 §7): tool state machines,
// snapping, hit-testing, auto-constraint inference. Everything here is a
// function of its arguments and nothing else -- no DOM, no React, no wasm --
// because there is no React test harness in this repo and the component only
// proves its imports by tsc (the SketchConstraints.tsx:261 precedent). The
// exported functions are the part test/sketch-canvas-core.test.mjs proves.
//
// Soup coordinates: the same mm plane coordinates the doc stores in
// SketchFeature.geoms. 'a'/'b'/'c' are the soup point refs (start/end/centre).

export type CoreGeom = {
  k: 'point' | 'line' | 'circle' | 'arc';
  id: number;
  construction?: boolean;
} & Record<string, any>;

export interface Pt {
  x: number;
  y: number;
}

/** Which named points each geometry kind exposes. A point exposes only its
 *  own location; a line its two ends; a circle its centre; an arc all three
 *  plus both ends. The UI hit-tests ONLY the named points a kind really
 *  has -- offering a line's 'c' would snap to nothing and refuse later. */
export function namedPointsOf(g: CoreGeom): Array<{ at: 'a' | 'b' | 'c' }> {
  switch (g.k) {
    case 'point':
      return [{ at: 'a' }];
    case 'line':
      return [{ at: 'a' }, { at: 'b' }];
    case 'circle':
      return [{ at: 'c' }];
    case 'arc':
      return [{ at: 'a' }, { at: 'b' }, { at: 'c' }];
  }
}

/** World coordinates of a named point of geometry `g`, from the row's own
 *  values (the UI keeps rows solved, so no re-projection is needed). */
export function pointWorld(g: CoreGeom, at: 'a' | 'b' | 'c'): Pt | null {
  switch (g.k) {
    case 'point':
      return at === 'a' ? { x: g.p[0], y: g.p[1] } : null;
    case 'line':
      if (at === 'a') return { x: g.a[0], y: g.a[1] };
      if (at === 'b') return { x: g.b[0], y: g.b[1] };
      return null;
    case 'circle':
      return at === 'c' ? { x: g.c[0], y: g.c[1] } : null;
    case 'arc':
      if (at === 'c') return { x: g.c[0], y: g.c[1] };
      if (at === 'a') return { x: g.a[0], y: g.a[1] };
      if (at === 'b') return { x: g.b[0], y: g.b[1] };
      return null;
  }
  return null;
}

// --- snapping (the archived UI's findSnapVertex) -----------------------------

/** The nearest named point within `snapPx` screen pixels of the pointer, or
 *  null. Screen distance is decided by the caller-supplied `distPx`, so the
 *  projection stays the component's business. */
export function snapVertex(
  geoms: CoreGeom[],
  target: Pt,
  distPx: (p: Pt) => number,
  snapPx: number,
): { id: number; at: 'a' | 'b' | 'c'; world: Pt } | null {
  let best: { id: number; at: 'a' | 'b' | 'c'; world: Pt } | null = null;
  let bestDist = snapPx;
  for (const g of geoms) {
    for (const { at } of namedPointsOf(g)) {
      const w = pointWorld(g, at);
      if (!w) continue;
      const d = distPx(w);
      if (d < bestDist) {
        bestDist = d;
        best = { id: g.id, at, world: w };
      }
    }
  }
  return best;
}

// --- hit-testing (the archived UI's findShapeHit) ----------------------------

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToCircleStroke(p: Pt, center: Pt, r: number): number {
  return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r);
}

/** Is world angle `theta` inside the CCW sweep [a0, a1]? An arc's sweep stays
 *  under one full turn, so normalising theta into [a0, a0+2pi) is exact. */
export function angleInArcRange(theta: number, a0: number, a1: number): boolean {
  const twoPi = Math.PI * 2;
  const t = theta - Math.floor((theta - a0) / twoPi) * twoPi;
  return t <= a1 + 1e-9;
}

/** Arc geometry from a row: centre, radius, start angle a0 and CCW sweep.
 *  The soup stores centre + radius + both endpoints + sense, never angles,
 *  so the UI derives them the same way the emitter does. */
export function arcAngles(g: CoreGeom): { a0: number; sweep: number } | null {
  if (g.k !== 'arc') return null;
  const [cx, cy] = g.c;
  const r = g.r;
  const a0 = Math.atan2(g.a[1] - cy, g.a[0] - cx);
  let a1 = Math.atan2(g.b[1] - cy, g.b[0] - cx);
  const twoPi = Math.PI * 2;
  if (g.sense === 'cw') {
    // A cw arc from a to b is the complement: normalize a1 BELOW a0.
    if (a1 >= a0) a1 -= twoPi;
  } else if (a1 <= a0) {
    a1 += twoPi;
  }
  return { a0, sweep: a1 - a0 };
}

export function sampleArc(cx: number, cy: number, r: number, a0: number, sweep: number, steps = 24): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + sweep * (i / steps);
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

// --- line tool (the archived UI's chain state machine) ------------------------

export interface LineChain {
  startId: number | null;
  startAt: 'a' | 'b' | null;
  prevX: number;
  prevY: number;
  prevId: number | null;
  prevAt: 'a' | 'b' | null;
  pinOrigin: boolean;
}

/** Angle (deg, 0..360 from +X) of the segment from `from` to `to`. */
export function lineAngleDeg(from: Pt, to: Pt): number {
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** Does the candidate line want to be horizontal or vertical? */
export function inferLineConstraint(from: Pt, to: Pt, angleTolDeg = 4): 'horizontal' | 'vertical' | null {
  if (from.x === to.x && from.y === to.y) return null;
  const deg = lineAngleDeg(from, to);
  const near = (t: number) => Math.min(Math.abs(deg - t), 360 - Math.abs(deg - t)) <= angleTolDeg;
  if (near(0) || near(180)) return 'horizontal';
  if (near(90) || near(270)) return 'vertical';
  return null;
}

/** Snaps `to` onto the axis `kind` implies relative to `from`, so the
 *  committed line is truly axis-aligned (redundant-free), not a few-degrees-
 *  off yank. Returns a NEW point; never mutates `to`. */
export function snapAxis(from: Pt, to: Pt, kind: 'horizontal' | 'vertical'): Pt {
  if (kind === 'horizontal') return { x: to.x, y: from.y };
  return { x: from.x, y: to.y };
}

/** centre/start/end clicks -> {r, a0, sweep} for the arc tool. CCW from the
 *  start ray to the end ray; a cw arc's sweep goes negative. */
export function arcFromClicks(c1: Pt, c2: Pt, c3: Pt): { cx: number; cy: number; r: number; a0: number; sweep: number } | null {
  const r = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (r <= 1e-9) return null;
  const a0 = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  let a1 = Math.atan2(c3.y - c1.y, c3.x - c1.x);
  if (a1 <= a0) a1 += Math.PI * 2;
  return { cx: c1.x, cy: c1.y, r, a0, sweep: a1 - a0 };
}

/** Endpoint positions of an arc given centre/radius/a0/sweep, so a committed
 *  arc row can carry its own a/b like every other soup arc. */
export function arcEnds(cx: number, cy: number, r: number, a0: number, sweep: number): { a: Pt; b: Pt } {
  return {
    a: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
    b: { x: cx + r * Math.cos(a0 + sweep), y: cy + r * Math.sin(a0 + sweep) },
  };
}

// --- next dense id ------------------------------------------------------------

/** The id the next piece of geometry gets: max existing id + 1, starting at 1.
 *  The soup contract requires dense 1-based ids, so after a delete the next
 *  add must REUSE the hole. */
export function nextGeomId(geoms: CoreGeom[]): number {
  let max = 0;
  for (const g of geoms) if (g.id > max) max = g.id;
  return max + 1;
}

/** Renumber rows to restore density after a delete: geometry shifts down and
 *  every rule reference follows. Returns NEW arrays; never mutates. */
export function renumber(geoms: CoreGeom[], rules: Record<string, any>[], removedId: number): { geoms: CoreGeom[]; rules: Record<string, any>[] } {
  const shift = (id: number) => (id > removedId ? id - 1 : id);
  const ends = ['a', 'b', 'c', 'aEnd', 'bEnd', 'cEnd'] as const;
  const kept = geoms
    .filter((g) => g.id !== removedId)
    .map((g) => {
      const out: CoreGeom = { ...g, id: shift(g.id) };
      return out;
    });
  // A rule that names the removed geometry is a dangle: shift() would silently
  // point it at the neighbour, so it is DROPPED, not renumbered. A rule with
  // several id fields (symmetric's three points) needs all of them to name
  // the removed row to drop; any surviving reference shifts.
  const idFields = ['a', 'b', 'c'] as const;
  const namesRemoved = (r: Record<string, any>): boolean =>
    idFields.some((f) => typeof r[f] === 'number' && r[f] === removedId);
  const keptRules = rules
    .filter((r) => !namesRemoved(r))
    .map((r) => {
      const out: Record<string, any> = { ...r };
      for (const e of ends) {
        if (typeof out[e] === 'number') out[e] = shift(out[e]);
      }
      return out;
    });
  return { geoms: kept, rules: keptRules };
}

// --- the solved-geometry reader ------------------------------------------------

/** Read the solved rows back out of a full parameter vector, mirroring the
 *  kernel's slot layout (built-ins 10, then point 2 / line 4 / circle 3 /
 *  arc 7 per row in id order). Rows carry their construction flag through. */
export function readSolved(geoms: CoreGeom[], params: Float64Array | number[]): CoreGeom[] {
  let i = 10;
  const n = params.length;
  const read2 = (): [number, number] => {
    const a = i + 1 <= n ? params[i] : 0;
    const b = i + 1 <= n ? params[i + 1] : 0;
    i += 2;
    return [a, b];
  };
  return geoms.map((g) => {
    switch (g.k) {
      case 'point':
        return { ...g, p: read2() };
      case 'line': {
        const a = read2();
        const b = read2();
        return { ...g, a, b };
      }
      case 'circle': {
        const c = read2();
        const r = i < n ? params[i] : 0;
        i += 1;
        return { ...g, c, r };
      }
      case 'arc': {
        const c = read2();
        const r = i < n ? params[i] : 0;
        i += 1;
        const a = read2();
        const b = read2();
        return { ...g, c, r, a, b };
      }
    }
    return g;
  });
}

/** A soup geometry row minus its id, distributively over the union so each
 *  kind keeps its own fields (a plain Omit<SoupGeom,'id'> does not). */
import type { SoupGeom } from '@shuff57/reshape-script/model-types';
type DistOmit<U> = U extends unknown ? Omit<U, 'id'> : never;
export type SoupGeomNew = DistOmit<SoupGeom>;
