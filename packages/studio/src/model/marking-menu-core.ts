// Pure logic for the right-click marking menu (SPEC-mouse-parity.md Phase
// 4.1: "Menu contents are data keyed by mode"). No DOM, no React -- exactly
// the split sketch-canvas-core.ts already draws for SketchCanvas2D's own pure
// logic: MarkingMenu.tsx renders what this module hands it, and only what
// this module hands it. Second-level flyouts (`children`, todo 18) and the
// hold/drag-to-a-wedge gesture (todo 19/20) are NOT built here; `children`
// exists on the type now only so landing them later is not a breaking type
// change, and `classifyRightClick` below is written so todo 19/20 can extend
// it instead of writing a second classifier.

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
  { id: 'sketch', label: 'Sketch' },
];

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
