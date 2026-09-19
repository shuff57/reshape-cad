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

// --- construction toggle (the archived UI's cConstr) -------------------------

/** Majority toggle: if ANY selected shape is not construction, all become
 *  construction; only when they all already are does the toggle turn them
 *  all off. A per-shape toggle on a mixed selection just inverts the mix,
 *  which no user has ever wanted. Returns the rows with `construction` set. */
export function toggleConstruction(geoms: CoreGeom[], ids: number[]): CoreGeom[] {
  const want = geoms.some((g) => ids.includes(g.id) && !g.construction);
  return geoms.map((g) => (ids.includes(g.id) ? { ...g, construction: want } : g));
}

// --- trim (the archived UI's sketchTrim, soup edition) -----------------------

/** Where does the segment p1->p2 cross the segment p3->p4, if at all within
 *  BOTH segments? Returns the crossing point or null. Parallel segments
 *  never cross (denominator 0). */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** The nearest crossing of the clicked line with any OTHER line, within the
 *  clicked line itself. Circles/arcs are future work here: a line-circle
 *  quadratic is easy, but the piece bookkeeping after a split is not free,
 *  and half a trim tool is worse than none. Returns the split point and the
 *  other line's id, or null. */
export function trimPick(geoms: CoreGeom[], clickedId: number, click: Pt): { at: Pt; otherId: number } | null {
  const clicked = geoms.find((g) => g.id === clickedId);
  if (!clicked || clicked.k !== 'line') return null;
  const a = { x: clicked.a[0], y: clicked.a[1] };
  const b = { x: clicked.b[0], y: clicked.b[1] };
  let best: { at: Pt; otherId: number } | null = null;
  let bestDist = Infinity;
  for (const g of geoms) {
    if (g.k !== 'line' || g.id === clickedId) continue;
    const x = segmentIntersection(a, b, { x: g.a[0], y: g.a[1] }, { x: g.b[0], y: g.b[1] });
    if (!x) continue;
    const d = Math.hypot(x.x - click.x, x.y - click.y);
    if (d < bestDist) {
      bestDist = d;
      best = { at: x, otherId: g.id };
    }
  }
  return best;
}

/** Trim the clicked line at `split`: the half UNDER the click is deleted
 *  (whichever half's midpoint sits closer to the click), the far half keeps
 *  the clicked row's id with its far endpoint pulled to the split. No new
 *  row, no weld: a trim that deletes a piece leaves the wire open, and wire
 *  discovery's refusals say exactly that. Rules referencing the clicked row
 *  keep working (the surviving half kept the id); a rule that referenced the
 *  deleted geometry may become unsatisfiable — the diagnosis badge surfaces
 *  that, the trim does not try to fix it. */
export function trimLine(
  geoms: CoreGeom[],
  rules: Array<Record<string, any>>,
  clickedId: number,
  split: Pt,
  click: Pt,
): { geoms: CoreGeom[]; rules: Array<Record<string, any>> } {
  void nextIdUnused;
  const clicked = geoms.find((g) => g.id === clickedId);
  if (!clicked || clicked.k !== 'line') return { geoms, rules };
  const a = { x: clicked.a[0], y: clicked.a[1] };
  const b = { x: clicked.b[0], y: clicked.b[1] };
  // The click half is the one whose MIDPOINT is closer to the click point.
  const dA = Math.hypot((a.x + split.x) / 2 - click.x, (a.y + split.y) / 2 - click.y);
  const dB = Math.hypot((b.x + split.x) / 2 - click.x, (b.y + split.y) / 2 - click.y);
  const nearIsA = dA <= dB;
  const farPt = nearIsA ? b : a;
  const geomsOut = geoms.map((g) =>
    g.id === clickedId ? { ...g, a: [farPt.x, farPt.y], b: [split.x, split.y] } : g,
  );
  return { geoms: geomsOut, rules: [...rules] };
}
const nextIdUnused = undefined;

// --- slot composite tool -------------------------------------------------------

export interface SlotResult {
  geoms: CoreGeom[];
  rules: Array<Record<string, any>>;
  ids: { arc1: number; arc2: number; top: number; bottom: number };
}

/** Build a slot (obround) from three clicks: centre A, centre B, and a point
 *  whose distance from A is the radius. The four rows are two arcs and two
 *  tangent lines, welded by four line-arc tangencies and nothing else —
 *  tangency IS the weld here, coincidents would fight it (O2's note: the
 *  endpoint forms and the simple forms are different asks).
 *
 *  Arc ends are placed at the axis-aligned extremes: the caps face outward
 *  along the A->B direction's perpendicular, which keeps the seed solvable
 *  and the tangencies well-posed (the line runs from one arc's extreme to
 *  the other's matching extreme, on the same side). */
export function slotRows(cA: Pt, cB: Pt, rPoint: Pt, baseId: number): SlotResult | null {
  const r = Math.hypot(rPoint.x - cA.x, rPoint.y - cA.y);
  if (r <= 1e-9) return null;
  const dx = cB.x - cA.x;
  const dy = cB.y - cA.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return null;
  // Unit perpendicular of the A->B axis.
  const px = -dy / len;
  const py = dx / len;
  // Arc 1 (at A): ends at A + r*(+perp) and A + r*(-perp).
  // Arc 2 (at B): ends at B + r*(-perp) and B + r*(+perp).
  const arc1a: [number, number] = [cA.x + px * r, cA.y + py * r];
  const arc1b: [number, number] = [cA.x - px * r, cA.y - py * r];
  const arc2a: [number, number] = [cB.x - px * r, cB.y - py * r];
  const arc2b: [number, number] = [cB.x + px * r, cB.y + py * r];
  // WHICH END IS `a` IS THE DIRECTION, and it is what decides whether a cap
  // bulges away from the axis (an obround) or into it (a notch). A cw arc
  // runs from `a` DOWN in angle to `b`, so cap A must start at -perp and end
  // at +perp to sweep the far side; starting at +perp sweeps the near side
  // and bites a semicircle out of the slot instead.
  //
  // This shipped the near way round. Measured 2026-09-18 through the canvas's
  // own arcAngles + sampleArc and then through the kernel: the drawn outline
  // spanned x over [0, 40] for centres at x=0 and x=40 with r=10 -- it must
  // reach [-10, 50] -- and the extrude measured 4858.407346 where an obround
  // is 11141.592654, a 56% error a student could SEE.
  //
  // Flipping `sense` to ccw is NOT the fix: it draws the right shape and then
  // refuses ("edge 3 and arc 1 meet in a point rather than running smoothly;
  // reverse one of them"), because the ends' ORDER, not the sense, is what
  // the wire walk reads as travel direction. The refusal named the fix; it was
  // read as a verdict on the sense. Reversing both caps' ends builds the
  // obround exactly, on the same cw sense, with no refusal.
  const arc1 = baseId;
  const arc2 = baseId + 1;
  const top = baseId + 2; // the +perp side line
  const bottom = baseId + 3; // the -perp side line
  const geoms: CoreGeom[] = [
    { k: 'arc', id: arc1, c: [cA.x, cA.y], r, a: arc1b, b: arc1a, sense: 'cw' },
    { k: 'arc', id: arc2, c: [cB.x, cB.y], r, a: arc2b, b: arc2a, sense: 'cw' },
    { k: 'line', id: top, a: arc1a, b: arc2b },
    { k: 'line', id: bottom, a: arc2a, b: arc1b },
  ];
  // Four junctions, TWO rows each. The weld is a coincident — wire
  // discovery walks coincident classes and nothing else (wires.rs's header
  // states it as the definition of "same vertex") — and the DIRECTION is an
  // endpoint tangent, whose residual carries no sigma (the simple form's
  // side-blindness is what made a side-less tangency drift the solve).
  const rules: Array<Record<string, any>> = [
    { k: 'coincident', a: top, aEnd: 'a', b: arc1, bEnd: 'b' },
    { k: 'tangent', a: top, aEnd: 'a', b: arc1, bEnd: 'b' },
    { k: 'coincident', a: top, aEnd: 'b', b: arc2, bEnd: 'a' },
    { k: 'tangent', a: top, aEnd: 'b', b: arc2, bEnd: 'a' },
    { k: 'coincident', a: bottom, aEnd: 'a', b: arc2, bEnd: 'b' },
    { k: 'tangent', a: bottom, aEnd: 'a', b: arc2, bEnd: 'b' },
    { k: 'coincident', a: bottom, aEnd: 'b', b: arc1, bEnd: 'a' },
    { k: 'tangent', a: bottom, aEnd: 'b', b: arc1, bEnd: 'a' },
  ];
  return { geoms, rules, ids: { arc1, arc2, top, bottom } };
}

// --- circle-in-mixed-wire canonicalization (kernel §5.3.10 v2 support) ------
//
// The kernel's wire walk cannot traverse a whole circle (it has no
// endpoints), so a circle welded to lines refuses with "use two arcs". The
// canvas applies that advice mechanically: a circle carrying two simple
// tangencies to lines becomes TWO arcs split at the contact points, the
// tangencies stay (line-circle simple tangency), and a coincident welds the
// two arcs at BOTH contact points (each arc's a/b coincide with the other's
// b/a). Wire discovery then walks the arcs like any other curves.

/** Contact point of a simple line-circle tangency: the foot of the
 *  perpendicular from the circle's centre onto the line. */
function tangentContact(c: Pt, line: { a: Pt; b: Pt }): Pt {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return c;
  let t = ((c.x - line.a.x) * dx + (c.y - line.a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: line.a.x + t * dx, y: line.a.y + t * dy };
}

export interface CircleSplitResult {
  geoms: CoreGeom[];
  rules: Array<Record<string, any>>;
  replacedIds: number[];
}

/** Replace every circle that carries >= 2 simple tangencies to LINES with an
 *  arc pair split at two of the contact points. Rows after the replaced ones
 *  shift ids down by 1 per replacement; rule references follow via
 *  renumber-style shifting. Returns the new rows; never mutates. */
export function splitWeldedCircles(geoms: CoreGeom[], rules: Array<Record<string, any>>): CircleSplitResult {
  const replacedIds: number[] = [];
  let geomsOut = [...geoms];
  let rulesOut = [...rules];
  for (const g of geoms) {
    if (g.k !== 'circle') continue;
    const tangents = rulesOut.filter(
      (r) => r.k === 'tangent' && (r.a === g.id || r.b === g.id) && !r.aEnd && !r.bEnd,
    );
    if (tangents.length < 2) continue;
    const c = { x: g.c[0], y: g.c[1] };
    const r = g.r;
    // The two contact points, deduplicated by distance.
    const contacts: Pt[] = [];
    for (const t of tangents) {
      const otherId = t.a === g.id ? t.b : t.a;
      const other = geomsOut.find((x) => x.id === otherId && x.k === 'line');
      if (!other) continue;
      const contact = tangentContact(c, { a: { x: other.a[0], y: other.a[1] }, b: { x: other.b[0], y: other.b[1] } });
      if (!contacts.some((p) => Math.hypot(p.x - contact.x, p.y - contact.y) < 1e-9)) {
        contacts.push(contact);
      }
    }
    if (contacts.length < 2) continue;
    const [p1, p2] = contacts;
    // The two arcs: split the circle at the contact points. Arc 1 runs CCW
    // from p1 to p2; arc 2 runs CCW from p2 back to p1. Their sense field is
    // derived from the cross product so the pair covers the circle exactly.
    const th1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const th2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    const arc1 = g.id;
    const arc2 = nextGeomId(geomsOut);
    // Arc sense: the sweep must be the SHORT way? No — the two arcs together
    // cover the whole circle exactly once, so arc 1 takes the CCW span
    // th1->th2 and arc 2 takes the CCW span th2->th1 (which is the rest).
    const sense1: 'ccw' | 'cw' = 'ccw';
    const sense2: 'ccw' | 'cw' = 'ccw';
    const geomsNext: CoreGeom[] = [];
    for (const x of geomsOut) {
      if (x.id === g.id) {
        geomsNext.push({ ...x, k: 'arc', a: [p1.x, p1.y], b: [p2.x, p2.y], sense: sense1, c: [c.x, c.y], r } as CoreGeom);
      } else {
        geomsNext.push(x);
      }
    }
    geomsNext.push({ k: 'arc', id: arc2, c: [c.x, c.y], r, a: [p2.x, p2.y], b: [p1.x, p1.y], sense: sense2 });
    rulesOut.push({ k: 'coincident', a: arc1, aEnd: 'b', b: arc2, bEnd: 'a' });
    rulesOut.push({ k: 'coincident', a: arc1, aEnd: 'a', b: arc2, bEnd: 'b' });
    geomsOut = geomsNext;
    replacedIds.push(g.id);
  }
  return { geoms: geomsOut, rules: rulesOut, replacedIds };
}

// --- mirror / copy of a selection ---------------------------------------------

/** One duplicated row with its id remapped and its point coordinates
 *  transformed by `xf`. Rules INTERNAL to the selection are duplicated with
 *  remapped ids; rules referencing the selection from OUTSIDE are left
 *  alone (the copy is independent). Returns null when the selection is
 *  empty. */
export interface DupResult {
  geoms: CoreGeom[];
  rules: Array<Record<string, any>>;
  /** old id -> new id, for callers that want to constrain the copy. */
  idMap: Map<number, number>;
}

const ID_RULE_FIELDS = ['a', 'b', 'c'] as const;

function dupRows(
  geoms: CoreGeom[],
  rules: Array<Record<string, any>>,
  ids: number[],
  xf: (p: Pt) => Pt,
  newIdOf: (old: number, used: Set<number>) => number,
): DupResult | null {
  const set = new Set(ids);
  const selected = geoms.filter((g) => set.has(g.id));
  if (selected.length === 0) return null;
  // New ids come after everything present.
  let next = 1;
  for (const g of geoms) if (g.id >= next) next = g.id + 1;
  const idMap = new Map<number, number>();
  const used = new Set<number>();
  for (const g of selected) {
    const n = newIdOf(g.id, used);
    idMap.set(g.id, n);
    used.add(n);
    void next;
  }
  const transformGeom = (g: CoreGeom): CoreGeom => {
    const t = (p: [number, number]): [number, number] => {
      const q = xf({ x: p[0], y: p[1] });
      return [q.x, q.y];
    };
    switch (g.k) {
      case 'point':
        return { ...g, id: idMap.get(g.id)!, p: t(g.p) };
      case 'line':
        return { ...g, id: idMap.get(g.id)!, a: t(g.a), b: t(g.b) };
      case 'circle':
        return { ...g, id: idMap.get(g.id)!, c: t(g.c) };
      case 'arc':
        return { ...g, id: idMap.get(g.id)!, c: t(g.c), a: t(g.a), b: t(g.b) };
    }
    return g;
  };
  const geomsOut = [...geoms, ...selected.map(transformGeom)];
  // Internal rules duplicate with remapped ids; mixed ones (half in, half
  // out) are NOT duplicated — a constraint tying the copy to the original
  // is the user's next click, not the tool's guess.
  const rulesOut = [...rules];
  for (const r of rules) {
    const refs = ID_RULE_FIELDS.map((f) => r[f]).filter((v) => typeof v === 'number') as number[];
    if (refs.length === 0 || !refs.every((v) => set.has(v))) continue;
    const copy: Record<string, any> = { ...r };
    for (const f of ID_RULE_FIELDS) {
      if (typeof copy[f] === 'number') copy[f] = idMap.get(copy[f]);
    }
    rulesOut.push(copy);
  }
  return { geoms: geomsOut, rules: rulesOut, idMap };
}

/** Mirror the selected rows about the X axis (y -> -y) or the Y axis
 *  (x -> -x). Arc sense flips under a mirror: the same sweep walked
 *  backwards. */
export function mirrorSelection(
  geoms: CoreGeom[],
  rules: Array<Record<string, any>>,
  ids: number[],
  axis: 'x' | 'y',
): DupResult | null {
  return dupRows(geoms, rules, ids, axis === 'x' ? (p) => ({ x: p.x, y: -p.y }) : (p) => ({ x: -p.x, y: p.y }), (old) => old + 100000);
}

/** Copy the selected rows, shifted by (dx, dy). */
export function copySelection(
  geoms: CoreGeom[],
  rules: Array<Record<string, any>>,
  ids: number[],
  dx: number,
  dy: number,
): DupResult | null {
  return dupRows(geoms, rules, ids, (p) => ({ x: p.x + dx, y: p.y + dy }), (old) => old + 100000);
}

/** Re-dense the ids after duplication: 100000-offset ids are a collision-
 *  free trick, not a representation. Renumber everything to 1..n and rewrite
 *  every rule reference through the map. */
export function densifyIds(geoms: CoreGeom[], rules: Array<Record<string, any>>): { geoms: CoreGeom[]; rules: Array<Record<string, any>> } {
  const sorted = [...geoms].sort((a, b) => a.id - b.id);
  const idMap = new Map<number, number>();
  sorted.forEach((g, i) => idMap.set(g.id, i + 1));
  const geomsOut = sorted.map((g) => {
    const out = { ...g, id: idMap.get(g.id)! };
    return out;
  });
  const ends = ['a', 'b', 'c', 'aEnd', 'bEnd', 'cEnd'] as const;
  const rulesOut = rules.map((r) => {
    const out: Record<string, any> = { ...r };
    for (const e of ends) {
      if (typeof out[e] === 'number') out[e] = idMap.get(out[e]) ?? out[e];
    }
    return out;
  });
  return { geoms: geomsOut, rules: rulesOut };
}
