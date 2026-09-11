// packages/engine/src/sketch-translate.ts
//
// ModelDoc SketchFeature -> FreeCAD Sketcher, per SPEC-engine-port.md §4.5.
//
// Geometry comes from outlineOf() (packages/sketch/src/sketch-arc.ts), never
// from SketchFeature.points directly -- §4.5.1. outlineOf() already turns a
// rounded/chamfered design corner into its trim points + arc, exactly the
// way occt-build.ts's sketchWire() already consumes it; this file emits the
// SAME outline through fc-sketch.mjs's addLine/addArc/addCircle instead of
// OCCT calls.
//
// cornerRefs tracks, for each DESIGN corner index (an index into
// SketchFeature.points), where that corner lives in the FreeCAD sketch --
// the geoId + PointPos (1=start) of whichever outline segment starts at it.
// segmentRoles() (sketch-arc.ts) already says which outline segment "is"
// which design corner (the 'corner' role for a rounded/chamfered one, the
// 'edge' role otherwise) -- both cases resolve to "pointPos 1 of that
// segment", so one rule covers them.
//
// Constraint mapping is §4.5.2's table, DoF closure is §4.5.3, refusal
// wording is §4.5.4.

import type { SketchFeature } from '@shuff57/reshape-script/model-types';
import { arcFromBulge, circleOf, outlineOf, segmentRoles } from '@shuff57/reshape-sketch/sketch-arc';

// This module ships to the browser (bundled into any app that builds
// through FreeCadEngineAdapter -- e.g. packages/sandbox-dev, and, as of the
// 2026-09-11 default-engine flip, every such app by default), where there
// is no global `process`. A bare `process.env...` reference throws
// `ReferenceError: process is not defined` the instant this runs, not just
// when the debug flag is actually wanted -- found live, blocking every
// sketch-based build under the new default. `typeof process !== 'undefined'`
// is the standard guard: unlike referencing `process` directly, `typeof` on
// an undeclared identifier never throws.
const SKETCH_TRANSLATE_DEBUG =
  typeof process !== 'undefined' && !!process.env?.SKETCH_TRANSLATE_DEBUG;

/** 1=start, 2=end, 3=center -- fc-sketch.mjs's own PointPos convention (see
 *  that file's header). */
export type PointPos = 1 | 2 | 3;

/** Where design corner n lives in the FreeCAD sketch -- see the file header. */
export interface CornerRef {
  geoId: number;
  pointPos: PointPos;
}

export type CornerRefMap = Map<number, CornerRef>;

/** The slice of an attachSketchCommands()-wrapped session this file calls.
 *  Loose on purpose, matching lib/occt-build.ts's own `Occt` discipline --
 *  fc-sketch.mjs/fc-commands.mjs are themselves untyped .mjs, so a hand-
 *  written slice naming only what is called here fails loudly at the first
 *  wrong call rather than carrying a duplicate of their JSDoc. */
export interface SketchSession {
  sketchAddLine(sk: string, x1: number, y1: number, x2: number, y2: number): number;
  sketchAddArc(sk: string, cx: number, cy: number, r: number, a0: number, a1: number): number;
  sketchAddCircle(sk: string, cx: number, cy: number, r: number): number;
  constrainHorizontal(sk: string, g: number): number;
  constrainVertical(sk: string, g: number): number;
  constrainDistance(sk: string, g1: number, p1: number, g2: number, p2: number, v: number): number;
  constrainEqual(sk: string, g1: number, g2: number): number;
  constrainParallel(sk: string, g1: number, g2: number): number;
  constrainPerpendicular(sk: string, g1: number, g2: number): number;
  constrainDistanceX(sk: string, g1: number, p1: number, g2: number, p2: number, v: number): number;
  constrainDistanceY(sk: string, g1: number, p1: number, g2: number, p2: number, v: number): number;
  constrainSymmetric(sk: string, g1: number, p1: number, g2: number, p2: number, g3: number, p3: number): number;
  constrainAngle(sk: string, g1: number, g2: number, degrees: number): number;
  constrainRadius(sk: string, g: number, value: number): number;
  constrainCoincident(sk: string, g1: number, p1: number, g2: number, p2: number): number;
  delConstraint(sk: string, cIndex: number): void;
  sketchState(sk: string): {
    geometry: unknown[];
    constraints: unknown[];
    dof: number;
    fully: boolean;
    conflicting: number[];
    redundant: number[];
    malformed: number[];
  };
}

const ORIGIN_GEO = -1;
const ORIGIN_POS: PointPos = 1;

/** Pin one corner's already-solved (x, y) against the sketch origin -- the
 *  `lock` synthesis (§4.5.2's last row), reused verbatim for DoF closure
 *  (§4.5.3 step 4), since a closure pin IS a lock pin, just written for a
 *  corner the student did not explicitly lock. Returns the two new
 *  constraints' own indices -- DoF closure (below) needs them to undo a
 *  pin that turns out to conflict with an already-exact value. */
function pinCornerToOrigin(
  session: SketchSession, sketchName: string, ref: CornerRef, x: number, y: number,
): [xIndex: number, yIndex: number] {
  const xIndex = session.constrainDistanceX(sketchName, ref.geoId, ref.pointPos, ORIGIN_GEO, ORIGIN_POS, x);
  const yIndex = session.constrainDistanceY(sketchName, ref.geoId, ref.pointPos, ORIGIN_GEO, ORIGIN_POS, y);
  return [xIndex, yIndex];
}

/** DoF-closure's own tolerance for "this point is already exactly where we
 *  were about to pin it" (§4.5.3, closure-pin float-tolerance gap). mm --
 *  loose enough to absorb packages/sketch's least-squares solver's own
 *  float residue (measured: ~1e-8 off an exact algebraic answer), tight
 *  enough that a genuinely wrong translation (wrong corner, a sign error,
 *  anything off by a real distance) still refuses instead of being waved
 *  through. */
const CLOSURE_TOLERANCE_MM = 1e-4;

/** Read one point back out of sketchState().geometry -- the same shape
 *  fc-sketch.mjs's state() already returns (id/type/x1/y1/x2/y2/... per
 *  FreeCAD geometry element), by geoId + PointPos (1=start, 2=end -- the
 *  only two DoF closure ever pins; center/pointPos 3 is arc/circle-only,
 *  never a closure target since rounded corners are skipped). Returns null
 *  if the geometry entry or the requested point isn't present -- a caller
 *  extending this to a shape this file does not yet emit, not a bug here. */
function readPoint(geometry: unknown[], geoId: number, pointPos: PointPos): [number, number] | null {
  const entry = (geometry as Array<Record<string, unknown>>).find((g) => g.id === geoId);
  if (!entry) return null;
  const [xKey, yKey] = pointPos === 2 ? ['x2', 'y2'] : pointPos === 1 ? ['x1', 'y1'] : ['cx', 'cy'];
  const x = entry[xKey];
  const y = entry[yKey];
  return typeof x === 'number' && typeof y === 'number' ? [x, y] : null;
}

function refuse(sketch: SketchFeature, message: string): never {
  throw new Error(`sketch ${sketch.id}: ${message}`);
}

/** DoF closure's own per-axis pin (§4.5.3, closure-pin tolerance gap fix).
 *  X and Y are checked SEPARATELY, not as `pinCornerToOrigin`'s bundled
 *  pair -- measured on the real kernel: one axis of a corner can be
 *  genuinely redundant (some OTHER, already-exact constraint chain fixed
 *  it) while the OTHER axis of that SAME corner is genuinely still free.
 *  Bundling them meant either keeping a spurious conflict (refuses
 *  everything) or deleting BOTH (silently dropping real closure on the
 *  informative half -- measured regression: the rounded-rectangle fixture
 *  built with the wrong volume once, 12706.8583 instead of 11935.6194,
 *  from exactly this).
 *
 *  A conflicted pin is undone ONLY when BOTH:
 *  - matches: the point was already within CLOSURE_TOLERANCE_MM of this
 *    value BEFORE this pin (proximity ALONE is not reliable evidence on
 *    its own -- every corner starts out near its target value, since
 *    geometry is always constructed from the solved coordinates to begin
 *    with; see the file header. It is necessary, not sufficient.)
 *  - uninformative: dof did not drop when this pin was added -- the real
 *    signal that it contributed literally nothing new, the actual
 *    definition of redundant, not just numerically close.
 *  Either alone is not enough. Only when both hold is a conflict provably
 *  spurious; otherwise it is a real mismatch and must be left in place for
 *  the final check below to refuse honestly, not hidden. */
function pinAxisIfNeeded(
  session: SketchSession, sketchName: string, ref: CornerRef, axis: 'x' | 'y', value: number,
): void {
  const before = session.sketchState(sketchName);
  const index = axis === 'x'
    ? session.constrainDistanceX(sketchName, ref.geoId, ref.pointPos, ORIGIN_GEO, ORIGIN_POS, value)
    : session.constrainDistanceY(sketchName, ref.geoId, ref.pointPos, ORIGIN_GEO, ORIGIN_POS, value);
  const after = session.sketchState(sketchName);
  if (after.conflicting.length === 0 && after.malformed.length === 0) return;
  const already = readPoint(before.geometry, ref.geoId, ref.pointPos);
  const coord = axis === 'x' ? 0 : 1;
  const matches = already !== null && Math.abs(already[coord] - value) < CLOSURE_TOLERANCE_MM;
  const uninformative = after.dof === before.dof;
  if (SKETCH_TRANSLATE_DEBUG) {
    console.error(
      `DEBUG closure ${axis} pin conflicted (geoId ${ref.geoId} pointPos ${ref.pointPos}): `
      + `before.dof=${before.dof} after.dof=${after.dof} already=${JSON.stringify(already)} `
      + `target=${value} matches=${matches} uninformative=${uninformative}`,
    );
  }
  if (matches && uninformative) session.delConstraint(sketchName, index);
}

/**
 * Translate one ModelDoc SketchFeature into the given (already-created,
 * empty) FreeCAD sketch: geometry, every constraint, DoF closure, refusal
 * policy. Returns the corner-reference map a caller building a Pad/Pocket
 * profile off named design edges would need (kept for symmetry with the
 * spec's own signature sketch; nothing in this phase's build() reads it back
 * -- Pad/Pocket target the sketch OBJECT, not individual corners).
 *
 * Per §4.5.4: any constraint this cannot translate, or a DoF that will not
 * close, throws -- the WHOLE sketch build refuses, matching model-types.ts's
 * whyCannotRound() tone (plain-fact refusals, not stack traces) but as a
 * thrown Error, matching this file's own caller (FreeCadEngineAdapter.build())
 * and step 7's "throw a clear message" pattern for anything this engine
 * cannot honestly build.
 */
export function translateSketch(
  session: SketchSession, sketchName: string, sketch: SketchFeature,
): CornerRefMap {
  const cornerRefs: CornerRefMap = new Map();

  // ---- Circle: a tag, not a polygon (SketchFeature.shape) -----------------
  // circleOf()/outlineOf() agree: shape==='circle' is read from the tag
  // alone, never inferred from point count. A circle sketch never carries
  // per-corner constraints (model-types.ts's whyCannotRound: "a circle has
  // no corners"), so it is pinned directly (radius + center) and returns an
  // empty cornerRefs map.
  const circle = circleOf(sketch);
  if (circle) {
    const gid = session.sketchAddCircle(sketchName, circle.center[0], circle.center[1], circle.radius);
    session.constrainRadius(sketchName, gid, circle.radius);
    session.constrainDistanceX(sketchName, gid, 3, ORIGIN_GEO, ORIGIN_POS, circle.center[0]);
    session.constrainDistanceY(sketchName, gid, 3, ORIGIN_GEO, ORIGIN_POS, circle.center[1]);
    const state = session.sketchState(sketchName);
    if (state.conflicting.length > 0 || state.malformed.length > 0) {
      refuse(sketch, `circle geometry conflicts on the FreeCAD engine (conflicting: ${state.conflicting.join(',')}, malformed: ${state.malformed.join(',')})`);
    }
    return cornerRefs;
  }

  // ---- Straight/curved outline --------------------------------------------
  const outline = outlineOf(sketch);
  if (!outline.ok) refuse(sketch, outline.why ?? 'outline collapsed before it reached the FreeCAD engine');
  const pts = outline.points;
  const bulges = outline.bulges ?? {};
  const n = pts.length;
  if (n < 3) refuse(sketch, `outline has only ${n} point(s) -- nothing to build`);
  const roles = segmentRoles(outline.basis);

  // §4.5.1: emit geometry via outlineOf()'s segments, tracking each design
  // corner's CornerRef as its segment is emitted. `index` on a segmentRoles()
  // row is a DESIGN CORNER for a 'corner' row but a DESIGN EDGE for an 'edge'
  // row -- two DIFFERENT numberings that happen to share the same 0..n-1
  // range (a closed polygon has as many edges as corners), so a rounded
  // corner k's own 'corner' row (index=k) and the SEPARATE 'edge' row for
  // design edge k (also index=k, per segmentRoles()'s own worked example --
  // rounding corner 2 of a square yields basis [0,1,2,2,3], where segment 2
  // is corner-role index 2 (the arc) AND segment 3 is edge-role index 2
  // (design edge 2, now starting at the arc's own trim point, NOT at corner
  // 2's own position)) MUST be kept in separate maps. Collapsing them into
  // one map keyed by that shared index -- an earlier version of this file
  // did exactly that -- let the edge row silently overwrite the corner row,
  // so a rounded corner's CornerRef pointed at a trim point offset from the
  // corner instead of at the round itself; caught by
  // packages/engine/test/sketch-translate.test.mjs's rounded-rectangle case.
  const geoIds: number[] = [];
  const edgeRoleSeg = new Map<number, number>();
  const cornerRoleSeg = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const bulge = bulges[i];
    let gid: number;
    if (!bulge) {
      gid = session.sketchAddLine(sketchName, a[0], a[1], b[0], b[1]);
    } else {
      const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
      // FreeCAD's Part.ArcOfCircle(circle, a0, a1) sweeps from a0 toward a1;
      // this normalises a1 relative to a0 so that direction matches the
      // bulge's own sign (positive = CCW), same convention sketch-arc.ts's
      // own signedSweep() encodes. The positive-bulge case (a CCW-wound,
      // convex-cornered outline -- the case the rounded-rectangle self-check
      // fixture exercises) always lands with a0 < a1 here and is unambiguous
      // regardless of the constructor's own wrap behaviour; a negative-bulge
      // (clockwise) arc is NOT covered by that fixture and is UNVERIFIED
      // against the real kernel -- see this port's own report.
      let a0 = startAngle;
      let a1 = endAngle;
      if (bulge > 0 && a1 < a0) a1 += 2 * Math.PI;
      if (bulge < 0 && a1 > a0) a1 -= 2 * Math.PI;
      gid = session.sketchAddArc(sketchName, center[0], center[1], radius, a0, a1);
      // An arc's construction values are only the solver's STARTING guess,
      // not a fixed fact -- nothing tells the GCS to keep them there. Two
      // real bugs found here, in order, both via the actual GCS solver:
      // (1) pinning only radius+center left a0/a1 free -- the weld to each
      // neighbour (below) ties the arc's endpoints to THEIR position, but
      // if those neighbours are themselves only pinned at ONE end (the far
      // corner), the near end can still slide around the now-fixed circle:
      // "3 degree(s) of freedom" (radius+center) closed the circle itself,
      // but left exactly 2 more (a0, a1) for the solver to report next.
      // (2) the fix is to pin what is actually already known exactly --
      // `a`/`b` above ARE the arc's own start/end trim points, computed by
      // outlineOf() the same as any line's endpoints -- so pin those
      // directly (matching every other segment's own endpoints) instead of
      // trying to fix the circle's abstract parameters and hoping the welds
      // propagate an angle. Radius stays pinned too (start+end alone still
      // admit two circles through the same chord; the construction's own
      // center is the correct one, and a solver seeded there converges to
      // it, not its mirror).
      session.constrainRadius(sketchName, gid, radius);
      pinCornerToOrigin(session, sketchName, { geoId: gid, pointPos: 1 }, a[0], a[1]);
      pinCornerToOrigin(session, sketchName, { geoId: gid, pointPos: 2 }, b[0], b[1]);
    }
    geoIds.push(gid);
    const role = roles[i];
    if (role.role === 'edge') edgeRoleSeg.set(role.index, i);
    else cornerRoleSeg.set(role.index, i);
  }

  // Weld the loop shut. sketchAddLine()/sketchAddArc() each create an
  // independent geometry element with its OWN two endpoints -- FreeCAD's
  // Sketcher does NOT infer that segment i's end sits at segment i+1's
  // start just because outlineOf() computed matching coordinates for both.
  // Without an explicit Coincident constraint per shared vertex, those
  // "same point" endpoints remain two separate, independently-free points
  // (found the hard way: DoF closure below pinned every design corner's
  // OWN point and the real GCS solver still reported n*2 degrees of
  // freedom left over -- exactly the n segments' unwelded END points,
  // never referenced by cornerRefs at all since cornerRefs only ever
  // tracks pointPos 1 (§4.5.1). fc-sketch.mjs's own worked example
  // (this file's header comment) already does exactly this weld for its
  // 4-line demo; this loop generalises it to n segments, straight or arc).
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    session.constrainCoincident(sketchName, geoIds[i], 2, geoIds[next], 1);
  }

  // A rounded/chamfered corner's ref resolves to its OWN 'corner'-role
  // segment (the arc, or the flat chamfer edge) when one exists; otherwise
  // to the 'edge'-role segment for that same number, whose start point IS
  // the corner (§4.5.1: "Plain, unrounded corner n is the start point of
  // the line segment emitted for edge n").
  const cornerCount = sketch.points.length;
  // Tracks which design corners resolved through the ARC branch (a rounded
  // corner), not the plain-line one -- §4.5.3's closure loop below must NOT
  // pin these against sketch.points[c]: rounding TRIMS the corner, so the
  // arc's actual start point sits at outlineOf()'s trim point, not at the
  // original design coordinate. Pinning both (the arc's own radius/center
  // constraints above, which already fully determine where its start point
  // must land, AND a closure pin at the wrong, untrimmed coordinate) is a
  // genuine conflict, not redundancy -- found via the real GCS solver
  // reporting "DoF-closure pins conflicted" the first time this ran.
  const roundedCorners = new Set<number>();
  for (let c = 0; c < cornerCount; c++) {
    const arcSeg = cornerRoleSeg.get(c);
    const segIdx = arcSeg ?? edgeRoleSeg.get(c);
    if (segIdx === undefined) continue; // no surviving segment for this design corner -- refused lazily below if referenced
    if (arcSeg !== undefined) roundedCorners.add(c);
    cornerRefs.set(c, { geoId: geoIds[segIdx], pointPos: 1 });
  }

  const geoIdForEdge = (e: number): number => {
    const segIdx = edgeRoleSeg.get(e);
    if (segIdx === undefined) {
      refuse(sketch, `edge ${e} could not be found in the built outline (rounded/chamfered away, or out of range)`);
    }
    return geoIds[segIdx];
  };
  const refForCorner = (c: number): CornerRef => {
    const ref = cornerRefs.get(c);
    if (!ref) refuse(sketch, `corner ${c} could not be found in the built outline`);
    return ref;
  };

  // ---- §4.5.2: every explicit constraint -----------------------------------
  for (const c of sketch.constraints ?? []) {
    if (c.kind === 'horizontal') {
      session.constrainHorizontal(sketchName, geoIdForEdge(c.edge));
    } else if (c.kind === 'vertical') {
      session.constrainVertical(sketchName, geoIdForEdge(c.edge));
    } else if (c.kind === 'length') {
      const g = geoIdForEdge(c.edge);
      session.constrainDistance(sketchName, g, 1, g, 2, c.value);
    } else if (c.kind === 'equal') {
      session.constrainEqual(sketchName, geoIdForEdge(c.edge), geoIdForEdge(c.other));
    } else if (c.kind === 'parallel') {
      session.constrainParallel(sketchName, geoIdForEdge(c.edge), geoIdForEdge(c.other));
    } else if (c.kind === 'perpendicular') {
      session.constrainPerpendicular(sketchName, geoIdForEdge(c.edge), geoIdForEdge(c.other));
    } else if (c.kind === 'distanceX') {
      const ra = refForCorner(c.a);
      const rb = refForCorner(c.b);
      session.constrainDistanceX(sketchName, ra.geoId, ra.pointPos, rb.geoId, rb.pointPos, c.value);
    } else if (c.kind === 'distanceY') {
      const ra = refForCorner(c.a);
      const rb = refForCorner(c.b);
      session.constrainDistanceY(sketchName, ra.geoId, ra.pointPos, rb.geoId, rb.pointPos, c.value);
    } else if (c.kind === 'symmetric') {
      const ra = refForCorner(c.a);
      const rb = refForCorner(c.b);
      const rc = refForCorner(c.center);
      session.constrainSymmetric(
        sketchName, ra.geoId, ra.pointPos, rb.geoId, rb.pointPos, rc.geoId, rc.pointPos,
      );
    } else if (c.kind === 'angle') {
      // Sign convention: UNVERIFIED against the real kernel (no wasm runtime
      // available in this port's environment -- see this port's own
      // report). sketch-solve.ts's residual is a signed turn from edge to
      // other via atan2(cross, dot); this assumes FreeCAD's own Angle
      // constraint between two line geoIds measures the same signed turn
      // between the lines' own start->end directions, which is why every
      // line here is emitted start->end exactly as edgeCorners() orders it
      // (corner n -> corner n+1) -- the same direction sketch-solve.ts's
      // residual reads. Degrees pass through unconverted; fc-sketch.mjs's
      // own constrainAngle() already does the (measured, verified) degrees
      // -> radians conversion.
      session.constrainAngle(sketchName, geoIdForEdge(c.edge), geoIdForEdge(c.other), c.degrees);
    } else if (c.kind === 'lock') {
      // A rounded corner's arc is already fully pinned (radius + center,
      // emitted above) -- sketch.points[c.corner] is the PRE-round design
      // coordinate, not where the trimmed arc's start point actually lives,
      // so locking to it would fight the arc's own constraints exactly the
      // way the closure loop below found out the hard way. Refuse rather
      // than pin the wrong point.
      if (roundedCorners.has(c.corner)) {
        refuse(sketch, `corner ${c.corner} cannot be locked -- it is a rounded/chamfered corner, whose built position is not sketch.points[${c.corner}]`);
      }
      const ref = refForCorner(c.corner);
      const [x, y] = sketch.points[c.corner];
      pinCornerToOrigin(session, sketchName, ref, x, y);
    } else {
      refuse(sketch, `constraint kind '${(c as { kind: string }).kind}' has no FreeCAD equivalent`);
    }
  }

  // ---- §4.5.3: DoF closure --------------------------------------------------
  let state = session.sketchState(sketchName);
  if (SKETCH_TRANSLATE_DEBUG) {
    console.error('DEBUG pre-closure state:', JSON.stringify({ dof: state.dof, conflicting: state.conflicting, redundant: state.redundant, malformed: state.malformed }));
    console.error('DEBUG cornerRefs:', JSON.stringify([...cornerRefs.entries()]));
    console.error('DEBUG geometry:', JSON.stringify(state.geometry));
  }
  if (state.conflicting.length > 0 || state.malformed.length > 0) {
    refuse(
      sketch,
      `constraints conflict on the FreeCAD engine (conflicting constraint indices: `
        + `${state.conflicting.join(',')}; malformed: ${state.malformed.join(',')})`,
    );
  }
  if (state.dof > 0) {
    // Pin EVERY design corner, not only the ones sk.DoF would call free --
    // fc-sketch.mjs's state() reports only the AGGREGATE dof, with no
    // per-point breakdown, so there is no cheap way to ask "which corners
    // specifically". X and Y are pinned and checked SEPARATELY
    // (pinAxisIfNeeded, above) -- see that function's own comment for why
    // bundling them (an earlier version of this loop did) is unsafe: one
    // axis of a corner can be genuinely redundant while the other is
    // genuinely still free, and undoing both together silently dropped the
    // needed one (measured regression, now fixed -- see git history/
    // SPEC-engine-port.md §6.3 for the full account).
    for (let c = 0; c < cornerCount; c++) {
      // A rounded corner's arc is already fully pinned above (radius +
      // center) -- its start point is DETERMINED by that, not free, and
      // sketch.points[c] is the wrong (pre-round) coordinate to pin it to
      // even if it were still free. Pinning it anyway does not add missing
      // DoF closure, it manufactures a conflict against constraints already
      // in place (found via the real GCS solver's own "DoF-closure pins
      // conflicted" report).
      if (roundedCorners.has(c)) continue;
      const ref = cornerRefs.get(c);
      if (!ref) continue;
      const [x, y] = sketch.points[c];
      if (SKETCH_TRANSLATE_DEBUG) {
        console.error(`DEBUG closure pin corner ${c}: geoId ${ref.geoId} pointPos ${ref.pointPos} -> (${x}, ${y})`);
      }
      pinAxisIfNeeded(session, sketchName, ref, 'x', x);
      pinAxisIfNeeded(session, sketchName, ref, 'y', y);
    }
    state = session.sketchState(sketchName);
    if (SKETCH_TRANSLATE_DEBUG) {
      console.error('DEBUG post-closure state:', JSON.stringify({ dof: state.dof, conflicting: state.conflicting, redundant: state.redundant, malformed: state.malformed }));
      console.error('DEBUG post-closure geometry:', JSON.stringify(state.geometry));
    }
    if (state.conflicting.length > 0 || state.malformed.length > 0) {
      refuse(
        sketch,
        `DoF-closure pins conflicted on the FreeCAD engine (conflicting: ${state.conflicting.join(',')}, `
          + `malformed: ${state.malformed.join(',')})`,
      );
    }
    if (state.dof !== 0) {
      refuse(sketch, `DoF closure left ${state.dof} degree(s) of freedom unpinned -- a translation bug, not a geometry problem`);
    }
  }

  return cornerRefs;
}
