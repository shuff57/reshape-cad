'use client';

// Drag handles, drawn as plain divs on top of the preview frame.
//
// The runner projects each anchor and hands back where it landed, which way it
// slides on screen, and how many pixels one unit covers there. So a drag is
// arithmetic: project the pointer movement onto that direction and divide.
//
// The frame is sandboxed and would swallow every pointer event, so the handle
// captures the pointer on mousedown. That also stops the orbit controls seeing
// the drag, which is what keeps the model still while a dimension moves.
//
// A sketch's own corners are no longer dragged here -- SketchCanvas2D's 2D
// canvas is the only place a sketch is edited now. `outlines`/`outlineAnchors`
// below exist purely so a selected (or on-screen, unconsumed) sketch still
// shows its shape for reference; there is no handle, hover, or selection
// machinery left in this file for a sketch's own geometry.

import { useEffect, useRef, useState } from 'react';
import { arcFromBulge, type Point } from '@shuff57/reshape-sketch/sketch-arc';
import ValueBox, { formatValue } from './ValueBox.js';
import { manipulatorParam, manipulatorValue, manipulatorValueError, type ManipulatorKind } from './manipulator-core.js';
import type { Feature, ModelDoc } from '@shuff57/reshape-script/model-types';
/**
 * One sketch's outline, in plane coordinates -- what the overlay needs to
 * draw it as a read-only reference shape, alongside the corner param names
 * used to look up each corner's projected anchor. `shape`/`bulges` mirror
 * SketchFeature exactly; this is a plain data carrier, not a re-derivation
 * of the doc.
 */
export interface SketchOutline {
  /** Param name of each DESIGN corner's u-value, in order -- the key
   *  `outlineAnchors` is looked up by. One per corner the student placed; a
   *  rounded corner is still one entry, not two. */
  corners: string[];
  /** The same design corners' plane coordinates, parallel to `corners`. */
  design: Point[];
  /** The DERIVED outline in plane coordinates -- what actually gets drawn.
   *  Equal to `design` for a sketch with nothing rounded. Never a source of
   *  truth: outlineOf() produces it, and nothing may write it back. */
  points: Point[];
  /** Parallel to `points`: which design corner each outline point projects
   *  through. Both trim points of a rounded corner carry that corner, which
   *  is what lets a derived point ride a real anchor -- there is no anchor of
   *  its own to ride, and that is the whole point of the split. */
  basis: number[];
  shape?: 'circle';
  bulges?: Record<number, number>;
}

export interface AnchorPoint {
  param: string;
  label: string;
  kind?: 'size' | 'move' | 'turn' | 'point' | 'radius';
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  pxPerUnit: number;
  /** Screen pixels per world unit along the handle's axis, as a vector. */
  ux?: number;
  uy?: number;
  /** Present only for handles that move in a plane rather than along a line. */
  paramV?: string;
  vx?: number;
  vy?: number;
}

interface Props {
  points: AnchorPoint[];
  /** Current model value per parameter — the drag starts from this. */
  values: Record<string, unknown>;
  /** How much the dimension moves per unit the handle moves. */
  scales: Record<string, number>;
  onDrag: (param: string, value: number) => void;
  /** Any sketch on screen, so its outline can be drawn as a read-only
   *  reference shape -- see SketchOutline's own doc comment. */
  outlines?: SketchOutline[];
  /**
   * The anchor set `outlines` projects through -- a sketch's own corner
   * anchors included, which `points` above deliberately excludes (a sketch
   * is edited in SketchCanvas2D now, not by dragging a corner here). Falls
   * back to `points` when absent, so a caller with nothing sketch-specific
   * to project need not pass it at all.
   */
  outlineAnchors?: AnchorPoint[];
  /** Called once when the drag ends, to fold the result back into the doc. */
  onCommit: () => void;
  /**
   * Fired instead of a drag when a pointerdown+pointerup on a handle moved
   * less than TAP_TOLERANCE_PX -- a tap, not a drag. Must act exactly as a
   * click on the canvas underneath the handle would: this component emits
   * no `onDrag` and no `onCommit` for that interaction, so the caller is
   * expected to run its own pick (face/edge) at this point instead. Absent
   * means a tap on a handle does nothing, same as before this prop existed.
   */
  onTap?: (clientX: number, clientY: number) => void;
  /**
   * How much of the layer's OWN bottom edge to leave uncovered, in CSS
   * pixels. Defaults to 0 -- plain `inset:0`, filling its containing block
   * exactly.
   *
   * GEOMETRY NOW (docked grid, adoption step 2, 2026-09-16): the timeline is
   * a grid row OUTSIDE the pane-view, and the status bar is outside too, so
   * normal bottomInset is 0. The prop remains for hosts that reserve bottom
   * space in the pane-view itself (e.g. old hosts passing 84).
   *
   * MECHANICS, for hosts that do pass it: `inset:0` ON AN ABSOLUTELY
   * POSITIONED ELEMENT RESOLVES AGAINST THE CONTAINING BLOCK'S PADDING
   * EDGE, NOT ITS CONTENT EDGE -- a genuine CSS rule, not a bug, but one the
   * host that renders this overlay got backwards for a while. SandboxWorkspace.tsx's Build mode reserves
   * space for its timeline strip with `padding-bottom` on the shared
   * container this layer sits in, on the (documented, and wrong) assumption
   * that padding on that ancestor would shrink this layer the same way it
   * shrinks the flex-sized render surface (the JSCAD iframe, or
   * BrepViewportThree's canvas) beside it. It does not: a flex child
   * respects its container's padding because it lays out in the CONTENT
   * box; this layer's own `inset:0` still measures against the fuller
   * PADDING box, so it stood exactly as many pixels taller as the padding
   * reserved -- measured directly on BOTH render paths, same gap, same
   * cause, not something specific to either engine. Passing that same
   * reservation back in here is what makes the two match again.
   */
  bottomInset?: number;
  /**
   * Phase 5.1's arrow+value-box manipulator (todo 22). The currently
   * selected feature and the doc to read its committed value from; when
   * the feature kind carries a single positive-extent parameter (extrude
   * height / pocket depth / fillet size) the projected anchor for that
   * parameter grows an on-canvas ARROW and a floating drag-or-type value
   * box at its tip. Dragging stays the existing push/commit flow (the
   * same rAF coalescer, one undo step on pointerup); typing commits
   * through the same param name on Enter, so both paths converge on one
   * parameter-update call. Refused text leaves the doc alone, in a
   * sentence. Absent (Code mode, or no selection) draws nothing new.
   */
  manipulator?: { feature: Feature; doc: ModelDoc; onDragParam: (param: string, value: number) => void; onCommitParam: () => void } | null;
}

/**
 * A plane point Q, projected through corner `basis`'s own screen anchor --
 * P0.screen + (Q.u - P0.u)*(ux,uy) + (Q.v - P0.v)*(vx,vy). Pure client
 * arithmetic: the runner projects only the real corner anchors, and this
 * reuses that one affine step for every sampled point along a curve, rather
 * than round-tripping 48 points per circle through the runner every frame.
 *
 * `basis` is deliberately the curve's OWN nearby corner, not one shared
 * origin for the whole sketch -- that bounds how far the affine assumption
 * has to carry a point before perspective drift shows up on screen.
 */
function projectFrom(basis: AnchorPoint, basisPlane: Point, q: Point): { x: number; y: number } {
  const du = q[0] - basisPlane[0];
  const dv = q[1] - basisPlane[1];
  return {
    x: basis.x + du * (basis.ux ?? 0) + dv * (basis.vx ?? 0),
    y: basis.y + du * (basis.uy ?? 0) + dv * (basis.vy ?? 0),
  };
}

/** The outline's screen points, or null when a corner anchor is not on
 *  screen (edge-on plane, same fallback the old flat rendering already had
 *  via its `pts.length < 2` skip).
 *
 *  `basis` is parallel to `pts` and says which DESIGN corner each screen point
 *  rides -- the same mapping `SketchOutline.basis` carries, extended to cover
 *  the arc samples generated here. It is what lets one design edge be picked
 *  back out of a tessellated outline. A circle returns `basis: null`: its ring
 *  is sampled off two anchors and has no edges to index. */
function projectOutline(
  o: SketchOutline,
  at: Map<string, AnchorPoint>,
): { pts: { x: number; y: number }[]; basis: number[] | null } | null {
  const anchors = o.corners.map((c) => at.get(c));
  if (anchors.some((a) => !a || a.ux === undefined || a.uy === undefined)) return null;
  const A = anchors as AnchorPoint[];

  if (o.shape === 'circle' && o.points.length === 2) {
    const [c0, c1] = o.design;
    const center: Point = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];
    const radius = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) / 2;
    const start = Math.atan2(c0[1] - center[1], c0[0] - center[0]);
    const samples = 48;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < samples; i++) {
      const t = start + (i / samples) * Math.PI * 2;
      const q: Point = [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
      // Half the ring off each real anchor's own basis, so neither half ever
      // carries the affine assumption further than a quarter turn.
      const half = i < samples / 2 ? 0 : 1;
      out.push(projectFrom(A[half], o.design[half], q));
    }
    return { pts: out, basis: null };
  }

  const out: { x: number; y: number }[] = [];
  const basisOut: number[] = [];
  const count = o.points.length;
  // Every point is projected through its BASIS corner's anchor, not through
  // an anchor of its own: an outline point derived from a fillet has no
  // anchor, because it is not a handle and must never become one.
  const basisOf = (i: number) => {
    const b = o.basis[i];
    return Number.isInteger(b) && b >= 0 && b < A.length ? b : 0;
  };
  for (let i = 0; i < count; i++) {
    const bi = basisOf(i);
    out.push(projectFrom(A[bi], o.design[bi], o.points[i]));
    basisOut.push(bi);
    const bulge = o.bulges?.[i];
    if (!bulge) continue;
    const a = o.points[i];
    const b = o.points[(i + 1) % count];
    const { center, radius, startAngle, endAngle } = arcFromBulge(a, b, bulge);
    let sweep = endAngle - startAngle;
    if (bulge > 0 && sweep < 0) sweep += Math.PI * 2;
    if (bulge < 0 && sweep > 0) sweep -= Math.PI * 2;
    const samples = Math.max(8, Math.ceil(Math.abs(sweep) / ((7.5 * Math.PI) / 180)));
    for (let s = 1; s < samples; s++) {
      const t = startAngle + sweep * (s / samples);
      const q: Point = [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)];
      // The edge's own start point rides its basis corner, and so does every
      // sample along it -- which for a fillet arc is the corner it rounded.
      out.push(projectFrom(A[bi], o.design[bi], q));
      basisOut.push(bi);
    }
  }
  return { pts: out, basis: basisOut };
}

/** How far the pointer may travel between down and up before a handle
 *  interaction counts as a drag rather than a tap -- see onTap's own doc
 *  comment. Screen pixels, not world units: a tap has to feel the same
 *  regardless of what the handle happens to be scaled to right now. */
const TAP_TOLERANCE_PX = 4;

/** Phase 5.1: the manipulator arrow's screen length. Fixed, like every
 *  other overlay chrome here -- a world-scaled arrow would shrink to a dot
 *  when the student zooms out to see the whole part, exactly when they
 *  need the direction most. */
const MANI_ARROW_PX = 64;

/** A triangular arrowhead at the END of a line from (x0,y0) along
 *  (dx,dy), at travel `at` px. Pure screen arithmetic, kept beside the
 *  SVG that draws it. */
function arrowHead(x0: number, y0: number, dx: number, dy: number, at: number): string {
  const tipX = x0 + dx * at;
  const tipY = y0 + dy * at;
  const px = -dy;
  const py = dx;
  const backX = x0 + dx * (at - 10);
  const backY = y0 + dy * (at - 10);
  return [
    `${tipX},${tipY}`,
    `${backX + px * 4},${backY + py * 4}`,
    `${backX - px * 4},${backY - py * 4}`,
  ].join(' ');
}

export default function HandleOverlay({
  points, values, scales, onDrag, onCommit, onTap, outlines, outlineAnchors, bottomInset = 0, manipulator,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  // Whether the current pointerdown-to-pointerup has crossed TAP_TOLERANCE_PX
  // yet. A click on a handle (e.g. the height handle sitting over a face's
  // own centre) must still pick that face -- see onTap's own doc comment --
  // so a real drag has to be told apart from a tap that never left the spot.
  const dragStarted = useRef(false);
  // The layer's own DOM node, so a click's viewport position can be converted
  // to the same container-relative space the anchor x/y already use. Handles
  // only ever need DELTAS from their own pointerdown, so nothing needed this
  // before -- the click-catcher is the first consumer of an absolute position.
  const layerRef = useRef<HTMLDivElement>(null);
  // Pixels the pointer has travelled along the handle's own screen direction.
  // The dragged handle is drawn from this rather than from the runner's next
  // reply, so its position owes nothing to the rebuild round-trip.
  const [alongPx, setAlongPx] = useState(0);
  const start = useRef({ x: 0, y: 0, value: 0, ax: 0, ay: 0 });
  const raf = useRef<number | null>(null);
  const pending = useRef<{ param: string; value: number }[]>([]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  // One update per frame. A pointer can fire far faster than a rebuild
  // finishes, and every extra send is geometry that is stale before it lands.
  function push(updates: { param: string; value: number }[]) {
    pending.current = updates;
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const items = pending.current;
      pending.current = [];
      for (const { param, value } of items) onDrag(param, value);
    });
  }

  // Same trap as a text field: pointerup is synchronous and the frame callback
  // above has not run, so committing without flushing commits nothing.
  function commit() {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    const items = pending.current;
    pending.current = [];
    for (const { param, value } of items) onDrag(param, value);
    onCommit();
  }

  // Sketch anchors may be the ONLY anchors present (a lone selected sketch --
  // solid handles come only from solids, and sketch anchors are excluded from
  // `points` above on purpose), so the old `!points.length` early return here
  // unmounted the WHOLE overlay and took the read-only outline with it. The
  // layer now renders whenever there is anything to show; the outline path
  // below reads `outlineAnchors`, not `points`.
  const hasHandles = points.length > 0;
  const outlineAnchorsAt = new Map((outlineAnchors ?? points).map((p) => [p.param, p]));
  // Every sketch's outline is drawn as a plain read-only reference shape --
  // no labels, no marks, no hit-testing. A student edits a sketch in
  // SketchCanvas2D's own 2D canvas; this exists only so the 3D viewport still
  // shows what a selected (or on-screen, unconsumed) sketch looks like.
  const outlineRenders = (outlines ?? [])
    .map((o, n) => {
      const projected = projectOutline(o, outlineAnchorsAt);
      if (!projected || projected.pts.length < 2) return null;
      return { n, pts: projected.pts };
    })
    .filter((r): r is { n: number; pts: { x: number; y: number }[] } => r !== null);

  // ---- Phase 5.1 manipulator: arrow + drag-or-type value box -------------
  // ---- Phase 5.1 manipulator: arrow + drag-or-type value box -------------
  // The single selected feature's own handle, located among the projected
  // anchors by its generated-param name. Everything below is null when
  // there is no manipulator prop, the feature carries no single positive-
  // extent parameter, or its anchor is not currently on screen.
  const mani = manipulator ? manipulatorParam(manipulator.feature) : null;
  const maniAnchor = mani
    ? points.find((a) => a.param === mani.param && (a.kind === 'size' || a.kind === 'radius'))
    : undefined;
  const maniValue = mani && manipulator ? manipulatorValue(manipulator.doc, mani.param) : null;
  // Typed text for the value box, parent-of-the-box owned. Kept OUTSIDE the
  // early return below (hooks order) and keyed by param so a selection
  // change starts from that feature's own committed value instead of the
  // previous feature's draft.
  const [maniDraft, setManiDraft] = useState<{ param: string; text: string } | null>(null);
  const [maniNote, setManiNote] = useState<string | null>(null);
  const maniShownText = mani && maniDraft?.param === mani.param ? maniDraft.text : maniValue != null ? formatValue(maniValue) : '';
  /** The type half of drag-or-type. The same param name the drag pushes
   *  (mani.param) -- the convergence the todo's acceptance criteria name.
   *  A refusal shows the sentence and writes nothing, exactly like the
   *  sketch dimension chips. */
  const commitManiText = () => {
    if (!mani || !manipulator) return;
    const text = maniDraft?.param === mani.param ? maniDraft.text : '';
    const err = manipulatorValueError(mani.kind as ManipulatorKind, text);
    if (err) {
      setManiNote(err);
      return;
    }
    setManiNote(null);
    setManiDraft(null);
    manipulator.onDragParam(mani.param, Number(text.trim()));
    manipulator.onCommitParam();
  };

  if (!hasHandles && outlineRenders.length === 0 && !(mani && maniAnchor)) return null;

  return (
    <div
      className="handle-layer"
      ref={layerRef}
      // Inline, so it wins over the class's plain `inset:0` for this one
      // side without a second class or a !important -- see bottomInset's own
      // doc comment on Props for why the class alone cannot know this.
      style={bottomInset ? { bottom: bottomInset } : undefined}
    >
      {/* The outline is drawn, not built. A sketch is a flat profile, not a
          solid, so the renderer has nothing to show for it until something
          extrudes it -- but a student needs to see what they are drawing. */}
      {outlineRenders.length > 0 && (
        <svg className="sketch-lines" aria-hidden="true">
          {outlineRenders.map(({ n, pts }) => (
            <polygon key={n} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
          ))}
        </svg>
      )}
      {points.map((a) => {
        const on = dragging === a.param;
        const raw = values[a.param];
        // While dragging, the anchor is frozen at where it was when the drag
        // began and offset by the pointer. Measured before this: the handle
        // trailed the pointer by 13px on average and 27px at worst, because
        // every position came back over a round-trip.
        const left = on ? start.current.ax + alongPx * a.dirX : a.x;
        const top = on ? start.current.ay + alongPx * a.dirY : a.y;
        return (
          <button
            key={a.param}
            type="button"
            className={
              'handle'
              + (a.kind === 'move' ? ' is-move'
                 : a.kind === 'turn' ? ' is-turn'
                 : a.kind === 'radius' ? ' is-radius' : '')
              + (on ? ' is-on' : '')
            }
            style={{ left, top }}
            aria-label={`Drag ${a.label}`}
            title={`${a.label}${typeof raw === 'number' ? ` — ${Math.round(raw * 100) / 100}` : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const v = typeof raw === 'number' ? raw : 0;
              start.current = { x: e.clientX, y: e.clientY, value: v, ax: a.x, ay: a.y };
              dragStarted.current = false;
              setAlongPx(0);
              setDragging(a.param);
            }}
            onPointerMove={(e) => {
              if (dragging !== a.param) return;
              const dx = e.clientX - start.current.x;
              const dy = e.clientY - start.current.y;
              // Below tolerance: hold still. No visual move, no push() --
              // this is what keeps a tap from ever reaching onDrag as a
              // zero-length drag. Once it crosses, the rest of this handler
              // is unchanged and computes off the FULL delta from pointerdown,
              // so nothing is lost by having ignored the small moves before it.
              if (!dragStarted.current) {
                if (Math.hypot(dx, dy) < TAP_TOLERANCE_PX) return;
                dragStarted.current = true;
              }
              const px = dx * a.dirX + dy * a.dirY;
              setAlongPx(px);
              const next = start.current.value + (px / a.pxPerUnit) * (scales[a.param] ?? 1);
              const rounded = Math.round(next * 100) / 100;
              // The 0.1 floor is a SIZE thing (no zero/negative width). A
              // move handle is a position and a turn handle is an angle --
              // both cross zero legitimately, so clamping them the same way
              // pinned every negative-direction drag at exactly 0.1 (dogfood
              // 2026-09-14, handle-dogfood report).
              const clamped = a.kind === 'move' || a.kind === 'turn' ? rounded : Math.max(0.1, rounded);
              push([{ param: a.param, value: clamped }]);
            }}
            onPointerUp={(e) => {
              try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* gone */ }
              const wasDrag = dragStarted.current;
              setDragging(null);
              setAlongPx(0);
              if (wasDrag) {
                commit();
              } else {
                // A tap: act exactly as a click on the canvas at this point
                // would, instead of committing a zero-length drag.
                onTap?.(e.clientX, e.clientY);
              }
            }}
            onPointerCancel={() => {
              const wasDrag = dragStarted.current;
              setDragging(null); setAlongPx(0);
              if (wasDrag) commit();
            }}
          />
        );
      })}
      {/* Phase 5.1: the on-canvas ARROW for the manipulator's handle -- an
          SVG line from the anchor along its projected axis, arrowhead at
          the far end, with the drag-or-type value box riding the tip. The
          arrow IS the existing handle's direction made visible: dragging
          the tip still drives the same handle drag flow, so pointer
          capture and the one-undo-on-pointerup convention come along for
          free. */}
      {mani && maniAnchor && maniValue != null && (
        <svg className="mani-arrow" data-manipulator={mani.kind} aria-hidden="true">
          <line
            x1={maniAnchor.x}
            y1={maniAnchor.y}
            x2={maniAnchor.x + maniAnchor.dirX * MANI_ARROW_PX}
            y2={maniAnchor.y + maniAnchor.dirY * MANI_ARROW_PX}
          />
          <polygon
            points={arrowHead(
              maniAnchor.x, maniAnchor.y,
              maniAnchor.dirX, maniAnchor.dirY,
              MANI_ARROW_PX,
            )}
          />
        </svg>
      )}
      {mani && maniAnchor && maniValue != null && manipulator && (
        <div className="mani-value-wrap">
          <ValueBox
            testId="manipulator-value"
            kind={mani.kind}
            x={maniAnchor.x + maniAnchor.dirX * (MANI_ARROW_PX + 34)}
            y={maniAnchor.y + maniAnchor.dirY * (MANI_ARROW_PX + 34)}
            value={maniShownText}
            onChange={(next) => setManiDraft({ param: mani.param, text: next })}
            onCommit={commitManiText}
            onCancel={() => { setManiDraft(null); setManiNote(null); }}
          />
          {maniNote && <div className="mani-note" role="status">{maniNote}</div>}
        </div>
      )}
      <style>{`
        .handle-layer { position: absolute; inset: 0; pointer-events: none; }
        .sketch-lines { position: absolute; inset: 0; width: 100%; height: 100%; }
        .sketch-lines polygon {
          fill: rgba(139, 233, 253, 0.12);
          stroke: var(--reshape-accent); stroke-width: 1.5; stroke-dasharray: 5 3;
        }
        .handle {
          position: absolute;
          width: 13px; height: 13px; margin: -7px 0 0 -7px; padding: 0;
          border-radius: 50%;
          background: var(--reshape-success); border: 2px solid var(--reshape-bg);
          cursor: grab; pointer-events: auto;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
        }
        .handle:hover { background: var(--reshape-accent); }
        /* Position reads as a different job from size, so it gets a different
           shape and colour rather than another green dot to guess at. */
        .handle.is-move {
          background: var(--reshape-accent-2);
          border-radius: 2px;
          transform: rotate(45deg);
          width: 11px; height: 11px; margin: -6px 0 0 -6px;
        }
        .handle.is-move:hover { background: var(--reshape-pink); }
        .handle.is-move.is-on { background: var(--reshape-pink); transform: rotate(45deg) scale(1.25); }
        /* Turn is a ring, because that is the shape of what it does. */
        .handle.is-turn {
          background: transparent;
          border: 3px solid var(--reshape-yellow);
          width: 15px; height: 15px; margin: -8px 0 0 -8px;
        }
        .handle.is-turn:hover { border-color: var(--reshape-warn); background: transparent; }
        .handle.is-turn.is-on { border-color: var(--reshape-warn); background: transparent; transform: scale(1.25); }
        /* Round, not square, and orange: it sits ON the outline where a corner
           handle would look like a corner, and it drives a radius rather than a
           position. The title attribute above carries the live number, which is
           the only place in the app a student could read a fillet radius. */
        .handle.is-radius {
          background: transparent; border-color: var(--reshape-warn);
          width: 11px; height: 11px; margin: -6px 0 0 -6px;
        }
        .handle.is-radius:hover, .handle.is-radius.is-on { background: var(--reshape-warn); }
        .handle:focus-visible { outline: 2px solid var(--reshape-accent-2); outline-offset: 2px; }
        .handle.is-on { background: var(--reshape-accent); cursor: grabbing; transform: scale(1.25); }
        /* Phase 5.1's arrow: same non-scaling screen-pixel discipline as
           every other overlay mark; the value box sits in its own wrapper
           so the note below it never shifts the box. */
        .mani-arrow { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .mani-arrow line { stroke: var(--reshape-accent-2, #bd93f9); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
        .mani-arrow polygon { fill: var(--reshape-accent-2, #bd93f9); }
        .mani-value-wrap { position: absolute; inset: 0; pointer-events: none; }
        .mani-value-wrap input { pointer-events: auto; }
        .reshape-value-box { min-width: 2.5em; text-align: center; padding: 1px 4px; border-radius: 3px;
          border: 1px solid transparent; background: var(--reshape-bg, #282a36); color: var(--reshape-accent-2, #bd93f9);
          font-family: var(--reshape-font-mono, monospace); font-size: 12px; cursor: text; }
        .reshape-value-box:focus, .reshape-value-box[data-editing="true"] { outline: none;
          background: var(--reshape-surface, #1e1f29); border-color: var(--reshape-accent, #8be9fd); color: var(--reshape-text, #f8f8f2); }
        .mani-note { position: absolute; transform: translate(-50%, 0); white-space: nowrap;
          color: var(--reshape-warn, #ffb86c); font-size: 12px; }
      `}</style>
    </div>
  );
}
