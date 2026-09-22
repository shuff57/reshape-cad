// Pure logic for the right-click marking menu (SPEC-mouse-parity.md Phase
// 4.1: "Menu contents are data keyed by mode"). No DOM, no React -- exactly
// the split sketch-canvas-core.ts already draws for SketchCanvas2D's own pure
// logic: MarkingMenu.tsx renders what this module hands it, and only what
// this module hands it. The hold/drag-to-a-wedge gesture (todo 19/20) is
// not built here; `classifyRightClick` below is written so todo 19/20 can
// extend it instead of writing a second classifier. Todo 18 added the
// flyout (children on the Sketch wedges), the per-mode context list, and
// the flyout dead-zone hit-test.

export type MarkingMenuMode = 'part-viewport' | 'sketch';

export interface MarkingMenuWedge {
  id: string;
  label: string;
  /** Ribbon-style shortcut hint, e.g. 'Del'. Not rendered by this todo's
   *  MarkingMenu, carried on the type so a later flyout label can use it. */
  shortcut?: string;
  /** Static enabled state from the DATA itself -- absent means enabled.
   *  Selection-dependent enablement (the sketch constraint wedges) is NOT
   *  carried here; see validSketchConstraints() below, which the component
   *  consults instead. */
  enabled?: boolean;
  /** Second-level flyout (todo 18) -- not read by this todo's MarkingMenu. */
  children?: MarkingMenuWedge[];
}

export type MarkingMenuConfig = Record<MarkingMenuMode, MarkingMenuWedge[]>;

/** The part-viewport default eight, verbatim from SPEC-mouse-parity.md:33-35's
 *  observed-behaviour list, same reading order as the lesson. Only
 *  delete/undo/redo/sketch dispatch to anything real in this todo -- repeat,
 *  press-pull, move-copy and hole stay present-but-noop (see the TODO beside
 *  their dispatch in BrepViewportThree.tsx): wiring them would mean building
 *  a repeat-last-feature flow, a Press Pull command, a Move/Copy gizmo or a
 *  Hole feature dialog, none of which this base-component todo builds. */
const PART_VIEWPORT_WEDGES: MarkingMenuWedge[] = [
  { id: 'repeat', label: 'Repeat' },
  { id: 'delete', label: 'Delete' },
  { id: 'press-pull', label: 'Press Pull' },
  { id: 'undo', label: 'Undo' },
  { id: 'redo', label: 'Redo' },
  { id: 'move-copy', label: 'Move/Copy' },
  { id: 'hole', label: 'Hole' },
  { id: 'sketch', label: 'Sketch', children: SKETCH_TOOL_CHILDREN() },
];

/** The Sketch flyout's tools, as a function so it is defined after the
*  SKETCH_TOOLS list below (hoisting makes a const initializer cycle here).
*  Every tool SketchCanvas2D.tsx's own toolbar already arms -- the lesson's
*  sketch tool set (SPEC :33-36, "hover Sketch for a second radial").
*  ids/dispatch are MarkingMenu.tsx's caller's job (todo 17 wired the same
*  pattern for the first level). */
export function SKETCH_TOOL_CHILDREN(): MarkingMenuWedge[] {
  return [
    { id: 'tool-line', label: 'Line' },
    { id: 'tool-rect', label: 'Rect' },
    { id: 'tool-circle', label: 'Circle' },
    { id: 'tool-arc', label: 'Arc' },
    { id: 'tool-slot', label: 'Slot' },
    { id: 'tool-trim', label: 'Trim' },
    { id: 'tool-fillet', label: 'Fillet' },
    { id: 'tool-dim', label: 'Dim' },
  ];
}

/** Sketch-mode wedges: Done (exit) and Dim stay enabled regardless of
 *  selection, plus every constraint kind SketchCanvas2D's own toolbar
 *  buttons apply (SketchCanvas2D.tsx:2031-2125's applyRule() calls) -- these
 *  ten are exactly canHoriz/canVert/canCoin/canParallel/canEqual/canPerp/
 *  canTangent/canPointOnObject/canSymmetric/canLock's own rule kinds
 *  (SketchCanvas2D.tsx:1033-1048), read from the solver's own validity rules
 *  rather than a shortened guess at "the 8 constraints". Repeat/Undo/Redo are
 *  left OUT on purpose: SketchCanvas2D's own Props is just
 *  `{ sketch, doc, onChange, onExit }` -- there is no undo surface inside it
 *  to wire those three to, and this todo's own instruction is to leave a
 *  command out rather than invent new plumbing for it. */
const SKETCH_WEDGES: MarkingMenuWedge[] = [
  { id: 'done', label: 'Done' },
  { id: 'dim', label: 'Dim' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'coincident', label: 'Coincident' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'perpendicular', label: 'Perpendicular' },
  { id: 'equal', label: 'Equal' },
  { id: 'tangent', label: 'Tangent' },
  { id: 'pointOnObject', label: 'Point on Object' },
  { id: 'symmetric', label: 'Symmetric' },
  { id: 'lock', label: 'Lock' },
];

/** The lookup table item 17 asks for ("define a MarkingMenuConfig type and a
 *  lookup table, do not hardcode the eight commands inline in the
 *  component"). */
export const MARKING_MENU_CONFIG: MarkingMenuConfig = {
  'part-viewport': PART_VIEWPORT_WEDGES,
  sketch: SKETCH_WEDGES,
};

export function wedgesForMode(mode: MarkingMenuMode): MarkingMenuWedge[] {
  return MARKING_MENU_CONFIG[mode];
}

/** The ten constraint wedge ids -- exactly SKETCH_WEDGES minus 'done'/'dim',
 *  exported so validSketchConstraints() below and MarkingMenu.tsx agree on
 *  which ids are selection-gated without restating the list twice. */
export const SKETCH_CONSTRAINT_IDS = [
  'horizontal',
  'vertical',
  'coincident',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'pointOnObject',
  'symmetric',
  'lock',
] as const;

export type SketchGeomKind = 'point' | 'line' | 'arc' | 'circle';

export interface SketchSelectionEntry {
  kind: SketchGeomKind;
}

/** Which constraint wedge ids apply to the CURRENT selection's entity types
 *  -- reimplements the ten canX booleans SketchCanvas2D.tsx:1033-1048 already
 *  computes over its own `selShapes`/`selPoints` split (a 'point' entry is a
 *  named point pick; everything else is a "shape"), so a caller passing its
 *  selection's resolved geometry kinds gets the identical answer the
 *  toolbar buttons' own `disabled=` props already give:
 *  - horizontal/vertical: exactly 1 line
 *  - parallel/perpendicular/equal: exactly 2 lines
 *  - tangent: exactly 2 shapes, NOT both lines (line+curve or curve+curve --
 *    never two lines, which is what parallel/perpendicular/equal are for)
 *  - coincident: exactly 2 points
 *  - pointOnObject: exactly 1 point + 1 shape
 *  - symmetric: exactly 3 points
 *  - lock: exactly 1 point
 */
export function validSketchConstraints(selection: SketchSelectionEntry[]): string[] {
  const points = selection.filter((s) => s.kind === 'point').length;
  const shapes = selection.filter((s) => s.kind !== 'point');
  const bothLines = shapes.length > 0 && shapes.every((s) => s.kind === 'line');

  const canHoriz = shapes.length === 1 && shapes[0].kind === 'line';
  const canParallel = shapes.length === 2 && bothLines;
  const canTangent = shapes.length === 2 && !bothLines;

  const valid: Record<(typeof SKETCH_CONSTRAINT_IDS)[number], boolean> = {
    horizontal: canHoriz,
    vertical: canHoriz,
    coincident: points === 2,
    parallel: canParallel,
    perpendicular: canParallel,
    equal: canParallel,
    tangent: canTangent,
    pointOnObject: points === 1 && shapes.length === 1,
    symmetric: points === 3,
    lock: points === 1,
  };
  return SKETCH_CONSTRAINT_IDS.filter((id) => valid[id]);
}

/** One pointer sample: client-space px + event timestamp. */
export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

/** Distinguishes a right-CLICK (open the marking menu) from a right-DRAG
 *  (let OrbitControls/pan keep the movement, per SPEC-mouse-parity.md Phase
 *  4.3 -- "distinguish a click (menu) from a drag by movement threshold")
 *  by the same movement threshold the click-and-hold cycling gesture already
 *  uses (input-threshold.ts's HOLD_CYCLE_DEAD_ZONE_PX, passed in as
 *  `deadZonePx` so this module does not need to import that one for a single
 *  constant). `down === null` (no matching pointerdown seen) always ignores.
 *  Takes timestamps now even though this todo only reads the distance, so
 *  todo 19's hold/drag gesture state machine can extend this same function
 *  rather than writing a second one. */
export function classifyRightClick(
  down: PointerSample | null,
  up: PointerSample,
  deadZonePx: number,
): 'menu' | 'ignore' {
  if (down === null) return 'ignore';
  const dist = Math.hypot(up.x - down.x, up.y - down.y);
  return dist <= deadZonePx ? 'menu' : 'ignore';
}

// --- todo 18: flyout + context list -------------------------------------------------

/** The vertical context list SPEC :34-35 describes below the radial
*  ("a context list below holds Pan/Zoom/Orbit, Isolate, workspaces, saved
*  shortcuts"). Pure data, keyed by mode like the wedges. Entries whose
*  flows don't exist in reSHape yet are present-but-disabled (the same
*  convention todo 17 used for the part-viewport command wedges) -- the
*  component renders them greyed, never hidden. */
export function contextListFor(mode: MarkingMenuMode): MarkingMenuWedge[] {
  void mode; // the list is the same for both modes today; the parameter keeps
  // the per-mode-data shape so a later mode can diverge without a breaking
  // signature change.
  return [
    { id: 'ctx-pan-zoom-orbit', label: 'Pan/Zoom/Orbit', enabled: false },
    { id: 'ctx-isolate', label: 'Isolate', enabled: false },
    { id: 'ctx-workspaces', label: 'Workspaces', enabled: false },
    { id: 'ctx-saved-shortcuts', label: 'Saved shortcuts', enabled: false },
  ];
}

/** Which way the flyout-hold logic decides, for one cursor sample.
*  'stay' keeps the flyout open, 'close' collapses it. */
export type FlyoutVerdict = 'stay' | 'close';

export interface FlyoutSample {
  x: number;
  y: number;
}

/** The flyout's dead-zone hit-test (todo 18's acceptance criterion): while
*  the cursor is INSIDE the triangle whose corners are the parent wedge's
*  position, the flyout's nearest edge point, and the point between them
*  perpendicular to the wedge-to-flyout line, it stays open -- the standard
*  hover-menu "diagonal grace" that stops the flyout collapsing while the
*  user moves toward it. Directly-away paths (back toward the menu center)
*  fall outside the triangle and close. Pure: positions in, verdict out, no
*  time (the component owns any grace TIMER; the geometry here is what makes
*  the diagonal path safe).
*
*  `wedge` is the parent wedge's own position; `flyoutCenter` the flyout's
*  anchor. The triangle is (wedge, flyoutCenter, midpoint-of-wedge-flyout
*  offset perpendicular by the same distance as the wedge-to-flyout gap) --
*  wide enough that any monotonic move from the wedge toward the flyout
*  stays inside it, while a move BACK through the wedge toward the menu
*  center exits it immediately. */
export function flyoutHitTest(
  wedge: FlyoutSample,
  flyoutCenter: FlyoutSample,
  cursor: FlyoutSample,
): FlyoutVerdict {
  const midX = (wedge.x + flyoutCenter.x) / 2;
  const midY = (wedge.y + flyoutCenter.y) / 2;
  // Perpendicular offset of half the wedge-to-flyout distance.
  const dx = flyoutCenter.x - wedge.x;
  const dy = flyoutCenter.y - wedge.y;
  const len = Math.hypot(dx, dy) || 1;
  const apex = { x: midX - (dy / len) * (len / 2), y: midY + (dx / len) * (len / 2) };
  // Point-in-triangle over (wedge, flyoutCenter, apex), inclusive edges.
  const sign = (
    p1: FlyoutSample,
    p2: FlyoutSample,
    p3: FlyoutSample,
  ) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(cursor, wedge, flyoutCenter);
  const d2 = sign(cursor, flyoutCenter, apex);
  const d3 = sign(cursor, apex, wedge);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos) ? 'stay' : 'close';
}

// --- todo 19: hold + directional drag gesture (Phase 4.2) ---------------------------

/** The gesture's resolution, for todo 19's acceptance criteria: 'menu' means
 *  "the delay elapsed with the pointer still (nearly) stationary -- show the
 *  full menu"; a wedge direction means "the pointer left the dead zone in
 *  that direction BEFORE the delay elapsed -- fire that wedge's command
 *  directly, never rendering the menu" (SPEC :37-39: "hold right-button and
 *  drag toward a wedge without showing the menu"). */
export type GestureVerdict =
  | { kind: 'menu' }
  | { kind: 'wedge'; wedgeIndex: number }
  | { kind: 'ignore' };

export interface GestureThresholds {
  /** Milliseconds the pointer must stay within `deadZonePx` before the menu
   *  renders. [CONFIRM] default 150ms, pending real-Fusion verification
   *  (SPEC open question #2; the handover file only settled the HOLD-cycle
   *  numbers, not the marking-menu gesture's). */
  delayMs: number;
  /** CSS px of movement that still counts as stationary. Shared with the
   *  click-and-hold cycling gesture: the caller passes
   *  input-threshold.ts's HOLD_CYCLE_DEAD_ZONE_PX rather than a new number. */
  deadZonePx: number;
  /** How many wedges the menu has (8 for the radial first level). */
  wedgeCount: number;
}

/** The pure gesture classifier todo 19 needs: given the pointerdown sample,
 *  the pointerup sample, and the thresholds, decide whether this was a
 *  "show the menu" click/hold, a directional wedge gesture, or an
 *  irrelevant gesture (left button, or the first wedge slot straight UP --
 *  per SPEC :37-39 "Sketch is reached by dragging down first", the FIRST
 *  wedge in the lesson's gesture order is reached by dragging DOWN, so a
 *  straight-up drag from the center is not a wedge gesture; it falls back
 *  to 'menu'). A drag that leaves the dead zone BEFORE the delay is a
 *  wedge gesture WITHOUT ever rendering the menu; a release that is still
 *  within the dead zone after the delay is 'menu'.
 *
 *  Written as a function of ONE down sample and ONE up sample on purpose:
 *  todo 19's runtime only needs to remember the right-button pointerdown
 *  and pass every later sample's x/y/t -- the same state todo 17's
 *  onCanvasContextMenu already tracks (BrepViewportThree.tsx's
 *  `rightDownAt`). The wedge direction is the angle from the down point to
 *  the up point, indexed over `wedgeCount` slots starting at 12 o'clock
 *  going clockwise, matching MarkingMenu.tsx's own wedge layout
 *  (`-90 + 360/n * i` degrees, ccw from +X after the screen-flip). */
export function classifyGesture(
  down: PointerSample | null,
  up: PointerSample,
  thresholds: GestureThresholds,
): GestureVerdict {
  if (down === null) return { kind: 'ignore' };
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  const dist = Math.hypot(dx, dy);
  // Movement past the dead zone BEFORE the delay elapses: a directional
  // gesture. (up.t - down.t < delayMs AND dist > deadZonePx both hold.)
  if (dist > thresholds.deadZonePx && up.t - down.t < thresholds.delayMs) {
    // The wedge index: MarkingMenu.tsx lays wedge i at angle
    // (-90 + 360/n * i) degrees in SVG space (y down). The gesture angle in
    // screen space is atan2(dy, dx); slot 0 points up (-90deg), increasing
    // clockwise, so the index is round(angle / (360/n)) mod n.
    const step = 360 / thresholds.wedgeCount;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const index = ((Math.round((angleDeg + 90) / step) % thresholds.wedgeCount) + thresholds.wedgeCount) % thresholds.wedgeCount;
    return { kind: 'wedge', wedgeIndex: index };
  }
  // Still (nearly) stationary through the delay: show the menu. This is
  // also the release-without-movement path (dist <= deadZonePx).
  return { kind: 'menu' };
}
