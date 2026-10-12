'use client';

// SketchCanvas2D (SPEC-sketcher2 §7): the FreeCAD-style 2D sketcher over the
// kernel's warm sketch session. An SVG canvas -- every committed row drawn in
// soup coordinates, Y-up, with the flip to SVG's Y-down applied at write time
// (svgY = -y) exactly as the archived engine/play/sketch.js did.
//
// The component holds NO geometry state of its own beyond tool state: the rows
// live on the SketchFeature (geoms/rules), the solved coordinates live in the
// SketchSession2D parameter vector, and every edit is one onChange(doc) so the
// studio's undo records exactly one entry per gesture. Decision logic lives in
// sketch-canvas-core.ts (pure, test-proven); this file only calls it.
//
// VIEW STATE (SPEC-mouse-parity Phase 2 item 1, 2026-09-20). The fixed
// +/-100mm viewBox is gone: the canvas navigates a {cx, cy, pxPerMm}
// SketchView from sketch-view.ts -- wheel zooms to the cursor, the active
// mouse scheme's own PAN button drags, Fit / Shift+F frames the content --
// and the viewBox is DERIVED from that state plus the measured element
// size. Two consequences shape the rest of the file: SNAP_PX / HIT_PX are
// screen pixels, so every tolerance goes through screenPxToWorld(view) at
// the point of use, and anything drawn at a fixed SCREEN size (vertex dots,
// stroke widths, the grid step) is scaled by the current pxPerMm instead of
// being a world-unit literal.
//
// HOVER SNAP GLYPHS (SPEC-mouse-parity Phase 2 item 3, 2026-09-20). The snap
// under the cursor is drawn as a marker for its KIND -- square endpoint,
// triangle midpoint, crosshair centre, X intersection, diamond on-curve, dot
// grid -- so a midpoint reads differently from an intersection before the
// click lands. It rides the pointermove hover path that was already here; no
// frame loop was added for it.
//
// MARQUEE SELECT (SPEC-mouse-parity Phase 2 item 5, 2026-09-20). A select-tool
// press that lands on EMPTY space drags a band instead of an entity: dragged
// left-to-right it windows (fully inside only), right-to-left it crosses
// (touched counts), both decided by marquee-select.ts, the same pure module
// the 3D box select will use. The gesture is selection and nothing else --
// it calls setSel and never writeDoc, so it adds no undo entry at all.
//
// TOOL KEYS AND CURSORS (SPEC-mouse-parity Phase 2 item 6, 2026-09-20). One
// letter arms one tool (L R C A S T V, Fusion's own), D opens a dimension,
// and every one of them is deaf while a text field has focus. The armed tool
// also sets the canvas cursor, so which tool is live is readable without
// looking up at the ribbon. The Esc cascade above them is untouched.
//
// ON-CANVAS DIMENSIONS (SPEC-mouse-parity Phase 2 item 7, 2026-09-20). The
// Dim tool picks an entity, auto-detects what it asks for (a line wants the
// distance between its ends, a circle or an arc its radius, two picked points
// the distance between them -- autoDimension decides, not this file), trails a
// ghost label off the cursor, and drops the label where the second click
// lands. Every dimension the sketch carries is then a real <input> chip in an
// HTML overlay OVER the svg, not inside it: that is what makes Tab cycle
// between them for free (native focus order) and what keeps a pointerdown on
// a value box from reaching the canvas and cancelling the placement it is
// part of. A chip looks like a label at rest and like a box once focused.
// The ribbon's own Dim / R / diameter buttons are untouched -- they still open
// the ribbon-docked box on the current selection.
//
// CONSTRAINT GLYPHS (SPEC-mouse-parity Phase 2 item 8, 2026-09-20). Every row
// in `rules` is drawn where it applies: the six kinds carrying a `value` as
// the value chip above (the number IS the glyph), the other ten as an icon at
// a constant screen size. Hover highlights on the same pointermove path the
// snap glyphs ride, a click selects, Del removes -- one onChange, so one undo
// entry. A glyph swallows its own pointerdown and click, which is why
// clicking one never draws geometry underneath it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelDoc, SketchFeature, SoupGeom, SoupRule } from '@shuff57/reshape-script/model-types';
import {
  angleInArcRange,
  arcEnds,
  arcFromClicks,
  autoDimension,
  referenceRowOf,
  dimensionValueError,
  distToCircleStroke,
  distToSegment,
  findSnap as findSnapCore,
  inferLineConstraint,
  isDimensionRule,
  migratedRules,
  namedPointsOf,
  nextGeomId,
  filletPick,
  maxFilletRadiusAt,
  whyCannotFilletAt,
  filletCornerAt,
  applyEqualRadiusRule,
  offsetChainOrder,
  offsetChainPick,
  offsetChain,
  pointWorld,
  readSolved,
  solveRows,
  renumber,
  ruleGlyphAnchors,
  sampleArc,
  snapAxis,
  slotRows,
  arcAngles,
  toggleConstruction,
  trimLine,
  trimPick,
  splitWeldedCircles,
  mirrorSelection,
  copySelection,
  densifyIds,
  solverMessage,
  ruleName,
  geomName,
  fullyConstrainedIds,
  dimensionArt,
  type AutoDimension,
  type CoreGeom,
  type DimKind,
  type DimPick,
  lineSmartDimension,
  placeDimension,
  type LineChain,
  type FilletPick,
  type OffsetPick,
  type Pt,
  type SnapHit,
  type SoupGeomNew,
} from './sketch-canvas-core.js';
import { pointSlots } from '@shuff57/reshape-brep-adapter/sketch-session';
import {
  applyWheelZoom,
  fitView,
  panByPx,
  screenPxToWorld,
  worldToScreen,
  type BBox2Like,
  type SizePx,
  type SketchView,
} from '../sketch-view.js';
import { marqueeKind, marqueeSelect } from '../marquee-select.js';
import { loadSchemeName, schemeToMouseButtons } from '../camera-controls.js';
import { HOLD_CYCLE_DEAD_ZONE_PX } from '../input-threshold.js';
import MarkingMenu from './MarkingMenu.js';
import {
  classifyRightClick,
  classifyGesture,
  wedgesForMode,
  type GestureThresholds,
  type PointerSample,
  type SketchGeomKind,
  type SketchSelectionEntry,
} from './marking-menu-core.js';
import { rightButtonRole, rightClickGuard } from './marking-menu-guard.js';

// Todo 19's [CONFIRM]-sourced gesture thresholds, same shape as
// BrepViewportThree's: the delay is the marking-menu gesture's own default
// (150ms, pending real-Fusion verification per SPEC open question #2); the
// dead zone is the SHARED click-and-hold constant, not a second number.
const MARKING_GESTURE: GestureThresholds = { delayMs: 150, deadZonePx: HOLD_CYCLE_DEAD_ZONE_PX, wedgeCount: 8 };

const SNAP_PX = 8;
const HIT_PX = 6;
const AXIS_TOL_DEG = 4;
/** Half-size (mm) of the frame an EMPTY sketch opens on -- what is left of
 *  the fixed +/-100 viewBox this replaced, now only a fit target. */
const DEFAULT_HALF_MM = 60;
/** Margin Fit keeps on every side, screen px. */
const FIT_PAD_PX = 24;
/** Wheel: one 100px notch multiplies the scale by e^0.15 ~= 1.16. deltaMode
 *  1 (lines) and 2 (pages) are normalised to pixels first. */
const WHEEL_ZOOM_RATE = 0.0015;
const WHEEL_LINE_PX = 16;
/** Screen sizes of the marks that used to be world-unit literals back when
 *  the scale was fixed; multiplied by mm-per-px at render time. */
const VERTEX_R_PX = 3.2;
const ORIGIN_R_PX = 3;
/** Full width of a hover snap glyph (SPEC-mouse-parity Phase 2 item 3):
 *  one marker per snap KIND, drawn at a constant screen size. */
const SNAP_GLYPH_PX = 9;
const AXIS_HINT_PX = 11;
/** Full width of a CONSTRAINT glyph (SPEC-mouse-parity Phase 2 item 8), the
 *  screen-pixel radius within which a pointermove counts as hovering one, and
 *  how far apart two rules landing on the same anchor are fanned. All screen
 *  pixels, all multiplied by mm-per-px at render time, same as above. */
const RULE_GLYPH_PX = 11;
const RULE_HIT_PX = 9;
const RULE_GLYPH_STEP_PX = 15;
/** How far up-and-right of its anchor a glyph is DRAWN, screen px. See the
 *  glyph loop for why a mark sitting exactly on its own geometry is not a
 *  mark at all. */
const GLYPH_NUDGE_PX = 9;
/** Default distance of a dimension line from what it measures. */
const DIM_OFFSET_PX = 42;
/** Grid: the smallest 1-2-5 step whose spacing is at least this many screen
 *  pixels, and a ceiling on how many lines one frame may draw. */
const GRID_MIN_PX = 9;
const GRID_MAX_LINES = 400;
/** Pointer travel under which a press is a CLICK, so the click-click tool
 *  flow -- not the drag-to-create gesture -- owns it. Screen px. */
const DRAG_PX = 3;

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'slot' | 'trim' | 'fillet' | 'offset' | 'dim';
/** The tools a single drag can finish on its own (SPEC-mouse-parity Phase 2
 *  item 2). Line and arc are not among them: a chain and a three-point arc
 *  need more points than one drag carries. */
type CreateTool = 'rect' | 'circle' | 'slot';
const isCreateTool = (t: Tool): t is CreateTool => t === 'rect' || t === 'circle' || t === 'slot';
type Sel = { id: number; at: 'a' | 'b' | 'c' | null };
/** Fusion's sketch keys (SPEC-mouse-parity Phase 2 item 6). D is absent on
 *  purpose: it opens a dimension rather than arming a tool, so it is handled
 *  beside these rather than in the table. */
const TOOL_KEYS: Record<string, Tool> = {
  l: 'line',
  r: 'rect',
  c: 'circle',
  a: 'arc',
  s: 'slot',
  t: 'trim',
  f: 'fillet',
  o: 'offset',
  v: 'select',
};
/** The cursor each tool wears. A draw tool aims at a POINT, so it keeps the
 *  crosshair this canvas used to wear for every tool including select; select
 *  is the arrow the rest of the UI uses; trim takes `cell`, the nearest thing
 *  CSS has to Fusion's scissors; fillet aims at a corner POINT the same way a
 *  draw tool aims at one, so it keeps the crosshair rather than trim's
 *  scissors; dim aims at an entity, so it aims. */
const TOOL_CURSOR: Record<Tool, string> = {
  select: 'default',
  line: 'crosshair',
  rect: 'crosshair',
  circle: 'crosshair',
  arc: 'crosshair',
  slot: 'crosshair',
  trim: 'cell',
  fillet: 'crosshair',
  // offset aims at an edge (or uses whatever is already selected) the same
  // way trim does.
  offset: 'cell',
  dim: 'crosshair',
};

/** A dimension value as a box shows it: full precision would put 39.99999999
 *  in front of a user who asked for 40. */
function formatDim(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}

/** The unit a dimension label carries beside its number. */
function dimUnit(kind: string): string {
  return kind === 'angle' ? '\u00b0' : ' mm';
}

interface Props {
  sketch: SketchFeature;
  doc: ModelDoc;
  onChange: (next: ModelDoc) => void;
  onExit?: () => void;
}

export default function SketchCanvas2D({ sketch, doc, onChange, onExit }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>('line');
  const [chain, setChain] = useState<LineChain | null>(null);
  const [clicks, setClicks] = useState<Pt[]>([]);
  const [sel, setSel] = useState<Sel[]>([]);
  // Right-click marking menu (SPEC-mouse-parity.md Phase 4.1): container-
  // relative px, or null when closed. rightDownRef holds the ORIGINAL
  // pointerdown position for the right button -- not panRef, which the pan
  // gesture below mutates on every move, so it can't answer "did this press
  // move past the dead zone" by the time the contextmenu event fires.
  const [markingMenu, setMarkingMenu] = useState<{ x: number; y: number } | null>(null);
  const rightDownRef = useRef<PointerSample | null>(null);
  // The pointer's last KNOWN sample: what classifyGesture/rightClickGuard
  // read as the gesture's up-sample (see onPointerMove's comment).
  const rightMoveRef = useRef<PointerSample | null>(null);
  // Whether the JUST-ENDED right press classified as a menu click (set by
  // onPointerUp's classifier, consumed by the onContextMenu prop — which the
  // browser fires for the same press). Cleared by every non-armed
  // contextmenu so a stray native-menu event never opens the menu.
  const rightMenuArmedRef = useRef(false);
  const [auto, setAuto] = useState(true);
  const [pointer, setPointer] = useState<Pt | null>(null);
  // The snap under the cursor, WHATEVER kind: the glyph beside it is how a
  // user tells a midpoint from an intersection before committing to a click
  // (SPEC-mouse-parity Phase 2 item 3).
  const [hoverSnap, setHoverSnap] = useState<SnapHit | null>(null);
  const [dim, setDim] = useState<{
    kind: 'distance' | 'radius' | 'diameter' | 'distanceX' | 'distanceY' | 'angle';
    a: Sel | null;
    b: Sel | null;
    value: string;
  } | null>(null);
  const [status, setStatus] = useState<string>('');
  // The on-canvas dimension in flight (P2.7). `pending` holds a lone point
  // pick waiting for its partner; `dim` is what autoDimension decided; `at`
  // is null while the ghost label still trails the cursor and holds the
  // placed world position once the second click lands.
  const [place, setPlace] = useState<{
    pending: DimPick | null;
    dim: AutoDimension | null;
    at: Pt | null;
    value: string;
  } | null>(null);
  // The fillet corner picked and not yet committed (click-then-type, unlike
  // dim's click-click-type: a corner is one point, so one click is the whole
  // pick). `value` is the typed radius, pre-filled with half the corner's
  // own ceiling. `maxR` rides along so the input's own placeholder/refusal
  // text never has to re-derive it from stale geoms after a commit.
  const [filletPend, setFilletPend] = useState<(FilletPick & { value: string; maxR: number }) | null>(null);
  // The last arc THIS tool session filleted, and the radius it was filleted
  // at -- auto-equal-radius (P13's own addition): while the fillet tool
  // stays armed and the student does not retype the radius, the next
  // corner they round ties its arc's radius to this one with one `equal`
  // rule, in the SAME writeDoc as the new fillet (one undo entry). Reset on
  // every tool change so leaving and rearming fillet starts a fresh chain.
  const lastFilletArc = useRef<{ arcId: number; radius: number } | null>(null);
  // The offset chain picked and not yet committed, same click-then-type
  // shape as filletPend: the click (or the prior selection it reused) is
  // the whole pick, `value` is the typed distance.
  const [offsetPend, setOffsetPend] = useState<(OffsetPick & { value: string }) | null>(null);
  /** Where each placed dimension's label was dropped, by RULE INDEX. This is
   *  UI state on purpose: SoupRule has no label-position field and inventing
   *  one would change the script schema every doc round-trips through. A
   *  dimension with no entry here rests at its geometry's own anchor. */
  const [labelAt, setLabelAt] = useState<Record<number, Pt>>({});
  /** What is typed in a value chip but not yet committed, by rule index. A
   *  chip with no draft shows the rule's committed value, so a blur without
   *  Enter reverts rather than half-writing. */
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [editingRule, setEditingRule] = useState<number | null>(null);
  // The constraint glyph under the cursor and the one that is picked (P2.8).
  // Both are rule INDICES -- the identity a rule has in the doc's own list.
  const [hoverRule, setHoverRule] = useState<number | null>(null);
  const [selRule, setSelRule] = useState<number | null>(null);
  // Show Constraints (the constrain-and-align lesson 02:04-02:09: the
  // palette checkbox hides every glyph to declutter; clicking an entity
  // with glyphs hidden shows ONLY its constraints). Default on = glyphs
  // always shown, today's behaviour.
  const [showConstraints, setShowConstraints] = useState(true);
  // Task panel list state: which constraint / element rows are hidden from the
  // canvas (the per-row checkbox), the constraints filter, and a counter the
  // Refresh button bumps to force a fresh solve of the same rows.
  const [hiddenRules, setHiddenRules] = useState<Set<number>>(() => new Set());
  const [hiddenGeoms, setHiddenGeoms] = useState<Set<number>>(() => new Set());
  const [ruleFilter, setRuleFilter] = useState<'all' | 'dimensional' | 'geometric' | 'problems'>('all');
  const [solveTick, setSolveTick] = useState(0);
  // The solver settings menu (FreeCAD's gear beside the solver message).
  // Auto update off = edits are written but the sketch is only solved again
  // on Refresh; auto remove redundants drops the newest constraint the
  // solver names redundant; show coincident draws the weld marks at corners.
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [autoRemoveRedundant, setAutoRemoveRedundant] = useState(false);
  const [showCoincident, setShowCoincident] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Reference (driven) dimensions: measured, drawn, never solved. View state
  // like labelAt -- a reference is a readout, so it has no row in the doc.
  const [refMode, setRefMode] = useState(false);
  const [refDims, setRefDims] = useState<Array<Record<string, any>>>([]);
  // Escape closes the solver menu even while one of its checkboxes holds focus
  // (the sketch's own key handler stands down inside form fields).
  useEffect(() => {
    if (!settingsOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setSettingsOpen(false);
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [settingsOpen]);
  const [stale, setStale] = useState(false);
  const [autoNote, setAutoNote] = useState<{ text: string; len: number } | null>(null);
  const autoRemoveRef = useRef(false);
  autoRemoveRef.current = autoRemoveRedundant;
  const tickSeenRef = useRef(0);

  // The rows as the doc carries them (soup or migrated from the legacy
  // polygon -- a legacy sketch's points arrive as soup rows the first time
  // this canvas opens it).
  const geoms: SoupGeom[] = useMemo(() => {
    const own = sketch.geoms ?? sketch.geom;
    if (own) return own;
    if (!sketch.points?.length) return [];
    if (sketch.shape === 'circle' && sketch.points.length === 2) {
      const [a, b] = sketch.points;
      return [{ k: 'circle', id: 1, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 }];
    }
    return sketch.points.map((p, i) => ({
      k: 'line' as const,
      id: i + 1,
      a: p,
      b: sketch.points[(i + 1) % sketch.points.length],
    }));
  }, [sketch]);
  // Legacy bulges/rounds migrate to plain straight edges in v1: outlineOf()
  // would need the fillet basis machinery to place true arcs, and a legacy
  // rounded polygon is rare; the straight-edge soup still round-trips.
  const rules: SoupRule[] = useMemo(() => sketch.rules ?? [], [sketch]);

  // --- the session (wasm, warm) ------------------------------------------------
  const sessionRef = useRef<any>(null);
  const [solved, setSolved] = useState<CoreGeom[]>([]);
  const [diagnosis, setDiagnosis] = useState<{ dof: number; bucket: string; blame: number[] } | null>(null);
  /** Geometry rows nothing can still move (measured by the freedom probe). */
  const [fullIds, setFullIds] = useState<Set<number>>(() => new Set());
  const probeRef = useRef<any>(null);
  const [taskHost, setTaskHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = typeof document !== 'undefined' ? document.getElementById('reshapeSketchTask') : null;
    if (el !== taskHost) setTaskHost(el);
  });
  // The document as the sketcher found it: Cancel puts exactly this back.
  const openedDocRef = useRef(doc);
  const docRef = useRef(doc);
  docRef.current = doc;
  const cancelSketch = useCallback(() => {
    if (docRef.current !== openedDocRef.current) onChange(openedDocRef.current);
    onExit?.();
  }, [onChange, onExit]);
  const rafRef = useRef<number | null>(null);
  // A LIST of point pulls, not one: a point drag queues a single pair of
  // slots, a whole-entity drag queues one per named point of the row and the
  // solve applies them in order, each warm-starting from the last.
  const pendingDrag = useRef<Array<{ sa: number; sb: number; tx: number; ty: number }> | null>(null);

  const scratchRef = useRef<any>(null);
  const scratchReady = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { SketchSession2D } = await import('@shuff57/reshape-brep-adapter/sketch-session');
      const s = new SketchSession2D();
      await s.load();
      if (cancelled) return;
      scratchRef.current = s;
      scratchReady.current = true;
    })().catch(() => {
      // no wasm: edits are stored as drawn, exactly as before
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const writeDoc = useCallback(
    (rawGeoms: SoupGeom[], rawRules: SoupRule[]) => {
      // Circle-in-mixed-wire canonicalization (kernel §5.3.10's own advice,
      // applied mechanically): a circle welded to lines by 2 tangencies
      // becomes an arc pair split at the contact points, so wire discovery
      // walks it like any other curve. Sketches without such a circle pass
      // through untouched.
      const split = splitWeldedCircles(rawGeoms as CoreGeom[], rawRules as unknown as Array<Record<string, any>>);
      const nextRules = split.rules as unknown as SoupRule[];
      // Store the SOLVED rows (model-types.ts's contract for `geoms`): a typed
      // dimension must move the stored coordinates, not only the built solid.
      // A scratch session, so the live one (mid-drag warm start) is not
      // reopened; if its wasm has not loaded yet the rows go in as drawn.
      const scratch = scratchRef.current;
      const nextGeoms = (scratch && scratchReady.current
        ? solveRows(scratch, split.geoms as CoreGeom[], nextRules as unknown[])
        : split.geoms) as SoupGeom[];
      onChange({
        ...doc,
        features: doc.features.map((f) =>
          f.id === sketch.id ? ({ ...f, geoms: nextGeoms, geom: nextGeoms, rules: nextRules } as SketchFeature) : f,
        ),
      });
    },
    [onChange, doc, sketch.id],
  );

  // Write the migrated soup ONCE: without this, the doc keeps carrying only
  // `points` and every canvas edit would re-migrate (and any rows the canvas
  // had already added would collide with the polygon). One onChange = one
  // undo entry for the migration itself.
  const wroteMigration = useRef(false);
  useEffect(() => {
    if (wroteMigration.current) return;
    if (sketch.geoms || sketch.geom || !geoms.length) {
      wroteMigration.current = true;
      return;
    }
    wroteMigration.current = true;
    writeDoc(geoms, migratedRules(sketch.constraints, geoms));
  }, [geoms, sketch.geoms, sketch.geom, sketch.constraints, writeDoc]);



  const rowsSeenRef = useRef<{ g: unknown; r: unknown }>({ g: geoms, r: rules });
  // Open + solve whenever the rows change; the session is a function of them.
  useEffect(() => {
    // Manual update: a changed row set waits for Refresh (a bumped tick).
    const forced = solveTick !== tickSeenRef.current;
    tickSeenRef.current = solveTick;
    const changed = rowsSeenRef.current.g !== geoms || rowsSeenRef.current.r !== rules;
    rowsSeenRef.current = { g: geoms, r: rules };
    if (!autoUpdate && !forced) {
      if (changed) {
        setStale(true);
        setSolved(geoms as unknown as typeof solved);
      }
      return;
    }
    setStale(false);
    let cancelled = false;
    (async () => {
      // One session, one load: StrictMode double-invokes effects, and the
      // second invoke must WAIT for the first one's load() instead of
      // calling open() on an un-initialised module (the race the dogfood run
      // caught). load() resolves immediately once this.wasm is set.
      if (!sessionRef.current) {
        const { SketchSession2D } = await import('@shuff57/reshape-brep-adapter/sketch-session');
        const s = new SketchSession2D();
        sessionRef.current = s;
        await s.load();
      } else {
        await sessionRef.current.load();
      }
      const s = sessionRef.current as any;
      if (cancelled) return;
      const err = s.open(geoms, rules);
      if (err) {
        setStatus(err);
        setDiagnosis(null);
        return;
      }
      if (!s.solve()) {
        setStatus(s.lastError() ?? 'the sketch did not solve');
      } else {
        setStatus('');
      }
      const diag = s.diagnose();
      if (autoRemoveRef.current && diag && diag.bucket === 'redundant' && diag.blame.length > 0) {
        // The newest named row is the one just added; the next solve
        // re-checks, so a chain of redundancies unwinds one row at a time.
        const drop = Math.max(...diag.blame);
        if (drop >= 0 && drop < rules.length) {
          setAutoNote({ text: `Removed redundant constraint ${drop + 1} (${ruleName(String((rules[drop] as any).k))})`, len: rules.length - 1 });
          writeDoc(geoms, rules.filter((_, j) => j !== drop));
          return;
        }
      }
      const solvedNow = readSolved(geoms as CoreGeom[], s.params);
      setDiagnosis(diag);
      setSolved(solvedNow);
      // Which rows are fully constrained: a second, throwaway session so the
      // live one (warm start for drags) is left exactly as the solve left it.
      try {
        if (!probeRef.current) {
          const { SketchSession2D } = await import('@shuff57/reshape-brep-adapter/sketch-session');
          const p = new SketchSession2D();
          probeRef.current = p;
          await p.load();
        } else {
          await probeRef.current.load();
        }
        if (cancelled) return;
        setFullIds(fullyConstrainedIds(probeRef.current, solvedNow, rules as unknown[], diag));
      } catch {
        setFullIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [geoms, rules, solveTick, autoUpdate]);

  // Hidden-row sets are index based: a changed constraint count invalidates them.
  useEffect(() => {
    setHiddenRules((h) => (h.size ? new Set() : h));
  }, [rules.length]);

  // --- view state + coordinate mapping -----------------------------------------
  // The viewBox is DERIVED from {cx, cy, pxPerMm} and the measured element
  // size: a viewBox whose aspect ratio already matches the element makes
  // "meet" a no-op, so one screen pixel is exactly 1/pxPerMm mm on both axes
  // and the SVG's own CTM agrees with sketch-view's worldToScreen.
  const [view, setView] = useState<SketchView>({ cx: 0, cy: 0, pxPerMm: 4 });
  const [size, setSize] = useState<SizePx>({ width: 0, height: 0 });
  /** mm per screen pixel: the multiplier for everything drawn at a fixed
   *  SCREEN size (dots, the grid step, the axis hint) in world coordinates. */
  const mmPerPx = 1 / view.pxPerMm;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewBox = useMemo(() => {
    if (!(size.width > 0) || !(size.height > 0)) {
      return `${-DEFAULT_HALF_MM} ${-DEFAULT_HALF_MM} ${DEFAULT_HALF_MM * 2} ${DEFAULT_HALF_MM * 2}`;
    }
    const w = size.width / view.pxPerMm;
    const h = size.height / view.pxPerMm;
    // svgY = -y (the file-wide flip), so the top edge is the centre's
    // NEGATED y minus half the height.
    return `${view.cx - w / 2} ${-view.cy - h / 2} ${w} ${h}`;
  }, [size, view]);

  const worldFromEvent = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    // DOMPoint is fine in every browser this app ships to; the polyfill note
    // in HandleOverlay covers the one Safari revision that needed it.
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };
  }, []);

  const screenFromWorld = useCallback((p: Pt): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const q = new DOMPoint(p.x, -p.y).matrixTransform(ctm);
    return { x: q.x, y: q.y };
  }, []);

  /** The world bbox of everything solved, for Fit. An empty or degenerate
   *  sketch (no rows, a single point, a zero-radius circle) fits the default
   *  frame instead: fitView's own fallback for a zero-extent bbox is
   *  MIN_PX_PER_MM, which would park the sketch a million-fold away. */
  const contentBBox = useMemo<BBox2Like>(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const g of solved) {
      if (g.k === 'line') {
        add(g.a[0], g.a[1]);
        add(g.b[0], g.b[1]);
      } else if (g.k === 'circle' || g.k === 'arc') {
        add(g.c[0] - g.r, g.c[1] - g.r);
        add(g.c[0] + g.r, g.c[1] + g.r);
      } else if (g.k === 'point') {
        add(g.p[0], g.p[1]);
      }
    }
    if (!(maxX - minX > 1e-9) && !(maxY - minY > 1e-9)) {
      const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
      const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
      return { min: [cx - DEFAULT_HALF_MM, cy - DEFAULT_HALF_MM], max: [cx + DEFAULT_HALF_MM, cy + DEFAULT_HALF_MM] };
    }
    return { min: [minX, minY], max: [maxX, maxY] };
  }, [solved]);

  const fit = useCallback(() => {
    const r = svgRef.current?.getBoundingClientRect();
    const s = r && r.width > 0 ? { width: r.width, height: r.height } : size;
    if (!(s.width > 0) || !(s.height > 0)) return;
    setView(fitView(contentBBox, s, FIT_PAD_PX));
  }, [contentBBox, size]);

  // The opening frame, ONCE. An existing sketch's rows reach the doc before
  // the solver has run on them, so the fit waits for the first solved rows
  // rather than framing the default box and never coming back; after that
  // an edit never re-frames (nothing is worse than the canvas moving under
  // a click mid-chain).
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || !(size.width > 0) || !(size.height > 0)) return;
    if (geoms.length > 0 && solved.length === 0) return;
    didFit.current = true;
    setView(fitView(contentBBox, size, FIT_PAD_PX));
  }, [contentBBox, geoms.length, size, solved.length]);

  // Wheel zoom is a NATIVE listener: React registers onWheel passively, so a
  // preventDefault() there is ignored and the page scrolls under the canvas.
  // One event, one setView -- no rAF loop.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      const px = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaMode === 2 ? e.deltaY * r.height : e.deltaY;
      const factor = Math.exp(-px * WHEEL_ZOOM_RATE);
      const cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      setView((v) => applyWheelZoom(v, cursor, { width: r.width, height: r.height }, factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Which button pans: the ACTIVE scheme's own PAN binding (Phase 1's table),
  // so a user who picked Fusion for the 3D viewport pans with the same finger
  // here. Only PAN is read -- the table's ORBIT and DOLLY rows have no 2D
  // meaning (nothing to orbit; the wheel owns zoom) -- and it transfers
  // as-is because three.js MOUSE.LEFT/MIDDLE/RIGHT are 0/1/2, the numbering
  // PointerEvent.button already uses. The middle button pans under EVERY
  // scheme as well: it is unbound in 2D otherwise, and MMB-pan is the habit
  // every CAD user arrives with.
  const panButton = useMemo(() => schemeToMouseButtons(loadSchemeName()).PAN, []);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // --- tool plumbing -----------------------------------------------------------
  // Vertex snap through the ONE snap engine (sketch-canvas-core's findSnap):
  // SNAP_PX is screen pixels, converted to a world tolerance for the current
  // zoom, so the ring catches at the same distance from the cursor whatever
  // pxPerMm is.
  const findSnap = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const w = worldFromEvent(e);
      const hit = findSnapCore(solved as CoreGeom[], w, screenPxToWorld(SNAP_PX, view), { kinds: ['vertex'] });
      if (!hit || hit.id === undefined || !hit.at) return null;
      return { id: hit.id, at: hit.at, world: hit.world };
    },
    [solved, view, worldFromEvent],
  );

  /** The hover snap: EVERY kind the engine knows, over the same screen-pixel
   *  tolerance the tools use. Grid is not asked for -- no gridStep is passed --
   *  because a grid hit would quantize a click the tools do not quantize; the
   *  glyph renderer still draws one if a caller ever turns it on. The O(n^2)
   *  intersection pass runs once per pointermove, not per frame: there is no
   *  rAF loop behind this. */
  const findHoverSnap = useCallback(
    (e: { clientX: number; clientY: number }) =>
      findSnapCore(solved as CoreGeom[], worldFromEvent(e), screenPxToWorld(SNAP_PX, view)),
    [solved, view, worldFromEvent],
  );

  const findHit = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const w = worldFromEvent(e);
      let best: Sel | null = null;
      let bestDist = screenPxToWorld(HIT_PX, view);
      for (const g of solved) {
        if (g.k === 'line') {
          const d = distToSegment(w, { x: g.a[0], y: g.a[1] }, { x: g.b[0], y: g.b[1] });
          if (d < bestDist) {
            bestDist = d;
            best = { id: g.id, at: null };
          }
        } else if (g.k === 'circle') {
          const d = distToCircleStroke(w, { x: g.c[0], y: g.c[1] }, g.r);
          if (d < bestDist) {
            bestDist = d;
            best = { id: g.id, at: null };
          }
        } else if (g.k === 'arc') {
          const d = distToCircleStroke(w, { x: g.c[0], y: g.c[1] }, g.r);
          if (d < bestDist) {
            const ang = arcAngles(g);
            const theta = Math.atan2(w.y - g.c[1], w.x - g.c[0]);
            if (ang && angleInArcRange(theta, ang.a0, ang.a0 + ang.sweep)) {
              bestDist = d;
              best = { id: g.id, at: null };
            }
          }
        }
      }
      return best;
    },
    [solved, view, worldFromEvent],
  );

  // --- doc row writers -----------------------------------------------------------
  const pushGeom = useCallback(
    (g: SoupGeomNew) => {
      const id = nextGeomId(geoms as CoreGeom[]);
      const row = { ...g, id } as SoupGeom;
      writeDoc([...geoms, row], rules);
    },
    [geoms, rules, writeDoc],
  );

  const pushRule = useCallback(
    (r: SoupRule) => {
      writeDoc(geoms, [...rules, r]);
    },
    [geoms, rules, writeDoc],
  );

  // --- tool click handlers ---------------------------------------------------------
  const onLineClick = useCallback(
    (e: React.MouseEvent) => {
      const snap = findSnap(e);
      const world = worldFromEvent(e);
      const pt: Pt = snap ? snap.world : world;
      if (!chain) {
        setChain({
          startId: null,
          startAt: null,
          prevX: pt.x,
          prevY: pt.y,
          prevId: null,
          prevAt: null,
          pinOrigin: auto && !snap && Math.hypot(pt.x, pt.y) < 1.5,
        });
        return;
      }
      // Extend the chain: a line from the previous point to this one.
      const from = { x: chain!.prevX, y: chain!.prevY };
      const id = nextGeomId(geoms as CoreGeom[]);
      let end = pt;
      // Auto-constraints, gated by the toggle and guarded by the DoF check
      // the diagnosis gives us after the write.
      const axisKind = auto ? inferLineConstraint(from, pt, AXIS_TOL_DEG) : null;
      if (axisKind) end = snapAxis(from, pt, axisKind);
      const nextGeoms: SoupGeom[] = [...(geoms as SoupGeom[]), { k: 'line', id, a: [from.x, from.y], b: [end.x, end.y] }];
      const nextRules: SoupRule[] = [...rules];
      if (chain!.prevId !== null) {
        nextRules.push({ k: 'coincident', a: chain!.prevId, aEnd: chain!.prevAt ?? 'b', b: id, bEnd: 'a' });
      }
      if (axisKind === 'horizontal') nextRules.push({ k: 'horizontal', a: id });
      else if (axisKind === 'vertical') nextRules.push({ k: 'vertical', a: id });
      // Close the loop when the endpoint lands on the chain's own start.
      const closes = snap && chain!.startId !== null && snap.id === chain!.startId && snap.at === (chain!.startAt ?? 'a');
      if (closes && chain!.startId !== null) {
        nextRules.push({ k: 'coincident', a: id, aEnd: 'b', b: chain!.startId, bEnd: chain!.startAt ?? 'a' });
      } else if (snap && !closes) {
        nextRules.push({ k: 'coincident', a: id, aEnd: 'b', b: snap.id, bEnd: snap.at });
      }
      writeDoc(nextGeoms, nextRules);
      if (closes) {
        setChain(null);
      } else {
        setChain({
          startId: chain!.startId ?? id,
          startAt: chain!.startAt ?? 'a',
          prevX: end.x,
          prevY: end.y,
          prevId: id,
          prevAt: 'b',
          pinOrigin: false,
        });
      }
    },
    [auto, chain, findSnap, geoms, rules, writeDoc, worldFromEvent],
  );

  const onSelectClick = useCallback(
    (e: React.MouseEvent) => {
      const snap = findSnap(e);
      const hit: Sel | null = snap ? { id: snap.id, at: snap.at } : findHit(e);
      setSel((prev) => {
        const base = e.shiftKey ? prev : [];
        if (!hit) return base;
        const idx = base.findIndex((s) => s.id === hit.id && s.at === hit.at);
        if (idx >= 0) {
          const copy = [...base];
          copy.splice(idx, 1);
          return copy;
        }
        return [...base, hit];
      });
    },
    [findHit, findSnap],
  );

  // The rect/circle/slot commits, factored out so the click-click flow and
  // the drag-to-create gesture write the SAME rows -- a second copy of the
  // row bookkeeping is how the two flows would drift apart.
  const commitRect = useCallback(
    (c1: Pt, c2: Pt) => {
      const a: [number, number] = [c1.x, c1.y];
      const b2: [number, number] = [c2.x, c1.y];
      const c: [number, number] = [c2.x, c2.y];
      const d: [number, number] = [c1.x, c2.y];
      const base = nextGeomId(geoms as CoreGeom[]);
      const nextGeoms: SoupGeom[] = [
        ...(geoms as SoupGeom[]),
        { k: 'line', id: base, a, b: b2 },
        { k: 'line', id: base + 1, a: b2, b: c },
        { k: 'line', id: base + 2, a: c, b: d },
        { k: 'line', id: base + 3, a: d, b: a },
      ];
      const nextRules: SoupRule[] = [
        ...rules,
        { k: 'coincident', a: base, aEnd: 'b', b: base + 1, bEnd: 'a' },
        { k: 'coincident', a: base + 1, aEnd: 'b', b: base + 2, bEnd: 'a' },
        { k: 'coincident', a: base + 2, aEnd: 'b', b: base + 3, bEnd: 'a' },
        { k: 'coincident', a: base + 3, aEnd: 'b', b: base, bEnd: 'a' },
        { k: 'horizontal', a: base },
        { k: 'vertical', a: base + 1 },
      ];
      writeDoc(nextGeoms, nextRules);
    },
    [geoms, rules, writeDoc],
  );

  const commitCircle = useCallback(
    (c: Pt, rim: Pt) => {
      const r = Math.hypot(rim.x - c.x, rim.y - c.y);
      if (r > 1e-9) pushGeom({ k: 'circle', c: [c.x, c.y], r });
    },
    [pushGeom],
  );

  /** The obround inscribed in a dragged box (drag-to-create's slot). The
   *  click-click slot asks for three points; a drag gives two, and reading
   *  BOTH box dimensions is what keeps the radius measured rather than
   *  invented. A square (or a straight) drag holds no obround and refuses. */
  const commitSlotBox = useCallback(
    (p0: Pt, p1: Pt) => {
      const box = slotFromBox(p0, p1);
      if (!box) {
        setStatus('slot: drag a box longer than it is wide -- a square holds no slot');
        return;
      }
      const base = nextGeomId(geoms as CoreGeom[]);
      const slot = slotRows(box.cA, box.cB, { x: box.cA.x + box.r, y: box.cA.y }, base);
      if (!slot) {
        setStatus('slot: drag a box longer than it is wide -- a square holds no slot');
        return;
      }
      writeDoc([...(geoms as SoupGeom[]), ...(slot.geoms as unknown as SoupGeom[])], [...rules, ...(slot.rules as unknown as SoupRule[])]);
    },
    [geoms, rules, writeDoc],
  );

  const onRectClick = useCallback(
    (e: React.MouseEvent) => {
      const w = worldFromEvent(e);
      if (clicks.length === 0) {
        setClicks([w]);
        return;
      }
      const [c1] = clicks as [Pt];
      commitRect(c1, w);
      setClicks([]);
    },
    [clicks, commitRect, worldFromEvent],
  );

  const onCircleClick = useCallback(
    (e: React.MouseEvent) => {
      if (clicks.length === 0) {
        const snap = findSnap(e);
        setClicks([snap ? snap.world : worldFromEvent(e)]);
        return;
      }
      const [c] = clicks as [Pt];
      commitCircle(c, worldFromEvent(e));
      setClicks([]);
    },
    [clicks, commitCircle, findSnap, worldFromEvent],
  );

  const onArcClick = useCallback(
    (e: React.MouseEvent) => {
      if (clicks.length < 2) {
        const snap = findSnap(e);
        setClicks([...(clicks as Pt[]), snap ? snap.world : worldFromEvent(e)]);
        return;
      }
      const [c1, c2] = clicks as [Pt, Pt];
      const arc = arcFromClicks(c1, c2, worldFromEvent(e));
      if (arc) {
        const ends = arcEnds(arc.cx, arc.cy, arc.r, arc.a0, arc.sweep);
        pushGeom({
          k: 'arc',
          c: [arc.cx, arc.cy],
          r: arc.r,
          a: [ends.a.x, ends.a.y],
          b: [ends.b.x, ends.b.y],
          sense: arc.sweep >= 0 ? 'ccw' : 'cw',
        });
      }
      setClicks([]);
    },
    [clicks, findSnap, pushGeom, worldFromEvent],
  );

  const onSlotClick = useCallback(
    (e: React.MouseEvent) => {
      if (clicks.length < 2) {
        const snap = findSnap(e);
        setClicks([...(clicks as Pt[]), snap ? snap.world : worldFromEvent(e)]);
        return;
      }
      const [cA, cB] = clicks as [Pt, Pt];
      const base = nextGeomId(geoms as CoreGeom[]);
      const slot = slotRows(cA, cB, worldFromEvent(e), base);
      if (!slot) {
        setStatus('slot: the radius needs a point off the first centre');
        setClicks([]);
        return;
      }
      writeDoc([...(geoms as SoupGeom[]), ...(slot.geoms as unknown as SoupGeom[])], [...rules, ...(slot.rules as unknown as SoupRule[])]);
      setClicks([]);
    },
    [clicks, findSnap, geoms, rules, worldFromEvent, writeDoc],
  );

  const onDeleteClick = useCallback(() => {
    if (sel.length === 0) return;
    // Descending id order: renumber() shifts ids above the removed one, so a
    // higher id removed first never shifts a lower one out from under us.
    let g = [...(geoms as SoupGeom[])];
    let r = [...rules];
    for (const s of [...sel].sort((a, b) => b.id - a.id)) {
      if (s.at !== null) continue; // a point selection deletes its geometry too
      const out = renumber(g as CoreGeom[], r as Record<string, any>[], s.id);
      g = out.geoms as SoupGeom[];
      r = out.rules as SoupRule[];
    }
    // A point named in a selection drops its row when nothing else references
    // it; v1 keeps the row (a point can carry constraints of its own).
    writeDoc(g, r);
    setSel([]);
  }, [geoms, rules, sel, writeDoc]);

  // Trim: click a line; it splits at the nearest crossing with another line
  // and the half under the click is deleted. The split point is found pure
  // (trimPick), the piece bookkeeping pure (trimLine).
  const onTrimClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const hit = findHit(e);
      if (!hit) {
        setStatus('trim: click on a line');
        return;
      }
      const click = worldFromEvent(e);
      const pick = trimPick(geoms as CoreGeom[], hit.id, click);
      if (!pick) {
        setStatus('trim: the line has no crossing with another line to trim at');
        return;
      }
      const out = trimLine(
        geoms as CoreGeom[],
        rules as unknown as Array<Record<string, any>>,
        hit.id,
        pick.at,
        click,
      );
      writeDoc(out.geoms as SoupGeom[], out.rules as SoupRule[]);
      setSel([]);
      setStatus('');
    },
    [findHit, geoms, rules, worldFromEvent, writeDoc],
  );

  // Fillet: click a corner where two lines meet, type the radius, Enter
  // commits. Unlike trim's single click-and-go, a fillet also needs a
  // NUMBER -- the inline radius chip below mirrors the on-canvas dimension
  // flow's click-THEN-type input, not its click-click-place: a corner is
  // already the one point a fillet needs, so there is no second click to
  // place a label.
  const onFilletClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const click = worldFromEvent(e);
      const pick = filletPick(geoms as CoreGeom[], click, screenPxToWorld(HIT_PX, view));
      if (!pick) {
        setStatus('fillet: click a corner where two lines meet');
        return;
      }
      const why = whyCannotFilletAt(geoms as CoreGeom[], pick.lineA, pick.endA, pick.lineB, pick.endB);
      if (why) {
        setStatus(why);
        return;
      }
      const maxR = maxFilletRadiusAt(geoms as CoreGeom[], pick.lineA, pick.endA, pick.lineB, pick.endB);
      setFilletPend({ ...pick, value: formatDim(maxR / 2), maxR });
      setStatus('');
    },
    [geoms, view, worldFromEvent],
  );

  /** Commit the pending fillet as ONE writeDoc = one undo entry. Auto-equal-
   *  radius rides along in the SAME call when the typed radius matches the
   *  PREVIOUS fillet committed this tool session -- see lastFilletArc's own
   *  comment for exactly what triggers it. */
  const commitFillet = useCallback(() => {
    if (!filletPend) return;
    const v = Number(filletPend.value.trim());
    if (!Number.isFinite(v) || v <= 0) {
      setStatus('fillet: type a positive radius');
      return;
    }
    const out = filletCornerAt(
      geoms as CoreGeom[],
      rules as unknown as Array<Record<string, any>>,
      filletPend.lineA,
      filletPend.endA,
      filletPend.lineB,
      filletPend.endB,
      v,
    );
    if (!out) {
      setStatus('fillet: that radius does not fit this corner');
      return;
    }
    let nextRules = out.rules;
    if (lastFilletArc.current && lastFilletArc.current.radius === v) {
      nextRules = applyEqualRadiusRule(nextRules, out.arcId, lastFilletArc.current.arcId);
    }
    writeDoc(out.geoms as SoupGeom[], nextRules as SoupRule[]);
    lastFilletArc.current = { arcId: out.arcId, radius: v };
    setFilletPend(null);
    setStatus('');
  }, [filletPend, geoms, rules, writeDoc]);
  
  // --- constraint buttons -----------------------------------------------------------
  const selShapes = useMemo(() => sel.filter((s) => s.at === null), [sel]);
  // Mirror the selected rows about the X or Y axis; copy them shifted. Both
  // duplicate with id offsets, then densifyIds renumbers the whole sketch.
  const onMirror = useCallback(
    (axis: 'x' | 'y') => {
      const ids = selShapes.map((s) => s.id);
      if (ids.length === 0) return;
      const out = mirrorSelection(geoms as CoreGeom[], rules as unknown as Array<Record<string, any>>[], ids, axis);
      if (!out) return;
      const dense = densifyIds(out.geoms, out.rules);
      writeDoc(dense.geoms as SoupGeom[], dense.rules as unknown as SoupRule[]);
      setSel([]);
    },
    [geoms, rules, selShapes, writeDoc],
  );

  const onCopy = useCallback(
    (dx: number, dy: number) => {
      const ids = selShapes.map((s) => s.id);
      if (ids.length === 0) return;
      const out = copySelection(geoms as CoreGeom[], rules as unknown as Array<Record<string, any>>[], ids, dx, dy);
      if (!out) return;
      const dense = densifyIds(out.geoms, out.rules);
      writeDoc(dense.geoms as SoupGeom[], dense.rules as unknown as SoupRule[]);
      setSel([]);
    },
    [geoms, rules, selShapes, writeDoc],
  );
  // Construction toggle, majority semantics (the archived cConstr): any
  // non-construction shape in the selection turns ALL of them construction;
  // only an all-construction selection toggles back.
  const onConstrClick = useCallback(() => {
    const ids = selShapes.map((s) => s.id);
    if (ids.length === 0) return;
    writeDoc(toggleConstruction(geoms, ids) as SoupGeom[], rules);
  }, [geoms, rules, selShapes, writeDoc]);

  // Offset: uses whatever is ALREADY selected (selShapes, the same source
  // Mirror/Copy read) if the selection is non-empty, so a student can
  // multi-select a connected chain with the select tool first; falls back
  // to a single-line click (findHit), same one-click pick as trim, when
  // nothing is selected yet. Either way the click ALSO decides which
  // perpendicular side the offset goes -- offsetChainPick reads it off
  // which side of the nearest chain segment the click landed on.
  const onOffsetClick = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const click = worldFromEvent(e);
      const ids =
        selShapes.length > 0
          ? selShapes.map((s) => s.id)
          : (() => {
              const hit = findHit(e);
              return hit ? [hit.id] : [];
            })();
      if (ids.length === 0) {
        setStatus('offset: select one or more connected lines, or click one to offset');
        return;
      }
      const pick = offsetChainPick(geoms as CoreGeom[], ids, click);
      if (!pick) {
        setStatus('offset: the selection is not a single connected chain of lines');
        return;
      }
      setOffsetPend({ ...pick, value: formatDim(1) });
      setStatus('');
    },
    [findHit, geoms, selShapes, worldFromEvent],
  );

  /** Commit the pending offset as ONE writeDoc = one undo entry. A
   *  distance <= 0 is refused by offsetChain itself (returns null); the
   *  message here covers that AND the plain non-numeric-input case. */
  const commitOffset = useCallback(() => {
    if (!offsetPend) return;
    const v = Number(offsetPend.value.trim());
    if (!Number.isFinite(v) || v <= 0) {
      setStatus('offset: type a positive distance');
      return;
    }
    const out = offsetChain(geoms as CoreGeom[], rules as unknown as Array<Record<string, any>>, offsetPend.chain, offsetPend.side, v);
    if (!out) {
      setStatus('offset: that distance could not be applied');
      return;
    }
    writeDoc(out.geoms as SoupGeom[], out.rules as SoupRule[]);
    setOffsetPend(null);
    setSel([]);
    setStatus('');
  }, [offsetPend, geoms, rules, writeDoc]);



  const selPoints = useMemo(() => sel.filter((s) => s.at !== null), [sel]);

  const applyRule = useCallback(
    (r: SoupRule) => {
      pushRule(r);
      setSel([]);
    },
    [pushRule],
  );

  /** Lock, as FreeCAD does it: not one opaque pin but a horizontal and a
   *  vertical distance from the origin, each carrying the coordinate the point
   *  has now, so both can be retyped afterwards. One writeDoc, one undo. */
  const lockPoint = useCallback(() => {
    if (selPoints.length !== 1) return;
    const [p] = selPoints as [Sel];
    const g = solved.find((x) => x.id === p.id);
    const w = g ? pointWorld(g as CoreGeom, p.at!) : null;
    if (!w) return;
    const tidy = (n: number) => Math.round(n * 1e6) / 1e6;
    writeDoc(geoms, [
      ...rules,
      { k: 'distanceX', a: -1, aEnd: 'a', b: p.id, bEnd: p.at!, value: tidy(w.x) },
      { k: 'distanceY', a: -1, aEnd: 'a', b: p.id, bEnd: p.at!, value: tidy(w.y) },
    ] as SoupRule[]);
    setSel([]);
  }, [geoms, rules, selPoints, solved, writeDoc]);

  /** Block: pin the picked edges where they are, with no dimension to type --
   *  both ends of a line, the centre and radius of a circle, all three points
   *  of an arc. */
  const canBlock =
    selShapes.length > 0 &&
    selShapes.every((s) => ['line', 'circle', 'arc'].includes(String(geomKind(s.id, solved))));
  const blockSelection = useCallback(() => {
    if (!canBlock) return;
    const add: SoupRule[] = [];
    for (const s of selShapes) {
      const g = solved.find((x) => x.id === s.id);
      if (!g) continue;
      if (g.k === 'line') add.push({ k: 'lock', a: g.id, aEnd: 'a' }, { k: 'lock', a: g.id, aEnd: 'b' });
      else if (g.k === 'circle') add.push({ k: 'lock', a: g.id, aEnd: 'c' }, { k: 'radius', a: g.id, value: g.r as number });
      else if (g.k === 'arc')
        add.push({ k: 'lock', a: g.id, aEnd: 'a' }, { k: 'lock', a: g.id, aEnd: 'b' }, { k: 'lock', a: g.id, aEnd: 'c' });
    }
    if (add.length === 0) return;
    writeDoc(geoms, [...rules, ...add]);
    setSel([]);
  }, [canBlock, geoms, rules, selShapes, solved, writeDoc]);

  const canHoriz = selShapes.length === 1 && geomKind(selShapes[0].id, solved) === 'line';
  const canVert = canHoriz;
  const canCoin = selPoints.length === 2;
  const canParallel = selShapes.length === 2 && bothLines(selShapes.map((s) => s.id), solved);
  const canEqual = canParallel;
  const canPerp = canParallel;
  // Tangent is between a line and a curve, or two curves -- never two lines,
  // which is what parallel/perpendicular are for.
  const canTangent = selShapes.length === 2 && !bothLines(selShapes.map((s) => s.id), solved);
  // A picked point placed onto a picked object -- one of each, from the same
  // click-accumulated selection (onSelectClick splits point-picks from
  // shape-picks by whether the click snapped).
  const canPointOnObject = selPoints.length === 1 && selShapes.length === 1;
  // Three points: the first two go symmetric about the third.
  const canSymmetric = selPoints.length === 3;
  const canLock = selPoints.length === 1;
  const canDimLine = selShapes.length === 1 && geomKind(selShapes[0].id, solved) === 'line';
  const canDimRadius =
    selShapes.length === 1 && ['circle', 'arc'].includes(String(geomKind(selShapes[0].id, solved)));
  const canDimDiameter = canDimRadius;

  const openDim = useCallback(
    (kind: 'distance' | 'radius' | 'diameter' | 'distanceX' | 'distanceY' | 'angle') => {
      const g = solved.find((x) => x.id === selShapes[0]?.id);
      if (!g) return;
      if ((kind === 'radius' || kind === 'diameter') && g.k !== 'circle' && g.k !== 'arc') return;
      const initial =
        kind === 'radius'
          ? String(g.r)
          : kind === 'diameter'
            ? String(2 * (g.r ?? 0))
            : kind === 'distance'
              ? String(Math.hypot((g.b?.[0] ?? 0) - (g.a?.[0] ?? 0), (g.b?.[1] ?? 0) - (g.a?.[1] ?? 0)))
              : (kind === 'distanceX' || kind === 'distanceY') && g.k === 'line'
                ? String(lineSmartDimension(g as any).value)
                : '0';
      setDim({ kind, a: selShapes[0] ?? null, b: null, value: initial });
    },
    [selShapes, solved],
  );

  /** What the ribbon's dimension buttons do, reached from the keyboard (P2.6's
   *  `D`). With something dimensionable picked this is exactly what it was
   *  before P2.7 -- the ribbon-docked box on the selection. With nothing
   *  picked it now ARMS the on-canvas flow instead of only complaining, which
   *  is the entry point item 7 asks for. */
  const openDimFromSelection = useCallback(() => {
    if (canDimLine) {
      // The same pick the on-canvas smart dimension makes: horizontal ->
      // Horizontal distance, vertical -> Vertical distance, else length.
      const g = solved.find((x) => x.id === selShapes[0]?.id) as any;
      openDim(g ? lineSmartDimension(g).kind : 'distance');
    } else if (canDimRadius) {
      const g = solved.find((x) => x.id === selShapes[0]?.id);
      openDim(g?.k === 'circle' ? 'diameter' : 'radius');
    }
    else {
      setTool('dim');
      setStatus('dimension: click a line, a circle, an arc, or two points');
    }
  }, [canDimLine, canDimRadius, openDim, selShapes, solved]);

  // SPEC-mouse-parity.md Phase 4.1: the marking menu's own view of the
  // current selection, as geometry kinds -- a named point (sel[i].at !==
  // null) is 'point' regardless of its parent row's own kind, everything
  // else is that row's geomKind() (fed straight to
  // validSketchConstraints(), which is what actually decides which
  // constraint wedges render enabled).
  const markingMenuSelection = useMemo<SketchSelectionEntry[]>(() => {
    const toGeomKind = (k: string | null): SketchGeomKind =>
      k === 'circle' || k === 'arc' || k === 'point' ? k : 'line';
    return sel.map((s) => ({ kind: s.at !== null ? 'point' : toGeomKind(geomKind(s.id, solved)) }));
  }, [sel, solved]);

  /** The marking menu's sketch-mode dispatch: mirrors, wedge for wedge, the
   *  exact rule-row shapes the Constrain toolbar buttons below already build
   *  (SketchCanvas2D.tsx's own applyRule() calls) -- a separate function
   *  rather than a shared extraction, since the buttons' onClick bodies stay
   *  untouched (this todo does not refactor them). The canX guards double-
   *  check what MarkingMenu.tsx's own disabled= already enforces, in case a
   *  stale selection reaches here between a render and a click. */
  function dispatchMarkingMenuCommand(id: string) {
    switch (id) {
      case 'done':
        onExit?.();
        return;
      case 'dim':
        openDimFromSelection();
        return;
      case 'horizontal':
        if (canHoriz) applyRule({ k: 'horizontal', a: selShapes[0].id });
        return;
      case 'vertical':
        if (canVert) applyRule({ k: 'vertical', a: selShapes[0].id });
        return;
      case 'coincident': {
        if (!canCoin) return;
        const [a, b] = selPoints as [Sel, Sel];
        applyRule({ k: 'coincident', a: a.id, aEnd: a.at!, b: b.id, bEnd: b.at! });
        return;
      }
      case 'parallel': {
        if (!canParallel) return;
        const [a, b] = selShapes as [Sel, Sel];
        applyRule({ k: 'parallel', a: a.id, b: b.id });
        return;
      }
      case 'perpendicular': {
        if (!canPerp) return;
        const [a, b] = selShapes as [Sel, Sel];
        applyRule({ k: 'perpendicular', a: a.id, b: b.id });
        return;
      }
      case 'equal': {
        if (!canEqual) return;
        const [a, b] = selShapes as [Sel, Sel];
        applyRule({ k: 'equal', a: a.id, b: b.id });
        return;
      }
      case 'tangent': {
        if (!canTangent) return;
        const [a, b] = selShapes as [Sel, Sel];
        applyRule({ k: 'tangent', a: a.id, b: b.id });
        return;
      }
      case 'pointOnObject': {
        if (!canPointOnObject) return;
        const [p] = selPoints as [Sel];
        const [s] = selShapes as [Sel];
        applyRule({ k: 'pointOnObject', a: p.id, aEnd: p.at!, b: s.id });
        return;
      }
      case 'symmetric': {
        if (!canSymmetric) return;
        const [a, b, c] = selPoints as [Sel, Sel, Sel];
        applyRule({ k: 'symmetric', a: a.id, aEnd: a.at!, b: b.id, bEnd: b.at!, c: c.id, cEnd: c.at! });
        return;
      }
      case 'lock': {
        if (!canLock) return;
        lockPoint();
        return;
      }
    }
  }

  const commitDim = useCallback(() => {
    if (!dim) return;
    const v = Number(dim.value);
    if (!Number.isFinite(v) || (v <= 0 && dim.kind !== 'distanceX' && dim.kind !== 'distanceY')) {
      setStatus('enter a number (positive unless a signed offset)');
      return;
    }
    if ((dim.kind === 'distanceX' || dim.kind === 'distanceY') && v === 0) {
      // A line's own horizontal/vertical distance: 0 folds it onto an axis.
      setStatus(dimensionValueError(dim.kind, dim.value, { collapses: true }) ?? 'enter a positive number');
      return;
    }
    const g = dim.a ? solved.find((x) => x.id === dim.a!.id) : null;
    if (!g) return;
    if (dim.kind === 'radius') applyRule({ k: 'radius', a: g.id, value: v });
    else if (dim.kind === 'diameter') applyRule({ k: 'diameter', a: g.id, value: v });
    else if (dim.kind === 'distance') applyRule({ k: 'distance', a: g.id, aEnd: 'a', b: g.id, bEnd: 'b', value: v });
    else if ((dim.kind === 'distanceX' || dim.kind === 'distanceY') && g.k === 'line') {
      const s = lineSmartDimension(g as any);
      applyRule({ k: dim.kind, a: s.a.id, aEnd: s.a.at!, b: s.b.id, bEnd: s.b.at!, value: v } as any);
    }
    setDim(null);
  }, [applyRule, dim, solved]);

  // --- the on-canvas dimension flow (P2.7) ---------------------------------

  /** Click one: what is under the cursor, and what does it want measured?
   *  Click two: where the label lands. A pick that snapped to a named POINT is
   *  half of a point-to-point distance and waits for the other half; anything
   *  else is an entity autoDimension can read on its own. */
  const onDimClick = useCallback(
    (e: React.MouseEvent) => {
      if (place?.dim && !place.at) {
        // The label lands here and the box opens on the measured value, so
        // Enter alone is a no-op and typing over it is the edit.
        // A two-point pick settles its kind HERE, from where the label
        // lands (FreeCAD: above/below -> Horizontal distance, beside ->
        // Vertical distance, else the straight distance).
        const at = worldFromEvent(e);
        const placed = placeDimension(solved as CoreGeom[], place.dim, at);
        setPlace({ ...place, dim: placed, at, value: formatDim(placed.value) });
        return;
      }
      const snap = findSnap(e);
      if (snap) {
        const first = place?.pending ?? null;
        if (!first) {
          setPlace({ pending: { id: snap.id, at: snap.at }, dim: null, at: null, value: '' });
          setStatus('dimension: pick the second point');
          return;
        }
        const pair = autoDimension(solved as CoreGeom[], first, { id: snap.id, at: snap.at });
        if (!pair) {
          setStatus('dimension: those two picks have no distance between them');
          setPlace(null);
          return;
        }
        setPlace({ pending: null, dim: pair, at: null, value: '' });
        setStatus('');
        return;
      }
      const hit = findHit(e);
      const found = hit ? autoDimension(solved as CoreGeom[], { id: hit.id, at: null }) : null;
      if (!found) {
        setStatus('dimension: click a line, a circle, an arc, or two points');
        return;
      }
      setPlace({ pending: null, dim: found, at: null, value: '' });
      setStatus('');
    },
    [findHit, findSnap, place, solved, worldFromEvent],
  );

  /** Commit the placed dimension as ONE rule row through ONE writeDoc, which
   *  is ONE onChange and therefore exactly one undo entry. A value the solver
   *  cannot take leaves the doc completely alone -- the note says why and the
   *  undo stack does not grow. */
  const commitPlacedDim = useCallback(() => {
    const d = place?.dim;
    if (!place || !d) return;
    if (refMode) {
      const ref = referenceRowOf(d);
      setRefDims((r) => [...r, { ...ref, label: place.at ?? null }]);
      setPlace(null);
      setStatus('');
      return;
    }
    const err = dimensionValueError(d.kind, place.value, { collapses: true });
    if (err) {
      setStatus(err);
      return;
    }
    const v = Number(place.value.trim());
    const row: SoupRule =
      d.kind === 'radius' || d.kind === 'diameter'
        ? ({ k: d.kind, a: d.a.id, value: v } as SoupRule)
        : {
            k: d.kind === 'distanceX' || d.kind === 'distanceY' ? d.kind : 'distance',
            a: d.a.id,
            aEnd: d.a.at ?? 'a',
            b: (d.b ?? d.a).id,
            bEnd: d.b?.at ?? 'b',
            value: v,
          };
    const index = rules.length;
    writeDoc(geoms, [...rules, row]);
    if (place.at) setLabelAt((m) => ({ ...m, [index]: place.at as Pt }));
    setPlace(null);
    setSelRule(null);
    setStatus('');
  }, [geoms, place, refMode, rules, writeDoc]);

  /** Re-type an ALREADY placed dimension: same one-writeDoc discipline, and
   *  the same refusal that writes nothing. */
  const commitRuleValue = useCallback(
    (i: number) => {
      const r = rules[i] as unknown as Record<string, any> | undefined;
      if (!r || !isDimensionRule(String(r.k))) return;
      const raw = draft[i];
      if (raw === undefined) return;
      // The label shows its unit; typing around it must not make it an error.
      const text = raw.replace(/\s*(mm|\u00b0|deg)\s*$/i, '');
      const err = dimensionValueError(r.k as DimKind, text, {
        collapses: r.a !== undefined && r.a === r.b && r.aEnd !== r.bEnd,
      });
      if (err) {
        setStatus(err);
        return;
      }
      const v = Number(text.trim());
      writeDoc(geoms, rules.map((x, j) => (j === i ? ({ ...x, value: v } as SoupRule) : x)));
      setDraft((d) => {
        const next = { ...d };
        delete next[i];
        return next;
      });
      setStatus('');
    },
    [draft, geoms, rules, writeDoc],
  );

  /** Delete the rule a glyph names. One writeDoc = one undo entry, and the
   *  rows effect re-opens and re-solves the session because `rules` changed.
   *  Label positions above the hole shift down with it -- they are keyed by
   *  index, and a stale key would move someone else's label. */
  /** Toggle reference/driving. With a placed dimension picked it becomes a
   *  reference: its row leaves the solve and is drawn as a measurement. With
   *  nothing picked it flips the mode the NEXT dimension is made in. */
  const toggleReference = () => {
    const i = selRule;
    const r = i !== null ? (rules[i] as unknown as Record<string, any> | undefined) : undefined;
    if (i !== null && r && isDimensionRule(String(r.k)) && ['distance', 'distanceX', 'distanceY', 'radius', 'diameter'].includes(String(r.k))) {
      const { value: _v, ...rest } = r;
      setRefDims((d) => [...d, { ...rest, label: labelAt[i] ?? null }]);
      removeRuleAt(i);
      return;
    }
    setRefMode((m) => !m);
  };

  const removeRuleAt = useCallback(
    (i: number) => {
      if (i < 0 || i >= rules.length) return;
      writeDoc(geoms, rules.filter((_, j) => j !== i));
      setSelRule(null);
      setHoverRule(null);
      setEditingRule(null);
      const shiftKeys = <T,>(m: Record<number, T>): Record<number, T> => {
        const out: Record<number, T> = {};
        for (const [k, v] of Object.entries(m)) {
          const n = Number(k);
          if (n === i) continue;
          out[n > i ? n - 1 : n] = v;
        }
        return out;
      };
      setLabelAt(shiftKeys);
      setDraft(shiftKeys);
    },
    [geoms, rules, writeDoc],
  );

  // --- drag to solve / drag to create ------------------------------------------------
  const draggingRef = useRef<{ id: number; at: 'a' | 'b' | 'c' } | null>(null);
  // Drag-to-create (SPEC-mouse-parity Phase 2 item 2). The ref carries the
  // gesture (it must be exact on pointerup, not a render behind); the state
  // carries only what the rubber band draws. Below DRAG_PX of travel the
  // press was a CLICK and the click-click flow keeps it, untouched.
  const createRef = useRef<{ tool: CreateTool; from: Pt; to: Pt | null; startX: number; startY: number; moved: boolean } | null>(null);
  const [dragCreate, setDragCreate] = useState<{ tool: CreateTool; from: Pt; to: Pt } | null>(null);
  /** A committed drag must not let the browser's trailing click ALSO run the
   *  click-click flow, which would leave a half-started rect behind it. */
  const suppressClickRef = useRef(false);
  // Whole-entity drag (SPEC-mouse-parity Phase 2 item 4): every named point
  // of the grabbed row, with the slot pair behind it and where it stood when
  // the gesture began, so each solver drag() aims at start + the pointer's
  // total delta rather than accumulating per-move error.
  const entityRef = useRef<{
    id: number;
    kind: string;
    slots: Array<{ sa: number; sb: number; x0: number; y0: number; at: 'a' | 'b' | 'c' }>;
    start: Pt;
    want: number;
    tol: number;
    applied: boolean;
    refused: boolean;
  } | null>(null);
  // Marquee select (SPEC-mouse-parity Phase 2 item 5). Same ref/state split as
  // drag-to-create, and the same DRAG_PX gate: under it the press stays a
  // plain pick. The band is world-space so it rides the viewBox like every
  // other drawn thing; the direction that decides window vs crossing is read
  // off the raw from/to pair, never off the normalized box.
  const marqueeRef = useRef<{ from: Pt; to: Pt; startX: number; startY: number; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ from: Pt; to: Pt } | null>(null);

  /** Apply whatever pulls are queued, in ONE animation frame, and read the
   *  result back. Not a render loop: the frame is a coalescer for a burst of
   *  pointermove events, asked for only when a move has queued work. */
  const scheduleSolve = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const list = pendingDrag.current;
      pendingDrag.current = null;
      const s = sessionRef.current;
      if (!list || !list.length || !s) return;
      for (const p of list) {
        if (!s.drag(p.sa, p.sb, p.tx, p.ty)) {
          setStatus(s.lastError() ?? 'the drag did not solve');
          return;
        }
      }
      const rows = readSolved(geoms as CoreGeom[], s.params);
      setSolved(rows);
      const ent = entityRef.current;
      if (!ent) return;
      // Did the row actually go where the pointer asked? One pinned by its
      // own rules solves fine and stays exactly where it was: saying so is
      // the difference between a refusal and a canvas that looks broken.
      const anchor = ent.slots[0];
      const row = rows.find((x) => x.id === ent.id);
      const now = row ? pointWorld(row, anchor.at) : null;
      const moved = now ? Math.hypot(now.x - anchor.x0, now.y - anchor.y0) : 0;
      if (moved > 1e-9) ent.applied = true;
      if (!ent.refused && ent.want > ent.tol && moved < ent.want * 0.05) {
        ent.refused = true;
        // "held by its rules" rather than "fully constrained": a row pinned
        // only ACROSS the drag direction refuses the hand on the mouse just
        // the same, and claiming zero DoF for it would be a lie.
        setStatus(`${ent.kind} ${ent.id} is held by its rules -- it did not follow the drag; remove a rule to move it`);
      }
    });
  }, [geoms]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // The marking menu's own click-vs-drag classifier reads the ORIGINAL
      // down position (see rightDownRef's own comment); recorded here,
      // ahead of the pan branch below, so a right-drag that pans still
      // leaves the down point this needs to tell it apart from a click.
      if (e.button === 2) {
        rightDownRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      }
      if (e.button === panButton || e.button === 1) {
        panRef.current = { x: e.clientX, y: e.clientY };
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {
          // no active pointer (a synthetic driver): the svg still sees moves
        }
        e.preventDefault();
        return;
      }
      // Only the primary button draws or drags. Touch and pen report 0 for
      // their primary contact, so this is not a mouse-only gate.
      if (e.button !== 0) return;
      if (isCreateTool(tool) && clicks.length === 0) {
        const snap = findSnap(e);
        createRef.current = {
          tool,
          from: snap ? snap.world : worldFromEvent(e),
          to: null,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {
          // no active pointer: the svg still sees the moves
        }
        return;
      }
      if (tool !== 'select') return;
      const snap = findSnap(e);
      if (snap) {
        // Same fully-constrained guard the whole-row drag below already had
        // (P2's own DoF badge, `diagnosis.dof === 0`) -- a named-point grab
        // (this branch) bypassed it entirely: `dofClass`/`dofText` painted
        // the sketch's DoF badge "Fully constrained ✓" while a single vertex
        // could still be pulled anywhere, contradicting the badge outright.
        const g = solved.find((x) => x.id === snap.id);
        if (diagnosis && diagnosis.dof === 0) {
          setStatus(`${g?.k ?? 'geometry'} ${snap.id} is fully constrained; remove a rule to move it`);
          return;
        }
        draggingRef.current = { id: snap.id, at: snap.at };
        // Capture keeps moves flowing outside the svg on a real pointer; a
        // synthetic driver has no active pointer, and capture throws NotFound
        // there — losing it is fine, the move handler still fires on the svg.
        try {
          (e.target as Element).setPointerCapture?.(e.pointerId);
        } catch {
          // no active pointer: nothing to capture, keep the drag ref
        }
        return;
      }
      // No handle under the press: NOTHING under it drags a marquee, a BODY
      // under it drags the whole row.
      const hit = findHit(e);
      if (!hit) {
        // EMPTY space under the press: a marquee, not an edit. Nothing in
        // this gesture touches the doc -- no writeDoc, no onChange, no undo
        // entry -- it only ever calls setSel on pointerup.
        const w0 = worldFromEvent(e);
        marqueeRef.current = { from: w0, to: w0, startX: e.clientX, startY: e.clientY, moved: false };
        try {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        } catch {
          // no active pointer: the svg still sees the moves
        }
        return;
      }
      if (hit.at !== null) return;
      // Every named point of the row moves by the same delta -- both ends of a
      // line, a circle's centre, an arc's centre and both ends -- each as one
      // solver drag() of the slot pair behind it. The centre goes first so an
      // arc translates its frame before its ends follow it.
      const g = solved.find((x) => x.id === hit.id);
      if (!g) return;
      if (diagnosis && diagnosis.dof === 0) {
        setStatus(`${g.k} ${g.id} is fully constrained; remove a rule to move it`);
        return;
      }
      const order = (at: 'a' | 'b' | 'c') => (at === 'c' ? 0 : 1);
      const slots: Array<{ sa: number; sb: number; x0: number; y0: number; at: 'a' | 'b' | 'c' }> = [];
      for (const { at } of [...namedPointsOf(g)].sort((p, q) => order(p.at) - order(q.at))) {
        const w0 = pointWorld(g, at);
        const pair = pointSlots(geoms as any, hit.id, at);
        if (w0 && pair) slots.push({ sa: pair[0], sb: pair[1], x0: w0.x, y0: w0.y, at });
      }
      if (!slots.length) return;
      entityRef.current = {
        id: hit.id,
        kind: g.k,
        slots,
        start: worldFromEvent(e),
        want: 0,
        tol: 0,
        applied: false,
        refused: false,
      };
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // no active pointer: nothing to capture, keep the drag ref
      }
    },
    [clicks.length, diagnosis, findHit, findSnap, geoms, panButton, solved, tool, worldFromEvent],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Todo 19/20's gesture classifier reads the pointer's LAST KNOWN
      // sample, not the contextmenu event's: the browser fires contextmenu
      // BEFORE pointerup (measured 2026-09-21: contextmenu's timeStamp
      // equals pointerdown's, its coords are the DOWN point), so
      // classifying from the contextmenu event itself reads a 0px/0ms
      // gesture and opens the menu on ANY drag.
      rightMoveRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      const pan = panRef.current;
      if (pan) {
        // Pan is pure view math, one setView per move event -- the pointer's
        // own coalescing is the only rate limit it needs.
        const dx = e.clientX - pan.x;
        const dy = e.clientY - pan.y;
        panRef.current = { x: e.clientX, y: e.clientY };
        setView((v) => panByPx(v, dx, dy));
        return;
      }
      const w = worldFromEvent(e);
      setPointer(w);
      setHoverSnap(findHoverSnap(e));
      const mq = marqueeRef.current;
      if (mq) {
        mq.to = w;
        if (!mq.moved && Math.hypot(e.clientX - mq.startX, e.clientY - mq.startY) >= DRAG_PX) mq.moved = true;
        if (mq.moved) setMarquee({ from: mq.from, to: mq.to });
        return;
      }
      const create = createRef.current;
      if (create) {
        const snap = findSnap(e);
        create.to = snap ? snap.world : w;
        if (!create.moved && Math.hypot(e.clientX - create.startX, e.clientY - create.startY) >= DRAG_PX) {
          create.moved = true;
        }
        if (create.moved) setDragCreate({ tool: create.tool, from: create.from, to: create.to });
        return;
      }
      const ent = entityRef.current;
      if (ent && sessionRef.current) {
        const dx = w.x - ent.start.x;
        const dy = w.y - ent.start.y;
        ent.want = Math.hypot(dx, dy);
        // Two DRAG_PX of travel is the point past which "it did not move" is
        // a fact about the sketch rather than about the mouse.
        ent.tol = screenPxToWorld(DRAG_PX * 2, view);
        pendingDrag.current = ent.slots.map((s) => ({ sa: s.sa, sb: s.sb, tx: s.x0 + dx, ty: s.y0 + dy }));
        scheduleSolve();
        return;
      }
      const d = draggingRef.current;
      if (!d || !sessionRef.current) return;
      const slots = pointSlots(geoms as any, d.id, d.at);
      if (!slots) return;
      pendingDrag.current = [{ sa: slots[0], sb: slots[1], tx: w.x, ty: w.y }];
      scheduleSolve();
    },
    [findHit, findHoverSnap, findSnap, geoms, scheduleSolve, view, worldFromEvent],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // Todo 19/20: THIS is where the right-button gesture classifies —
    // pointerup carries the gesture's real end coords + timestamp (the
    // contextmenu event does not: see the onContextMenu prop's comment). A
    // fast directional drag fires the wedge's command directly (no menu); a
    // release within the dead zone arms the menu-open (the actual render
    // happens on the contextmenu event, which the browser fires for the
    // same press); a drag past the dead zone is the pan gesture's and
    // opens nothing. Only when the active scheme pans with the right
    // button. Falls through to the pan branch below so IT clears panRef —
    // do not return before that.
    if (e.button === 2) {
      const downSample = rightDownRef.current;
      rightDownRef.current = null;
      // Todo 20's guard decides by the right button's CAMERA ROLE, not by
      // "is right the pan button": under the fusion default the right
      // button dollies (PAN=1), which is still a camera action -- the menu
      // must open on a click-shaped release there too, not just in legacy.
      if (rightButtonRole(schemeToMouseButtons(loadSchemeName())) !== 'none') {
        const upSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        const verdict = classifyGesture(downSample, upSample, MARKING_GESTURE);
        if (verdict.kind === 'wedge') {
          // Fast directional drag: the wedge's command fires with no
          // visible menu flash (SPEC :37-39). The wedge ids are the
          // sketch config's own, in MarkingMenu.tsx's layout order.
          const id = wedgesForMode('sketch')[verdict.wedgeIndex]?.id;
          if (id) dispatchMarkingMenuCommand(id);
          return;
        }
        if (verdict.kind === 'menu' && rightClickGuard(downSample, upSample, HOLD_CYCLE_DEAD_ZONE_PX) === 'menu') {
          // Click-shaped release: open the menu HERE. The contextmenu event
          // for this same press has ALREADY fired by now (Chromium fires it
          // at press time, before pointerup — measured 2026-09-21), so
          // relaying through a flag would never be consumed; this handler
          // is the last event of the gesture. The menu position is
          // viewport-relative; the render positions it inside the host via
          // its own container-relative math (the same offset onContextMenu
          // would have computed).
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) setMarkingMenu({ x: upSample.x - rect.left, y: upSample.y - rect.top });
        }
      }
    }
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const mq = marqueeRef.current;
    marqueeRef.current = null;
    if (mq) {
      setMarquee(null);
      if (mq.moved) {
        // Pure UI selection: marqueeSelect is a function of the solved rows
        // and the dragged box, and the only thing it feeds is React state.
        // A marquee therefore adds ZERO undo entries.
        const ids = marqueeSelect(solved as CoreGeom[], {
          startX: mq.from.x,
          startY: mq.from.y,
          endX: mq.to.x,
          endY: mq.to.y,
        });
        setSel((prev) => {
          const next = e.shiftKey ? [...prev] : [];
          for (const id of ids) {
            if (!next.some((s) => s.id === id && s.at === null)) next.push({ id, at: null });
          }
          return next;
        });
        // The click the browser fires after this press would otherwise run
        // onSelectClick on empty space and clear what the marquee just picked.
        suppressClickRef.current = true;
      }
      return;
    }
    const create = createRef.current;
    createRef.current = null;
    if (create) {
      setDragCreate(null);
      if (create.moved && create.to) {
        // ONE writeDoc for the whole gesture: the rubber band never entered
        // the doc, so this is the first and only undo entry it makes.
        suppressClickRef.current = true;
        if (create.tool === 'rect') commitRect(create.from, create.to);
        else if (create.tool === 'circle') commitCircle(create.from, create.to);
        else commitSlotBox(create.from, create.to);
      }
      return;
    }
    const ent = entityRef.current;
    entityRef.current = null;
    if (ent) {
      // ONE undo entry per gesture: every intermediate solve moved only the
      // session's parameter vector, and a row that never moved (a refusal)
      // writes nothing at all.
      if (ent.applied) {
        const rows = readSolved(geoms as CoreGeom[], sessionRef.current.params) as SoupGeom[];
        writeDoc(rows, rules);
      }
      return;
    }
    const d = draggingRef.current;
    draggingRef.current = null;
    if (!d) return;
    // Commit the dragged positions as row values: read the solved vector back
    // into the doc (one onChange per gesture = one undo entry).
    const rows = readSolved(geoms as CoreGeom[], sessionRef.current.params) as SoupGeom[];
    writeDoc(rows, rules);
  }, [commitCircle, commitRect, commitSlotBox, geoms, rules, solved, writeDoc]);

  // --- keyboard -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never while a text field owns the keys: the dimension value box is one
      // keystroke away from every letter below, and D typed into it must stay
      // a D.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key === 'Escape') {
        if (dim) setDim(null);
        else if (place) setPlace(null);
        else if (selRule !== null) setSelRule(null);
        else if (chain || clicks.length) {
          setChain(null);
          setClicks([]);
        } else onExit?.();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // A picked constraint glyph outranks a picked shape: the glyph is
        // what the user is looking at, and it is the narrower thing to lose.
        if (selRule !== null) {
          removeRuleAt(selRule);
          e.preventDefault();
        } else if (tool === 'select') onDeleteClick();
      } else if (e.key.toLowerCase() === 'f' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        fit();
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        // The tool letters (SPEC-mouse-parity Phase 2 item 6). Shift is not
        // excluded -- an upper-case L is still the line tool -- but anything
        // that means "a browser or OS command" is.
        const key = e.key.toLowerCase();
        const picked = TOOL_KEYS[key];
        // A consumed shortcut swallows its own keystroke: D opens a value box
        // that autofocuses, and without this the D itself lands in it.
        if (picked) {
          setTool(picked);
          e.preventDefault();
        } else if (key === 'd') {
          openDimFromSelection();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chain, clicks.length, dim, fit, onDeleteClick, onExit, openDimFromSelection, place, removeRuleAt, selRule, tool]);

  // Arming another tool drops a half-placed dimension: a ghost label trailing
  // the cursor while the line tool draws is a lie about what the next click
  // does. Nothing here touches the doc.
  useEffect(() => {
    if (tool !== 'dim') setPlace(null);
  }, [tool]);

  // Arming another tool drops a pending fillet radius the same way, AND
  // resets the auto-equal-radius chain: leaving fillet and coming back is a
  // fresh session, not a continuation of whatever corner was rounded before.
  useEffect(() => {
    if (tool !== 'fillet') {
      setFilletPend(null);
      lastFilletArc.current = null;
    }
  }, [tool]);

  // Arming another tool drops a pending offset the same way.
  useEffect(() => {
    if (tool !== 'offset') setOffsetPend(null);
  }, [tool]);

  // --- render --------------------------------------------------------------------------
  const selKey = (id: number, at: 'a' | 'b' | 'c' | null) => `${id}:${at ?? ''}`;
  const isSel = (id: number, at: 'a' | 'b' | 'c' | null) => sel.some((s) => s.id === id && s.at === at);

  // Colour coding by solver state: rows named by a conflicting or redundant
  // constraint, then rows nothing can move (fully constrained), else plain.
  const blamed = new Map<number, 'conflict' | 'redundant'>();
  if (diagnosis && (diagnosis.bucket === 'conflicting' || diagnosis.bucket === 'redundant')) {
    for (const ri of diagnosis.blame) {
      const r = rules[ri] as unknown as Record<string, any> | undefined;
      if (!r) continue;
      for (const f of ['a', 'b', 'c']) {
        if (typeof r[f] === 'number') blamed.set(r[f], diagnosis.bucket === 'conflicting' ? 'conflict' : 'redundant');
      }
    }
  }
  const stateCls = (id: number) =>
    blamed.has(id) ? ` sk-${blamed.get(id)}` : fullIds.has(id) ? ' sk-full' : '';
  const ruleStateCls = (i: number) =>
    diagnosis && diagnosis.blame.includes(i)
      ? diagnosis.bucket === 'conflicting' ? ' sk-rule-conflict' : diagnosis.bucket === 'redundant' ? ' sk-rule-redundant' : ''
      : '';

  const vertex = (id: number, at: 'a' | 'b' | 'c', w: Pt, key: string) => {
    const selected = isSel(id, at);
    return (
      <circle
        key={key}
        className={`sk-vertex${selected ? ' sk-vertex-sel' : ''}${stateCls(id)}`}
        cx={w.x}
        cy={-w.y}
        r={VERTEX_R_PX * mmPerPx}
        data-part={`v:${id}:${at}`}
      />
    );
  };

  const shapes: React.ReactNode[] = [];
  for (const g of solved) {
    if (hiddenGeoms.has(g.id)) continue;
    const shapeSel = isSel(g.id, null);
    const cls = `sk-shape${shapeSel ? ' sk-shape-sel' : ''}${g.construction ? ' sk-constr' : ''}${stateCls(g.id)}`;
    if (g.k === 'line') {
      shapes.push(
        <line
          key={`g${g.id}`}
          className={cls}
          x1={g.a[0]}
          y1={-g.a[1]}
          x2={g.b[0]}
          y2={-g.b[1]}
          data-part={`s:${g.id}`}
        />,
      );
      shapes.push(vertex(g.id, 'a', { x: g.a[0], y: g.a[1] }, `va${g.id}`));
      shapes.push(vertex(g.id, 'b', { x: g.b[0], y: g.b[1] }, `vb${g.id}`));
    } else if (g.k === 'circle') {
      shapes.push(
        <circle key={`g${g.id}`} className={cls} cx={g.c[0]} cy={-g.c[1]} r={g.r} data-part={`s:${g.id}`} />,
      );
      shapes.push(vertex(g.id, 'c', { x: g.c[0], y: g.c[1] }, `vc${g.id}`));
    } else if (g.k === 'arc') {
      const ang = arcAngles(g as CoreGeom);
      if (ang) {
        const pts = sampleArc(g.c[0], g.c[1], g.r, ang.a0, ang.sweep);
        shapes.push(
          <polyline
            key={`g${g.id}`}
            className={cls}
            points={pts.map((p) => `${p.x},${-p.y}`).join(' ')}
            data-part={`s:${g.id}`}
          />,
        );
      }
      shapes.push(vertex(g.id, 'c', { x: g.c[0], y: g.c[1] }, `vc${g.id}`));
      shapes.push(vertex(g.id, 'a', { x: g.a[0], y: g.a[1] }, `va${g.id}`));
      shapes.push(vertex(g.id, 'b', { x: g.b[0], y: g.b[1] }, `vb${g.id}`));
    } else if (g.k === 'point') {
      shapes.push(vertex(g.id, 'a', { x: g.p[0], y: g.p[1] }, `vp${g.id}`));
    }
  }

  // Live preview per tool.
  let preview: React.ReactNode = null;
  if (tool === 'line' && chain && pointer) {
    const from = { x: chain.prevX, y: chain.prevY };
    const axisKind = auto ? inferLineConstraint(from, pointer, AXIS_TOL_DEG) : null;
    const pt = axisKind ? snapAxis(from, pointer, axisKind) : pointer;
    preview = (
      <>
        <line className="sk-rubber" x1={from.x} y1={-from.y} x2={pt.x} y2={-pt.y} />
        {axisKind && (
          <text className="sk-axis-hint" x={pt.x + 4 * mmPerPx} y={-pt.y - 4 * mmPerPx} fontSize={AXIS_HINT_PX * mmPerPx}>
            {axisKind === 'horizontal' ? '—' : '|'}
          </text>
        )}
      </>
    );
  } else if (tool === 'rect' && (dragCreate || (clicks.length === 1 && pointer))) {
    // One rubber band, two ways in: the drag gesture carries its own
    // from/to, the click-click flow the first click plus the live pointer.
    const c1 = dragCreate ? dragCreate.from : (clicks[0] as Pt);
    const p = dragCreate ? dragCreate.to : (pointer as Pt);
    preview = (
      <rect
        className="sk-preview"
        x={Math.min(c1.x, p.x)}
        y={-Math.max(c1.y, p.y)}
        width={Math.abs(p.x - c1.x)}
        height={Math.abs(p.y - c1.y)}
      />
    );
  } else if (tool === 'circle' && (dragCreate || (clicks.length === 1 && pointer))) {
    const c = dragCreate ? dragCreate.from : (clicks[0] as Pt);
    const p = dragCreate ? dragCreate.to : (pointer as Pt);
    preview = <circle className="sk-preview" cx={c.x} cy={-c.y} r={Math.hypot(p.x - c.x, p.y - c.y)} />;
  } else if (tool === 'arc' && clicks.length === 2 && pointer) {
    const [c1, c2] = clicks as [Pt, Pt];
    const arc = arcFromClicks(c1, c2, pointer);
    if (arc) {
      const pts = sampleArc(arc.cx, arc.cy, arc.r, arc.a0, arc.sweep);
      preview = <polyline className="sk-preview" points={pts.map((p) => `${p.x},${-p.y}`).join(' ')} />;
    }
  } else if (tool === 'slot' && dragCreate) {
    const box = slotFromBox(dragCreate.from, dragCreate.to);
    if (box) preview = slotPreview(box.cA, box.cB, box.r);
  } else if (tool === 'slot' && clicks.length === 2 && pointer) {
    // Slot preview: the two cap circles + the two side lines, at the live
    // radius. The committed rows run the same math (slotRows).
    const [cA, cB] = clicks as [Pt, Pt];
    preview = slotPreview(cA, cB, Math.hypot(pointer.x - cA.x, pointer.y - cA.y));
  } else if (tool === 'dim' && place?.dim && !place.at && pointer) {
    // The ghost label (P2.7): a leader from what is being measured to the
    // cursor, and the live value riding beside it, so the user sees WHAT they
    // picked before they commit to where the label goes.
    const from = place.dim.anchor;
    const prefix = place.dim.kind === 'radius' ? 'R' : place.dim.kind === 'diameter' ? '⌀' : '';
    preview = (
      <>
        <line className="sk-rubber" x1={from.x} y1={-from.y} x2={pointer.x} y2={-pointer.y} />
        <text
          className="sk-dim-ghost"
          data-dim-ghost="true"
          x={pointer.x + 4 * mmPerPx}
          y={-pointer.y - 4 * mmPerPx}
          fontSize={AXIS_HINT_PX * mmPerPx}
        >
          {prefix}
          {formatDim(place.dim.value)}
        </text>
      </>
    );
  }

  // Which marquee is being dragged, decided by the same pure function that
  // will pick the rows on pointerup -- the band cannot promise one rule and
  // the selection apply the other.
  const marqueeNow = marquee
    ? marqueeKind({ startX: marquee.from.x, startY: marquee.from.y, endX: marquee.to.x, endY: marquee.to.y })
    : null;

  const solverMsg = solverMessage(diagnosis, solved.length);

  // --- the constraint layer (P2.8) + the dimension chips (P2.7) ------------
  // One anchor per rule, index-aligned with `rules`, fanned out where several
  // land on the same spot. Pure math over the solved rows; recomputed when
  // they change, not on a frame.
  const ruleAnchors = useMemo(
    () => ruleGlyphAnchors(solved as CoreGeom[], rules as unknown as Array<Record<string, any>>, RULE_GLYPH_STEP_PX * mmPerPx),
    [solved, rules, mmPerPx],
  );

  const ruleNodes: React.ReactNode[] = [];
  rules.forEach((r, i) => {
    const anchor = ruleAnchors[i];
    // A value rule is drawn by its CHIP below -- the number is its glyph --
    // so only the icon kinds get one here.
    if (!anchor || isDimensionRule(r.k) || hiddenRules.has(i)) return;
    // A weld at a shared corner is already drawn by the corner itself;
    // its mark appears only when the row is hovered or picked.
    if (r.k === 'coincident' && !showCoincident && hoverRule !== i && selRule !== i) return;
    // Show Constraints off: only a hovered or selected rule keeps its
    // glyph (the lesson's "clicking an entity ... displays only its
    // associated constraint glyphs" read; the entity-filter variant is
    // the same gate by hover/pick).
    if (!showConstraints && hoverRule !== i && selRule !== i) return;
    const hovered = hoverRule === i;
    const picked = selRule === i;
    // The anchor is the midpoint, and the glyph is drawn a constant SCREEN
    // nudge up-and-right of it. Without the nudge a horizontal mark on a
    // horizontal edge is drawn exactly along the line it describes and
    // disappears into it -- measured in the P2.8 smoke screenshot. Diagonal,
    // so it clears a vertical edge too. The hit circle moves with it: you
    // hover what you can see.
    const x = anchor.x + GLYPH_NUDGE_PX * mmPerPx;
    const y = -anchor.y - GLYPH_NUDGE_PX * mmPerPx; // the file-wide flip
    ruleNodes.push(
      <g
        key={`r${i}`}
        className={`sk-rule-glyph${hovered ? ' sk-rule-hover' : ''}${picked ? ' sk-rule-sel' : ''}${ruleStateCls(i)}`}
        data-rule={i}
        data-rule-kind={r.k}
        data-rule-hover={hovered ? 'true' : undefined}
        data-rule-selected={picked ? 'true' : undefined}
        onPointerMove={() => setHoverRule(i)}
        onPointerLeave={() => setHoverRule((h) => (h === i ? null : h))}
        onPointerDown={(e) => {
          // The press stops here: it must not start a marquee, an entity
          // drag, or a create gesture underneath the glyph.
          e.stopPropagation();
        }}
        onClick={(e) => {
          // And neither may the click reach a draw tool -- clicking a glyph
          // picks the rule, it never adds geometry.
          e.stopPropagation();
          setSelRule(i);
          setSel([]);
        }}
      >
        <circle className="sk-rule-hit" cx={x} cy={y} r={RULE_HIT_PX * mmPerPx} />
        <circle className="sk-rule-bg" cx={x} cy={y} r={(RULE_GLYPH_PX * 0.75) * mmPerPx} />
        <g className="sk-rule-icon">{ruleIcon(r.k, x, y, (RULE_GLYPH_PX / 2) * mmPerPx)}</g>
      </g>,
    );
  });

  /** Screen position of a world point under the CURRENT view -- the same math
   *  the viewBox is derived from, so the HTML chips sit exactly where the svg
   *  would have drawn them. Read during render, so it cannot use the live CTM
   *  (which still holds the previous viewBox until React commits). */
  const chipAt = (p: Pt) => worldToScreen(view, p, size);

  // The dimension lines themselves: extension lines, a dimension line with
  // arrowheads, drawn under the number. One entry per dimension rule.
  const dimArt = useMemo(() => {
    const pts: Pt[] = [];
    for (const g of solved as CoreGeom[]) {
      if (g.k === 'line') pts.push({ x: g.a[0], y: g.a[1] }, { x: g.b[0], y: g.b[1] });
      else if (g.k === 'circle' || g.k === 'arc') pts.push({ x: g.c[0], y: g.c[1] });
      else if (g.k === 'point') pts.push({ x: g.p[0], y: g.p[1] });
    }
    const centroid = pts.length
      ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }
      : { x: 0, y: 0 };
    return rules.map((r, i) =>
      isDimensionRule(r.k)
        ? dimensionArt(solved as CoreGeom[], r as unknown as Record<string, any>, labelAt[i] ?? null, DIM_OFFSET_PX * mmPerPx, centroid)
        : null,
    );
  }, [solved, rules, labelAt, mmPerPx]);
  const arrowW = 3.4 * mmPerPx;
  const arrowL = 10 * mmPerPx;
  const dimArtNodes: React.ReactNode[] = [];
  dimArt.forEach((art, i) => {
    if (!art || hiddenRules.has(i)) return;
    const cls = `sk-dimart${hoverRule === i ? ' sk-rule-hover' : ''}${selRule === i ? ' sk-rule-sel' : ''}${ruleStateCls(i)}`;
    dimArtNodes.push(
      <g key={`da${i}`} className={cls} data-dim-art={i}>
        {art.lines.map(([p, q], j) => (
          <line key={j} x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} />
        ))}
        {art.arrows.map((a, j) => {
          const bx = a.tip.x - a.dir.x * arrowL;
          const by = a.tip.y - a.dir.y * arrowL;
          const nx = -a.dir.y * arrowW;
          const ny = a.dir.x * arrowW;
          return (
            <polygon
              key={`h${j}`}
              className="sk-dimart-head"
              points={`${a.tip.x},${-a.tip.y} ${bx + nx},${-(by + ny)} ${bx - nx},${-(by - ny)}`}
            />
          );
        })}
      </g>,
    );
  });

  // Reference dimensions: the same drawing, in the driven colour, and a
  // read-only number in brackets that follows the geometry.
  const refCentroid = useMemo(() => {
    const pts: Pt[] = [];
    for (const g of solved as CoreGeom[]) {
      if (g.k === 'line') pts.push({ x: g.a[0], y: g.a[1] }, { x: g.b[0], y: g.b[1] });
      else if (g.k === 'circle' || g.k === 'arc') pts.push({ x: g.c[0], y: g.c[1] });
      else if (g.k === 'point') pts.push({ x: g.p[0], y: g.p[1] });
    }
    return pts.length
      ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }
      : { x: 0, y: 0 };
  }, [solved]);
  const refArts = refDims.map((r) =>
    dimensionArt(solved as CoreGeom[], r, (r.label as Pt | null) ?? null, DIM_OFFSET_PX * mmPerPx, refCentroid),
  );
  const refNodes: React.ReactNode[] = [];
  refArts.forEach((art, i) => {
    if (!art) return;
    refNodes.push(
      <g key={`rf${i}`} className="sk-dimart sk-dimart-ref" data-ref-art={i}>
        {art.lines.map(([p, q], j) => (
          <line key={j} x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} />
        ))}
        {art.arrows.map((a, j) => {
          const bx = a.tip.x - a.dir.x * arrowL;
          const by = a.tip.y - a.dir.y * arrowL;
          const nx = -a.dir.y * arrowW;
          const ny = a.dir.x * arrowW;
          return (
            <polygon
              key={`h${j}`}
              className="sk-dimart-head"
              points={`${a.tip.x},${-a.tip.y} ${bx + nx},${-(by + ny)} ${bx - nx},${-(by - ny)}`}
            />
          );
        })}
      </g>,
    );
  });

  /** The mouse-up that ends the click which focused a value box would drop
   *  the caret in and un-select the text, so typing appended to the old
   *  number (25 became 2530). Eat that one mouse-up. */
  const keepSelection = (e: React.MouseEvent<HTMLInputElement>) => {
    if (e.currentTarget.dataset.fresh) {
      delete e.currentTarget.dataset.fresh;
      e.preventDefault();
    }
  };
  const dimChips: React.ReactNode[] = [];
  if (size.width > 0) {
    // Screen boxes already taken: every constraint mark that is drawn, then
    // each chip as it is placed. A label that would land on one steps aside
    // (up, down, then sideways) rather than hide it.
    const taken: Array<{ x: number; y: number; hw: number; hh: number }> = [];
    const markR = RULE_GLYPH_PX * 0.75 + 1;
    rules.forEach((r, i) => {
      const anchor = ruleAnchors[i];
      if (!anchor || isDimensionRule(r.k) || hiddenRules.has(i)) return;
      if (r.k === 'coincident' && !showCoincident && hoverRule !== i && selRule !== i) return;
      if (!showConstraints && hoverRule !== i && selRule !== i) return;
      const g = chipAt(anchor);
      taken.push({ x: g.x + GLYPH_NUDGE_PX, y: g.y - GLYPH_NUDGE_PX, hw: markR, hh: markR });
    });
    const hit = (x: number, y: number, hw: number, hh: number) =>
      taken.some((t) => Math.abs(t.x - x) < t.hw + hw && Math.abs(t.y - y) < t.hh + hh);
    rules.forEach((r, i) => {
      if (!isDimensionRule(r.k) || hiddenRules.has(i)) return;
      const art = dimArt[i];
      const placed = art ? art.label : labelAt[i];
      const anchor = placed ?? ruleAnchors[i];
      if (!anchor) return;
      // A label the user dropped goes exactly where they dropped it; one that
      // has never been placed takes the same nudge the icons do, for the same
      // reason -- a number centred on its own line is unreadable. A dimension
      // with drawn art rests ON its dimension line instead.
      const s = chipAt(anchor);
      if (!placed) {
        s.x += GLYPH_NUDGE_PX;
        s.y -= GLYPH_NUDGE_PX;
      }
      const committed = formatDim(Number((r as unknown as Record<string, any>).value ?? 0));
      const unit = dimUnit(String(r.k));
      const shown = draft[i] ?? committed + unit;
      const hovered = hoverRule === i;
      const picked = selRule === i;
      const chw = (Math.max(3, shown.length + 1) * 8 + 12) / 2;
      const chh = 10;
      if (hit(s.x, s.y, chw, chh)) {
        const step = chh * 2 + 4;
        const tries: Array<[number, number]> = [
          [0, -step], [0, step], [chw + markR + 2, 0], [-(chw + markR + 2), 0], [0, -2 * step], [0, 2 * step],
        ];
        for (const [dx, dy] of tries) {
          if (!hit(s.x + dx, s.y + dy, chw, chh)) {
            s.x += dx;
            s.y += dy;
            break;
          }
        }
      }
      taken.push({ x: s.x, y: s.y, hw: chw, hh: chh });
      dimChips.push(
        <input
          key={`dc${i}`}
          className={`sk2d-dim-chip${hovered ? ' sk-rule-hover' : ''}${picked ? ' sk-rule-sel' : ''}${ruleStateCls(i)}`}
          data-rule={i}
          data-rule-kind={r.k}
          data-rule-hover={hovered ? 'true' : undefined}
          data-rule-selected={picked ? 'true' : undefined}
          data-editing={editingRule === i ? 'true' : undefined}
          // The box is sized in px from the same figure the collision test
          // above uses (`chw`), border-box so padding is inside it: a chip
          // whose real width ran wider than its estimate is what let a wide
          // label sit on top of a constraint mark.
          style={{ left: `${s.x}px`, top: `${s.y}px`, width: `${chw * 2}px`, boxSizing: 'border-box' }}
          size={Math.max(3, shown.length + 1)}
          value={shown}
          // Every chip is a real focusable input, ALWAYS mounted: that is what
          // makes Tab walk from one dimension to the next for free.
          onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))}
          onFocus={(e) => {
            setEditingRule(i);
            setSelRule(i);
            e.currentTarget.select();
            e.currentTarget.dataset.fresh = '1';
          }}
          onMouseUp={keepSelection}
          onBlur={() => {
            // A blur without Enter REVERTS: half a number is not an edit.
            setEditingRule((v) => (v === i ? null : v));
            setDraft((d) => {
              if (d[i] === undefined) return d;
              const next = { ...d };
              delete next[i];
              return next;
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRuleValue(i);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onPointerMove={() => setHoverRule(i)}
          onPointerLeave={() => setHoverRule((h) => (h === i ? null : h))}
          // The named edge case: a press on a value box must never reach the
          // canvas, or the gesture it belongs to gets cancelled underneath it.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            // Reopen an already-placed label on its CURRENT value.
            e.stopPropagation();
            e.currentTarget.focus();
            e.currentTarget.select();
          }}
        />,
      );
    });
    refDims.forEach((r, i) => {
      const art = refArts[i];
      if (!art) return;
      const origin = { k: 'point', id: -1, p: [0, 0] } as unknown as CoreGeom;
      const pick = (id: number) => (id === -1 ? origin : (solved as CoreGeom[]).find((g) => g.id === id));
      const ga = pick(r.a);
      const gb = pick(r.b ?? r.a);
      let v: number | null = null;
      if ((r.k === 'radius' || r.k === 'diameter') && ga && 'r' in ga) v = (r.k === 'diameter' ? 2 : 1) * ((ga as any).r as number);
      else if (ga && gb) {
        const p = pointWorld(ga, r.aEnd ?? 'a');
        const q = pointWorld(gb, r.bEnd ?? 'b');
        if (p && q) {
          v = r.k === 'distanceX' ? Math.abs(q.x - p.x) : r.k === 'distanceY' ? Math.abs(q.y - p.y) : Math.hypot(q.x - p.x, q.y - p.y);
        }
      }
      if (v === null) return;
      const s = chipAt(art.label);
      dimChips.push(
        <span
          key={`rc${i}`}
          className="sk2d-dim-chip sk-ref-chip"
          data-ref-dim={i}
          title="Reference dimension: measured, not driving. Double-click to remove."
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRefDims((d) => d.filter((_, j) => j !== i));
          }}
        >
          ({formatDim(v)} mm)
        </span>,
      );
    });
    // The dimension being placed right now has no rule row yet, so it carries
    // its own chip until Enter turns it into one.
    if (place?.dim && place.at) {
      const s = chipAt(place.at);
      dimChips.push(
        <input
          key="dc-pending"
          className="sk2d-dim-chip"
          data-dim-pending="true"
          data-rule-kind={place.dim.kind}
          data-editing="true"
          ref={focusAndSelect}
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          size={Math.max(3, place.value.length + 1)}
          value={place.value}
          onChange={(e) => setPlace((p) => (p ? { ...p, value: e.target.value } : p))}
          onFocus={(e) => { e.currentTarget.select(); e.currentTarget.dataset.fresh = '1'; }}
          onMouseUp={keepSelection}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitPlacedDim();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setPlace(null);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />,
      );
    }
    // The pending fillet radius: a chip at the picked corner, same input
    // pattern as the pending dimension chip above -- Enter commits through
    // filletCornerAt, Escape drops the pick with no doc change.
    if (filletPend) {
      const s = chipAt(filletPend.corner);
      dimChips.push(
        <input
          key="fc-pending"
          className="sk2d-dim-chip"
          data-fillet-pending="true"
          data-editing="true"
          ref={focusAndSelect}
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          size={Math.max(3, filletPend.value.length + 1)}
          value={filletPend.value}
          onChange={(e) => setFilletPend((p) => (p ? { ...p, value: e.target.value } : p))}
          onFocus={(e) => { e.currentTarget.select(); e.currentTarget.dataset.fresh = '1'; }}
          onMouseUp={keepSelection}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitFillet();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFilletPend(null);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />,
      );
    }
    // The pending offset distance: a chip at the picked chain's first
    // point, same click-then-type input as the fillet chip above -- Enter
    // commits through offsetChain, Escape drops the pick with no doc
    // change.
    if (offsetPend) {
      const s = chipAt(offsetPend.chain[0].from);
      dimChips.push(
        <input
          key="offset-pending"
          className="sk2d-dim-chip"
          data-offset-pending="true"
          data-editing="true"
          ref={focusAndSelect}
          style={{ left: `${s.x}px`, top: `${s.y}px` }}
          size={Math.max(3, offsetPend.value.length + 1)}
          value={offsetPend.value}
          onChange={(e) => setOffsetPend((p) => (p ? { ...p, value: e.target.value } : p))}
          onFocus={(e) => { e.currentTarget.select(); e.currentTarget.dataset.fresh = '1'; }}
          onMouseUp={keepSelection}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitOffset();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOffsetPend(null);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />,
      );
    }
  }

  // Docked into the ribbon, same portal target ModelEditor's own toolbar
  // uses -- while a sketch is open, ModelEditor hides its 3D groups behind
  // that same host and leaves File/Edit/Done, so this renders right after
  // them rather than floating a second toolbar over the canvas.
  const ribbonHost = typeof document !== 'undefined' ? document.getElementById('reshapeRibbon') : null;
  return (
    <div className="sk2d-host">
      <style>{SK2D_CSS}</style>
      {ribbonHost && createPortal(
        <div className="model-tools sk-ribbon">
          <div className="model-tool-group">
            <div className="model-tool-icons">
              {(
                [
                  ['select', 'Select', 'select'],
                  ['line', 'Line', 'line'],
                  ['rect', 'Rect', 'rect'],
                  ['circle', 'Circle', 'circle'],
                  ['arc', 'Arc', 'arc'],
                  ['slot', 'Slot', 'slot'],
                  ['trim', 'Trim', 'trim'],
                  ['fillet', 'Fillet', 'fillet'],
                  ['offset', 'Offset', 'offset'],
                  // The ON-CANVAS dimension tool (P2.7). The Dimension group's
                  // own Dim / R / diameter buttons are a different thing and
                  // are left exactly as they were: they open the ribbon box on
                  // the current selection. This one arms a tool.
                  ['dim', 'Dim', 'dim'],
                ] as Array<[Tool, string, string]>
              ).map(([t, label, icon]) => (
                <button
                  key={t}
                  className="sk2d-tool"
                  aria-pressed={tool === t}
                  title={t === 'dim' ? 'Dimension (D): click an entity, place the label, type the value' : TOOL_TITLE[t] ?? label}
                  onClick={() => setTool(t)}
                >
                  <SkIcon n={icon} />
                  <span className="sk-sr">{label}</span>
                </button>
              ))}
            </div>
            <span className="model-tool-group-label">Draw</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" disabled={!canHoriz} title="Horizontal" onClick={() => applyRule({ k: 'horizontal', a: selShapes[0].id })}>
                <SkIcon n="horizontal" /><span className="sk-sr">Horizontal</span>
              </button>
              <button className="sk2d-tool" disabled={!canVert} title="Vertical" onClick={() => applyRule({ k: 'vertical', a: selShapes[0].id })}>
                <SkIcon n="vertical" /><span className="sk-sr">Vertical</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canCoin}
                title="Coincident"
                onClick={() => {
                  const [a, b] = selPoints as [Sel, Sel];
                  applyRule({ k: 'coincident', a: a.id, aEnd: a.at!, b: b.id, bEnd: b.at! });
                }}
              >
                <SkIcon n="coincident" /><span className="sk-sr">Coincident</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canParallel}
                title="Parallel"
                onClick={() => {
                  const [a, b] = selShapes as [Sel, Sel];
                  applyRule({ k: 'parallel', a: a.id, b: b.id });
                }}
              >
                <SkIcon n="parallel" /><span className="sk-sr">Parallel</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canEqual}
                title="Equal"
                onClick={() => {
                  const [a, b] = selShapes as [Sel, Sel];
                  applyRule({ k: 'equal', a: a.id, b: b.id });
                }}
              >
                <SkIcon n="equal" /><span className="sk-sr">Equal</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canPerp}
                title="Perpendicular"
                onClick={() => {
                  const [a, b] = selShapes as [Sel, Sel];
                  applyRule({ k: 'perpendicular', a: a.id, b: b.id });
                }}
              >
                <SkIcon n="perpendicular" /><span className="sk-sr">Perpendicular</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canTangent}
                title="Tangent"
                onClick={() => {
                  const [a, b] = selShapes as [Sel, Sel];
                  applyRule({ k: 'tangent', a: a.id, b: b.id });
                }}
              >
                <SkIcon n="tangent" /><span className="sk-sr">Tangent</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canPointOnObject}
                title="Point on object"
                onClick={() => {
                  const [p] = selPoints as [Sel];
                  const [s] = selShapes as [Sel];
                  applyRule({ k: 'pointOnObject', a: p.id, aEnd: p.at!, b: s.id });
                }}
              >
                <SkIcon n="pointOnObject" /><span className="sk-sr">On Object</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canSymmetric}
                title="Symmetric about the third selected point"
                onClick={() => {
                  const [a, b, c] = selPoints as [Sel, Sel, Sel];
                  applyRule({ k: 'symmetric', a: a.id, aEnd: a.at!, b: b.id, bEnd: b.at!, c: c.id, cEnd: c.at! });
                }}
              >
                <SkIcon n="symmetric" /><span className="sk-sr">Symmetric</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={!canLock}
                title="Lock this point: horizontal and vertical distance from the origin"
                onClick={lockPoint}
              >
                <SkIcon n="lock" /><span className="sk-sr">Lock</span>
              </button>
              <button
                className="sk2d-tool"
                data-testid="sketch-block"
                disabled={!canBlock}
                title="Block: pin the selected edges where they are"
                onClick={blockSelection}
              >
                <SkIcon n="block" /><span className="sk-sr">Block</span>
              </button>
            </div>
            <span className="model-tool-group-label">Constrain</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" disabled={!canDimLine} title="Distance of the selected line" onClick={() => openDim('distance')}>
                <SkIcon n="dim" /><span className="sk-sr">Dim</span>
              </button>
              <button className="sk2d-tool" disabled={!canDimRadius} title="Radius" onClick={() => openDim('radius')}>
                <SkIcon n="radius" /><span className="sk-sr">R</span>
              </button>
              <button className="sk2d-tool" disabled={!canDimDiameter} title="Diameter" onClick={() => openDim('diameter')}>
                <SkIcon n="diameter" /><span className="sk-sr">Diameter</span>
              </button>
              <button
                className="sk2d-tool"
                data-testid="sketch-reference"
                aria-pressed={refMode}
                title="Reference dimension: pick a placed dimension to stop it driving, or switch the next one to a measurement"
                onClick={toggleReference}
              >
                <SkIcon n="reference" /><span className="sk-sr">Reference</span>
              </button>
              {dim && (
                <span className="sk2d-dim">
                  <input
                    ref={focusAndSelect}
                    value={dim.value}
                    onChange={(e) => setDim({ ...dim, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitDim();
                      if (e.key === 'Escape') setDim(null);
                    }}
                    size={6}
                  />
                  <button className="sk2d-tool" onClick={commitDim}>✓</button>
                  <button className="sk2d-tool" onClick={() => setDim(null)}>✕</button>
                </span>
              )}
            </div>
            <span className="model-tool-group-label">Dimension</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" disabled={sel.length === 0} title="Delete the selection" onClick={onDeleteClick}>
                <SkIcon n="trash" /><span className="sk-sr">Delete</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Toggle construction geometry (dashed; solved but never profiled)"
                onClick={onConstrClick}
              >
                <SkIcon n="construction" /><span className="sk-sr">Constr</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Mirror the selected rows about the Y axis (x -> -x)"
                onClick={() => onMirror('y')}
              >
                <SkIcon n="mirror" /><span className="sk-sr">Mirror</span>
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Copy the selected rows, shifted 10mm right"
                onClick={() => onCopy(10, 0)}
              >
                <SkIcon n="copy" /><span className="sk-sr">Copy</span>
              </button>
              <button className="sk2d-tool" title="Fit the sketch in the view (Shift+F)" onClick={fit}>
                <SkIcon n="fit" /><span className="sk-sr">Fit</span>
              </button>
            </div>
            <span className="model-tool-group-label">Modify</span>
          </div>
        </div>,
        ribbonHost
      )}
      {taskHost && createPortal(
        <section className="sk-task" data-sketch-task="true">
          <header className="sk-task-head">
            <SkIcon n="sketch" />
            <span>Sketch edit</span>
          </header>
          <div className={`sk-task-status sk-st-${solverMsg.tone}`} data-solver-state={solverMsg.state}>
            <span className="sk-task-state">{solverMsg.label}</span>
            {solverMsg.detail ? <span className="sk-task-detail">{solverMsg.state === 'under' ? ': ' : ' - '}{solverMsg.detail}</span> : null}
            {solverMsg.ids.length > 0 && (
              <span className="sk-task-ids">
                {'('}
                {solverMsg.ids.map((n, j) => (
                  <span key={n}>
                    <button type="button" className="sk-task-id" onClick={() => setSelRule(n - 1)}>{n}</button>
                    {j < solverMsg.ids.length - 1 ? ', ' : ''}
                  </span>
                ))}
                {')'}
              </span>
            )}
            {status && <div className="sk-task-note">{status}</div>}
            {stale && !autoUpdate && (
              <div className="sk-task-note" data-testid="sketch-task-stale">Auto update is off: press Refresh to solve again</div>
            )}
            {autoNote && autoNote.len === rules.length && <div className="sk-task-note" data-testid="sketch-task-autonote">{autoNote.text}</div>}
          </div>
          <div className="sk-task-body">
          <div className="sk-task-opts">
            <label title="Draw the constraint marks on the canvas">
              <input type="checkbox" checked={showConstraints} onChange={(e) => setShowConstraints(e.target.checked)} /> Show marks
            </label>
            <label title="Add a horizontal or vertical constraint as a line is drawn near an axis">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
            </label>
            <button
              type="button"
              className="sk-task-refresh"
              data-testid="sketch-task-refresh"
              title="Solve the sketch again from its current rows"
              onClick={() => {
                setAutoNote(null);
                setSolveTick((t) => t + 1);
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="sk-task-gear"
              data-testid="sketch-task-settings"
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              title="Solver settings"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <svg className="sk-ico" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                <circle cx="10" cy="10" r="3" />
                <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
              </svg>
              <span className="sk-sr">Solver settings</span>
            </button>
          </div>
          {settingsOpen && (
            <div className="sk-task-menu" role="menu" data-testid="sketch-task-settings-menu">
              <label role="menuitemcheckbox" aria-checked={autoUpdate} title="Solve after every edit; off keeps edits pending until Refresh">
                <input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} /> Auto update
              </label>
              <label role="menuitemcheckbox" aria-checked={autoRemoveRedundant} title="Drop the newest constraint the solver calls redundant">
                <input type="checkbox" checked={autoRemoveRedundant} onChange={(e) => setAutoRemoveRedundant(e.target.checked)} /> Auto remove redundants
              </label>
              <label role="menuitemcheckbox" aria-checked={showCoincident} title="Draw a mark at every welded point, not only on hover">
                <input type="checkbox" checked={showCoincident} onChange={(e) => setShowCoincident(e.target.checked)} /> Show coincident marks
              </label>
            </div>
          )}
          <div className="sk-task-sec" data-sec="constraints">
          <div className="sk-task-sect">
            <span>Constraints</span>
            <button
              type="button"
              className="sk-task-eye"
              data-testid="sketch-task-toggle-constraints"
              disabled={rules.length === 0}
              aria-pressed={hiddenRules.size === 0}
              title={hiddenRules.size === 0 ? 'Hide every constraint on the sketch' : 'Show every constraint on the sketch'}
              onClick={() => setHiddenRules(hiddenRules.size === 0 ? new Set(rules.map((_, j) => j)) : new Set())}
            >
              <EyeIcon off={hiddenRules.size > 0} />
              <span className="sk-sr">{hiddenRules.size === 0 ? 'Hide all constraints' : 'Show all constraints'}</span>
            </button>
            <span className="sk-task-count">{rules.length}</span>
          </div>
          <div className="sk-task-filter">
            <label>
              <span>Filter</span>
              <select
                data-testid="sketch-task-filter"
                value={ruleFilter}
                onChange={(e) => setRuleFilter(e.target.value as typeof ruleFilter)}
              >
                <option value="all">All</option>
                <option value="dimensional">Dimensional</option>
                <option value="geometric">Geometric</option>
                <option value="problems">Conflicts and redundant</option>
              </select>
            </label>
          </div>
          <ul className="sk-task-list" data-list="constraints">
            {rules.length === 0 && <li className="sk-task-empty">No constraints yet</li>}
            {rules.map((r, i) => {
              const rr = r as unknown as Record<string, any>;
              const dimmed = isDimensionRule(r.k);
              const stateC = ruleStateCls(i).trim();
              if (ruleFilter === 'dimensional' && !dimmed) return null;
              if (ruleFilter === 'geometric' && dimmed) return null;
              if (ruleFilter === 'problems' && !stateC) return null;
              return (
                <li
                  key={i}
                  data-rule-row={i}
                  className={`sk-task-row${selRule === i ? ' is-sel' : ''}${hoverRule === i ? ' is-hover' : ''}${stateC ? ' ' + stateC : ''}`}
                  onPointerEnter={() => setHoverRule(i)}
                  onPointerLeave={() => setHoverRule((h) => (h === i ? null : h))}
                  onClick={() => {
                    setSelRule(i);
                    setSel([]);
                  }}
                >
                  <input
                    type="checkbox"
                    className="sk-task-vis"
                    title="Show this constraint on the sketch"
                    aria-label={`Show constraint ${i + 1}`}
                    checked={!hiddenRules.has(i)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setHiddenRules((h) => {
                        const n = new Set(h);
                        if (e.target.checked) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                  />
                  <svg className="sk-task-ico" viewBox="0 0 20 20" aria-hidden="true">
                    {dimmed ? <SkIconBody n={r.k === 'radius' ? 'radius' : r.k === 'diameter' ? 'diameter' : 'dim'} /> : <SkIconBody n={r.k} />}
                  </svg>
                  <span className="sk-task-name">{i + 1} {ruleName(r.k)}</span>
                  {dimmed && <span className="sk-task-val">{formatDim(Number(rr.value ?? 0))}{dimUnit(String(r.k))}</span>}
                  <button
                    type="button"
                    className="sk-task-del"
                    title="Remove this constraint"
                    aria-label={`Remove constraint ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRuleAt(i);
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          </div>
          <div className="sk-task-sec" data-sec="elements">
          <div className="sk-task-sect">
            <span>Elements</span>
            <button
              type="button"
              className="sk-task-eye"
              data-testid="sketch-task-toggle-elements"
              disabled={solved.length === 0}
              aria-pressed={hiddenGeoms.size === 0}
              title={hiddenGeoms.size === 0 ? 'Hide every element' : 'Show every element'}
              onClick={() => setHiddenGeoms(hiddenGeoms.size === 0 ? new Set(solved.map((g) => g.id)) : new Set())}
            >
              <EyeIcon off={hiddenGeoms.size > 0} />
              <span className="sk-sr">{hiddenGeoms.size === 0 ? 'Hide all elements' : 'Show all elements'}</span>
            </button>
            <span className="sk-task-count">{solved.length}</span>
          </div>
          <ul className="sk-task-list" data-list="elements">
            {solved.length === 0 && <li className="sk-task-empty">Nothing drawn yet</li>}
            {solved.map((g) => {
              const picked = isSel(g.id, null);
              const st = blamed.get(g.id) ?? (fullIds.has(g.id) ? 'full' : 'free');
              return (
                <li
                  key={g.id}
                  data-geom-row={g.id}
                  className={`sk-task-row${picked ? ' is-sel' : ''} sk-el-${st}`}
                  onClick={() => {
                    setSelRule(null);
                    setSel([{ id: g.id, at: null } as Sel]);
                  }}
                >
                  <input
                    type="checkbox"
                    className="sk-task-vis"
                    title="Show this element on the sketch"
                    aria-label={`Show element ${g.id}`}
                    checked={!hiddenGeoms.has(g.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setHiddenGeoms((h) => {
                        const n = new Set(h);
                        if (e.target.checked) n.delete(g.id);
                        else n.add(g.id);
                        return n;
                      })
                    }
                  />
                  <svg className="sk-task-ico" viewBox="0 0 20 20" aria-hidden="true">
                    <SkIconBody n={g.k === 'point' ? 'point' : g.k} />
                  </svg>
                  <span className="sk-task-name">{g.id} {geomName(g.k)}{g.construction ? ' (construction)' : ''}</span>
                  <span className="sk-task-modes" role="group" aria-label={`Select part of element ${g.id}`}>
                    {g.k !== 'point' && (
                      <button
                        type="button"
                        className={`sk-task-mode${isSel(g.id, null) ? ' is-on' : ''}`}
                        data-mode="edge"
                        title={g.k === 'line' ? 'Select the whole line' : 'Select the whole curve'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelRule(null);
                          setSel([{ id: g.id, at: null } as Sel]);
                        }}
                      >
                        <ModeIcon n="edge" />
                      </button>
                    )}
                    {namedPointsOf(g as CoreGeom).map(({ at }) => {
                      const mode = g.k === 'point' ? 'point' : at === 'c' ? 'center' : at === 'a' ? 'start' : 'end';
                      return (
                        <button
                          key={at}
                          type="button"
                          className={`sk-task-mode${isSel(g.id, at) ? ' is-on' : ''}`}
                          data-mode={mode}
                          title={
                            mode === 'point' ? 'Select this point'
                              : mode === 'center' ? 'Select the centre point'
                                : mode === 'start' ? 'Select the start point' : 'Select the end point'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelRule(null);
                            setSel([{ id: g.id, at } as Sel]);
                          }}
                        >
                          <ModeIcon n={mode} />
                        </button>
                      );
                    })}
                  </span>
                  <span className="sk-task-flag" title={st === 'full' ? 'Fully constrained' : st === 'free' ? 'Can still move' : 'In conflict'}>
                    {st === 'full' ? 'fixed' : st === 'free' ? 'free' : st}
                  </span>
                </li>
              );
            })}
          </ul>
          </div>
          </div>
          <footer className="sk-task-foot">
            <button type="button" className="sk-task-btn is-primary" data-testid="sketch-task-ok" onClick={() => onExit?.()}>OK</button>
            <button
              type="button"
              className="sk-task-btn"
              data-testid="sketch-task-cancel"
              title="Leave the sketcher and drop every change made since it opened"
              onClick={cancelSketch}
            >
              Cancel
            </button>
          </footer>
        </section>,
        taskHost
      )}
      <svg
        ref={svgRef}
        className="sk2d-svg"
        data-tool={tool}
        style={{ cursor: TOOL_CURSOR[tool] }}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onClick={(e) => {
          // A drag-to-create gesture already committed on pointerup; the
          // click the browser fires after it must not ALSO open a
          // click-click flow on the same spot.
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          // A click that reaches the canvas is a click BESIDE every glyph --
          // a glyph stops its own -- so it drops the picked constraint.
          if (selRule !== null) setSelRule(null);
          if (tool === 'line') onLineClick(e);
          else if (tool === 'select') onSelectClick(e);
          else if (tool === 'rect') onRectClick(e);
          else if (tool === 'circle') onCircleClick(e);
          else if (tool === 'arc') onArcClick(e);
          else if (tool === 'slot') onSlotClick(e);
          else if (tool === 'trim') onTrimClick(e);
          else if (tool === 'fillet') onFilletClick(e);
          else if (tool === 'offset') onOffsetClick(e);
          else if (tool === 'dim') onDimClick(e);
        }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          // The classify-and-dispatch lives in onPointerUp (below), which
          // has the pointer's REAL up-sample; the browser fires contextmenu
          // BEFORE pointerup and BEFORE any drag's moves (measured
          // 2026-09-21: Chromium fires it at press time, coords = the DOWN
          // point), so a classifier on this event reads a 0px/0ms gesture
          // and opens the menu on ANY drag. This handler kills the native
          // menu — always — and opens the menu when onPointerUp armed it.
          // Only when the active scheme pans with the right button; any
          // other scheme leaves the browser menu alone (Phase 4 owns the
          // real one).
          if (rightButtonRole(schemeToMouseButtons(loadSchemeName())) === 'none') return;
          e.preventDefault();
          if (!rightMenuArmedRef.current) return;
          rightMenuArmedRef.current = false;
          const rect = e.currentTarget.getBoundingClientRect();
          setMarkingMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onDoubleClick={() => {
          setChain(null);
          setClicks([]);
        }}
      >
        <g className="sk2d-grid">{gridNodes(view, size)}</g>
        <g className="sk2d-dimart">{dimArtNodes}{refNodes}</g>
        <g className="sk2d-geom">{shapes}</g>
        <g className="sk2d-preview">{preview}</g>
        {marquee && marqueeNow && (
          <rect
            className={`sk-marquee sk-marquee-${marqueeNow}`}
            data-marquee={marqueeNow}
            x={Math.min(marquee.from.x, marquee.to.x)}
            y={-Math.max(marquee.from.y, marquee.to.y)}
            width={Math.abs(marquee.to.x - marquee.from.x)}
            height={Math.abs(marquee.to.y - marquee.from.y)}
          />
        )}
        {/* The constraint layer sits ABOVE the geometry: a glyph is small and
            must not hide under the line it describes. */}
        <g className="sk2d-rules">{ruleNodes}</g>
        {hoverSnap && snapGlyph(hoverSnap, mmPerPx)}
      </svg>
      {/* The dimension chips are HTML over the svg, not inside it: native
          focus order is what makes Tab walk from one to the next, and an
          input that is not a descendant of the canvas cannot leak a
          pointerdown into the gesture it belongs to. */}
      <div className="sk2d-dims">{dimChips}</div>
      {markingMenu && (
        <MarkingMenu
          x={markingMenu.x}
          y={markingMenu.y}
          mode="sketch"
          selection={markingMenuSelection}
          onCommand={(id) => {
            setMarkingMenu(null);
            dispatchMarkingMenuCommand(id);
          }}
          onClose={() => setMarkingMenu(null)}
        />
      )}
    </div>
  );
}

// --- module helpers --------------------------------------------------------------------

// --- toolbar and list icons ----------------------------------------------------------
// Own drawings on a 20x20 grid, stroke only, painted through currentColor so
// the button (or list row) decides the colour. Nothing here is borrowed from
// another CAD program's icon set.

const TOOL_TITLE: Partial<Record<Tool, string>> = {
  select: 'Select (S): pick, box-select and drag geometry',
  line: 'Line (L): click points to chain segments, double-click to finish',
  rect: 'Rectangle (R): two corners, welded and held horizontal and vertical',
  circle: 'Circle (C): centre, then a point on the rim',
  arc: 'Arc (A): two end points, then a point on the arc',
  slot: 'Slot: two cap centres, then the width',
  trim: 'Trim: click the piece of a line to cut away',
  fillet: 'Fillet: click a corner, type the radius',
  offset: 'Offset: pick a chain, type the distance',
};

/** Stable ref callback for a value box that opens ready to be typed over:
 *  focus it and select the whole value on mount (a stable identity, so React
 *  calls it once, not on every render). */
function focusAndSelect(el: HTMLInputElement | null): void {
  if (!el) return;
  el.focus();
  el.select();
  el.dataset.fresh = '1';
}

function SkIconBody({ n }: { n: string }): React.ReactElement | null {
  switch (n) {
    case 'select':
      return <path d="M5 3 V15 L8.4 12 L10.8 17 L13 16 L10.7 11.2 H15.2 Z" />;
    case 'line':
      return (
        <>
          <path d="M4 15 L10 5 L16 11" />
          <circle className="sk-ico-dot" cx="4" cy="15" r="1.4" />
          <circle className="sk-ico-dot" cx="10" cy="5" r="1.4" />
          <circle className="sk-ico-dot" cx="16" cy="11" r="1.4" />
        </>
      );
    case 'rect':
      return (
        <>
          <rect x="4" y="5.5" width="12" height="9" />
          <circle className="sk-ico-dot" cx="4" cy="5.5" r="1.3" />
          <circle className="sk-ico-dot" cx="16" cy="14.5" r="1.3" />
        </>
      );
    case 'circle':
      return (
        <>
          <circle cx="10" cy="10" r="6" />
          <circle className="sk-ico-dot" cx="10" cy="10" r="1.3" />
        </>
      );
    case 'arc':
      return (
        <>
          <path d="M4 14 A7.5 7.5 0 0 1 16 14" />
          <circle className="sk-ico-dot" cx="4" cy="14" r="1.3" />
          <circle className="sk-ico-dot" cx="16" cy="14" r="1.3" />
        </>
      );
    case 'slot':
      return <path d="M7 5.5 H13 A4.5 4.5 0 0 1 13 14.5 H7 A4.5 4.5 0 0 1 7 5.5 Z" />;
    case 'trim':
      return (
        <>
          <path d="M3 14 H17" />
          <path d="M10 3 V9" />
          <path d="M7 7 L13 13 M13 7 L7 13" className="sk-ico-thin" />
        </>
      );
    case 'fillet':
      return (
        <>
          <path d="M5 16 V9 Q5 5 9 5 H16" />
          <path d="M5 16 V14 M12 5 H16" className="sk-ico-thin" />
        </>
      );
    case 'offset':
      return (
        <>
          <path d="M4 16 V4 H16" />
          <path d="M8.5 16 V8.5 H16" />
        </>
      );
    case 'dim':
    case 'distance':
    case 'distanceX':
    case 'distanceY':
      return (
        <>
          <path d="M4 4 V16 M16 4 V16 M4 10 H16" />
          <path d="M4 10 L7.2 8.2 M4 10 L7.2 11.8 M16 10 L12.8 8.2 M16 10 L12.8 11.8" />
        </>
      );
    case 'radius':
      return (
        <>
          <circle cx="9" cy="11" r="6" />
          <path d="M9 11 L14.2 7.2 M14.2 7.2 L11.6 7.6 M14.2 7.2 L13.8 9.8" />
        </>
      );
    case 'diameter':
      return (
        <>
          <circle cx="10" cy="10" r="6.5" />
          <path d="M5.4 14.6 L14.6 5.4 M5.4 14.6 L6.2 12 M5.4 14.6 L8 13.8 M14.6 5.4 L12 6.2 M14.6 5.4 L13.8 8" />
        </>
      );
    case 'angle':
      return <path d="M4 16 H16 M4 16 L13 6 M9 16 A5 5 0 0 0 7.6 12.4" />;
    case 'horizontal':
      return <path d="M3.5 10 H16.5 M3.5 7 V13 M16.5 7 V13" />;
    case 'vertical':
      return <path d="M10 3.5 V16.5 M7 3.5 H13 M7 16.5 H13" />;
    case 'coincident':
      return (
        <>
          <circle cx="10" cy="10" r="6" />
          <circle className="sk-ico-dot" cx="10" cy="10" r="2.2" />
        </>
      );
    case 'pointOnObject':
      return (
        <>
          <path d="M3.5 14.5 H16.5" />
          <circle className="sk-ico-dot" cx="10" cy="9" r="2.4" />
          <path d="M10 11.5 V14.5" />
        </>
      );
    case 'parallel':
      return <path d="M7 16 L11.5 4 M12 16 L16.5 4" />;
    case 'perpendicular':
      return <path d="M5 4 V15 H16" />;
    case 'tangent':
      return (
        <>
          <circle cx="10" cy="8" r="4.5" />
          <path d="M3 15 H17" />
        </>
      );
    case 'equal':
      return <path d="M4 7.5 H16 M4 12.5 H16" />;
    case 'symmetric':
      return (
        <>
          <path d="M10 3 V17" className="sk-ico-dash" />
          <path className="sk-ico-fill" d="M3.5 10 L8 6.5 V13.5 Z M16.5 10 L12 6.5 V13.5 Z" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="9" width="10" height="7.5" rx="1" />
          <path d="M7.5 9 V6.8 A2.5 2.5 0 0 1 12.5 6.8 V9" />
        </>
      );
    case 'block':
      // An edge pinned at both ends by two filled squares.
      return (
        <>
          <path d="M5 15 L15 5" />
          <rect x="3" y="13" width="4" height="4" className="sk-ico-fill" />
          <rect x="13" y="3" width="4" height="4" className="sk-ico-fill" />
        </>
      );
    case 'reference':
      // A dimension line drawn in brackets: measured, not driving.
      return (
        <>
          <path d="M3 5 V15 M17 5 V15 M3 10 H17 M6 7.5 L3 10 L6 12.5 M14 7.5 L17 10 L14 12.5" className="sk-ico-dash" />
        </>
      );
    case 'trash':
      return <path d="M4.5 6 H15.5 M8 6 V4 H12 V6 M6 6 L6.8 16.5 H13.2 L14 6 M9 9 V14 M11 9 V14" />;
    case 'construction':
      return <path d="M3 16 L17 4" className="sk-ico-dash" />;
    case 'mirror':
      return (
        <>
          <path d="M10 3 V17" className="sk-ico-dash" />
          <path d="M8 6 L3.5 15 H8 Z M12 6 L16.5 15 H12 Z" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="3.5" y="7.5" width="9" height="9" />
          <path d="M7.5 7.5 V3.5 H16.5 V12.5 H12.5" />
        </>
      );
    case 'fit':
      return <path d="M3.5 7 V3.5 H7 M13 3.5 H16.5 V7 M16.5 13 V16.5 H13 M7 16.5 H3.5 V13" />;
    case 'point':
      return <circle className="sk-ico-dot" cx="10" cy="10" r="2.4" />;
    case 'sketch':
      return (
        <>
          <path d="M3.5 16.5 L4.2 13 L13.5 3.7 L16.3 6.5 L7 15.8 Z" />
          <path d="M11.8 5.4 L14.6 8.2" />
        </>
      );
    default:
      return <circle cx="10" cy="10" r="4" />;
  }
}

function SkIcon({ n }: { n: string }): React.ReactElement {
  return (
    <svg className="sk-ico" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <SkIconBody n={n} />
    </svg>
  );
}

/** The show/hide-all eye of a list header: open when everything in the list
 *  is drawn, struck through when something is hidden. */
function EyeIcon({ off }: { off: boolean }): React.ReactElement {
  return (
    <svg className="sk-ico" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      <path d="M2 10c2-3.5 5-5.5 8-5.5s6 2 8 5.5c-2 3.5-5 5.5-8 5.5S4 13.5 2 10z" />
      <circle cx="10" cy="10" r="2.4" />
      {off && <path d="M3.5 16.5L16.5 3.5" />}
    </svg>
  );
}

/** One element row's part picker: the whole edge, or one of its points. */
function ModeIcon({ n }: { n: 'edge' | 'start' | 'end' | 'center' | 'point' }): React.ReactElement {
  return (
    <svg className="sk-ico" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      {n === 'edge' && <path d="M3.5 16.5L16.5 3.5" />}
      {n === 'start' && (
        <>
          <path className="sk-ico-thin" d="M3.5 16.5L16.5 3.5" />
          <circle className="sk-ico-dot" cx="3.5" cy="16.5" r="2.6" />
        </>
      )}
      {n === 'end' && (
        <>
          <path className="sk-ico-thin" d="M3.5 16.5L16.5 3.5" />
          <circle className="sk-ico-dot" cx="16.5" cy="3.5" r="2.6" />
        </>
      )}
      {n === 'center' && (
        <>
          <circle className="sk-ico-thin" cx="10" cy="10" r="7" />
          <circle className="sk-ico-dot" cx="10" cy="10" r="2.4" />
        </>
      )}
      {n === 'point' && <circle className="sk-ico-dot" cx="10" cy="10" r="3" />}
    </svg>
  );
}

const svgRef: { current: SVGSVGElement | null } = { current: null };


function geomKind(id: number, geoms: CoreGeom[]): string | null {
  return geoms.find((x) => x.id === id)?.k ?? null;
}

function bothLines(ids: number[], geoms: CoreGeom[]): boolean {
  return ids.every((id) => geomKind(id, geoms) === 'line');
}

/** The obround inscribed in a dragged box: the long axis carries the two cap
 *  centres, the short side is the diameter. A square (or straight) drag holds
 *  no obround -- null, and the caller says so rather than guessing a width. */
function slotFromBox(p0: Pt, p1: Pt): { cA: Pt; cB: Pt; r: number } | null {
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  const r = Math.min(w, h) / 2;
  if (!(r > 1e-9)) return null;
  const midX = Math.min(p0.x, p1.x) + w / 2;
  const midY = Math.min(p0.y, p1.y) + h / 2;
  const half = Math.max(w, h) / 2 - r;
  if (!(half > 1e-9)) return null;
  return w > h
    ? { cA: { x: midX - half, y: midY }, cB: { x: midX + half, y: midY }, r }
    : { cA: { x: midX, y: midY - half }, cB: { x: midX, y: midY + half }, r };
}

/** The slot rubber band: two cap circles and the two tangent sides, the same
 *  four rows slotRows commits. Both the click-click and the drag flow draw
 *  through here so the preview cannot describe a different slot. */
function slotPreview(cA: Pt, cB: Pt, r: number): React.ReactNode {
  if (!(r > 1e-9)) return null;
  const dx = cB.x - cA.x, dy = cB.y - cA.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  const px = (-dy / len) * r, py = (dx / len) * r;
  const p1 = { x: cA.x + px, y: cA.y + py };
  const p2 = { x: cB.x + px, y: cB.y + py };
  const p3 = { x: cB.x - px, y: cB.y - py };
  const p4 = { x: cA.x - px, y: cA.y - py };
  return (
    <>
      <circle className="sk-preview" cx={cA.x} cy={-cA.y} r={r} />
      <circle className="sk-preview" cx={cB.x} cy={-cB.y} r={r} />
      <line className="sk-preview" x1={p1.x} y1={-p1.y} x2={p2.x} y2={-p2.y} />
      <line className="sk-preview" x1={p3.x} y1={-p3.y} x2={p4.x} y2={-p4.y} />
    </>
  );
}

/** The snap marker, one per KIND, at a constant SCREEN size: the world-unit
 *  geometry is scaled by mm-per-px and the stroke held by non-scaling-stroke,
 *  the same pair every other fixed-size mark in this file uses. CAD
 *  convention throughout -- square = endpoint, triangle = midpoint,
 *  circle + crosshair = centre, X = intersection, diamond = on-curve,
 *  dot = grid. */
function snapGlyph(hit: SnapHit, mmPerPx: number): React.ReactNode {
  const x = hit.world.x;
  const y = -hit.world.y; // the file-wide flip
  const h = (SNAP_GLYPH_PX / 2) * mmPerPx;
  const cls = 'sk-snap-glyph';
  // A circle's or arc's centre is one of its NAMED points, so findSnap ranks
  // it as a vertex (rank 1) and never reaches its own centre candidate (rank
  // 2). It is a centre all the same, and the crosshair is what a CAD user
  // reads there -- the marker names the point, not the candidate list it came
  // out of.
  const kind = hit.kind === 'vertex' && hit.at === 'c' ? 'center' : hit.kind;
  switch (kind) {
    case 'vertex':
      return <rect className={cls} data-snap="vertex" x={x - h} y={y - h} width={2 * h} height={2 * h} />;
    case 'midpoint':
      return (
        <polygon className={cls} data-snap="midpoint" points={`${x},${y - h} ${x + h},${y + h} ${x - h},${y + h}`} />
      );
    case 'center':
      return (
        <g className={cls} data-snap="center">
          <circle cx={x} cy={y} r={h * 0.8} />
          <line x1={x - h * 1.5} y1={y} x2={x + h * 1.5} y2={y} />
          <line x1={x} y1={y - h * 1.5} x2={x} y2={y + h * 1.5} />
        </g>
      );
    case 'intersection':
      return (
        <g className={cls} data-snap="intersection">
          <line x1={x - h} y1={y - h} x2={x + h} y2={y + h} />
          <line x1={x - h} y1={y + h} x2={x + h} y2={y - h} />
        </g>
      );
    case 'onCurve':
      return (
        <polygon
          className={cls}
          data-snap="onCurve"
          points={`${x},${y - h} ${x + h},${y} ${x},${y + h} ${x - h},${y}`}
        />
      );
    case 'grid':
      return <circle className={cls} data-snap="grid" cx={x} cy={y} r={h * 0.35} />;
  }
}

/** One icon per CONSTRAINT kind (SPEC-mouse-parity Phase 2 item 8), centred
 *  on (x, y) in SVG coordinates -- the caller has already applied the
 *  file-wide flip -- at half-width `h` world units, which the caller derived
 *  from a screen-pixel constant. Strokes hold their screen width through
 *  non-scaling-stroke, the same pair snapGlyph uses; nothing here reinvents
 *  that.
 *
 *  These are the TEN kinds SoupRule has that carry no `value`. The six that
 *  do -- distance, distanceX, distanceY, radius, diameter, angle -- are drawn
 *  as value chips instead, because a dimension whose number you cannot read
 *  is not a dimension. There is no eleventh icon waiting: `k` is a closed
 *  union of sixteen and this covers the ten. */
function ruleIcon(kind: string, x: number, y: number, h: number): React.ReactNode {
  switch (kind) {
    case 'horizontal':
      // A bar with end ticks, not a bare line: a bare horizontal line beside
      // a horizontal edge is indistinguishable from more edge.
      return (
        <>
          <line x1={x - h} y1={y} x2={x + h} y2={y} />
          <line x1={x - h} y1={y - h * 0.5} x2={x - h} y2={y + h * 0.5} />
          <line x1={x + h} y1={y - h * 0.5} x2={x + h} y2={y + h * 0.5} />
        </>
      );
    case 'vertical':
      return (
        <>
          <line x1={x} y1={y - h} x2={x} y2={y + h} />
          <line x1={x - h * 0.5} y1={y - h} x2={x + h * 0.5} y2={y - h} />
          <line x1={x - h * 0.5} y1={y + h} x2={x + h * 0.5} y2={y + h} />
        </>
      );
    case 'parallel':
      return (
        <>
          <line x1={x - h * 0.55} y1={y + h} x2={x + h * 0.15} y2={y - h} />
          <line x1={x - h * 0.15} y1={y + h} x2={x + h * 0.55} y2={y - h} />
        </>
      );
    case 'perpendicular':
      return <polyline points={`${x - h * 0.6},${y - h} ${x - h * 0.6},${y + h * 0.6} ${x + h},${y + h * 0.6}`} />;
    case 'equal':
      return (
        <>
          <line x1={x - h} y1={y - h * 0.4} x2={x + h} y2={y - h * 0.4} />
          <line x1={x - h} y1={y + h * 0.4} x2={x + h} y2={y + h * 0.4} />
        </>
      );
    case 'coincident':
      // Two rings sharing a centre: the point that is the same point.
      return (
        <>
          <circle cx={x} cy={y} r={h * 0.85} />
          <circle className="sk-rule-dot" cx={x} cy={y} r={h * 0.3} />
        </>
      );
    case 'pointOnObject':
      // A dot sitting ON a line rather than beside it.
      return (
        <>
          <line x1={x - h} y1={y + h * 0.55} x2={x + h} y2={y + h * 0.55} />
          <circle className="sk-rule-dot" cx={x} cy={y - h * 0.15} r={h * 0.32} />
        </>
      );
    case 'tangent':
      // A circle and the line that grazes it.
      return (
        <>
          <circle cx={x} cy={y - h * 0.2} r={h * 0.6} />
          <line x1={x - h} y1={y + h * 0.5} x2={x + h} y2={y + h * 0.5} />
        </>
      );
    case 'symmetric':
      // Two arrowheads facing the mirror between them.
      return (
        <>
          <line className="sk-rule-mirror" x1={x} y1={y - h} x2={x} y2={y + h} />
          <polygon className="sk-rule-dot" points={`${x - h},${y - h * 0.45} ${x - h},${y + h * 0.45} ${x - h * 0.35},${y}`} />
          <polygon className="sk-rule-dot" points={`${x + h},${y - h * 0.45} ${x + h},${y + h * 0.45} ${x + h * 0.35},${y}`} />
        </>
      );
    case 'lock':
      // A padlock: the shackle over the body.
      return (
        <>
          <path d={`M ${x - h * 0.45} ${y} L ${x - h * 0.45} ${y - h * 0.5} A ${h * 0.45} ${h * 0.45} 0 0 1 ${x + h * 0.45} ${y - h * 0.5} L ${x + h * 0.45} ${y}`} />
          <rect x={x - h * 0.75} y={y} width={h * 1.5} height={h * 0.9} />
        </>
      );
  }
  return null;
}

/** The 1-2-5 step whose screen spacing first clears GRID_MIN_PX. A fixed
 *  10mm step (what this drew when the viewBox was fixed) fills solid two
 *  zoom notches out and vanishes two notches in. */
function gridStepMm(pxPerMm: number): number {
  const want = GRID_MIN_PX / pxPerMm;
  const pow = Math.pow(10, Math.floor(Math.log10(want)));
  for (const m of [1, 2, 5]) {
    if (pow * m >= want) return pow * m;
  }
  return pow * 10;
}

/** Grid + axes for the CURRENT view: only the lines the frame can show, and
 *  never more than GRID_MAX_LINES of them. */
function gridNodes(view: SketchView, size: SizePx): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  if (!(size.width > 0) || !(size.height > 0) || !(view.pxPerMm > 0)) return nodes;
  const halfW = size.width / view.pxPerMm / 2;
  const halfH = size.height / view.pxPerMm / 2;
  const x0 = view.cx - halfW, x1 = view.cx + halfW;
  const y0 = view.cy - halfH, y1 = view.cy + halfH;
  const step = gridStepMm(view.pxPerMm);
  let drawn = 0;
  for (let x = Math.ceil(x0 / step) * step; x <= x1 && drawn < GRID_MAX_LINES; x += step, drawn++) {
    if (Math.abs(x) < step / 2) continue; // the Y axis draws this one
    nodes.push(<line key={`v${Math.round(x / step)}`} className="sk-grid" x1={x} y1={-y0} x2={x} y2={-y1} />);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1 && drawn < GRID_MAX_LINES; y += step, drawn++) {
    if (Math.abs(y) < step / 2) continue; // the X axis draws this one
    nodes.push(<line key={`h${Math.round(y / step)}`} className="sk-grid" x1={x0} y1={-y} x2={x1} y2={-y} />);
  }
  nodes.push(<line key="ax" className="sk-axis-x" x1={x0} y1={0} x2={x1} y2={0} />);
  nodes.push(<line key="ay" className="sk-axis-y" x1={0} y1={-y0} x2={0} y2={-y1} />);
  nodes.push(<circle key="o" className="sk-origin" cx={0} cy={0} r={ORIGIN_R_PX / view.pxPerMm} />);
  return nodes;
}

const SK2D_CSS = `
.sk2d-host { position: absolute; inset: 0; background: var(--reshape-bg, #282a36); }
/* Docked in the ribbon (see ribbonHost above), so these match the ribbon's
   own button language rather than the standalone-floating-bar padding this
   toolbar used before. */
.sk2d-tool { height: 28px; padding: 0 8px; border-radius: 3px; border: 1px solid transparent;
  background: transparent; color: #d3d5e3; cursor: pointer;
  font-size: 12px; font-family: var(--reshape-font-ui); }
.sk2d-tool:hover:not(:disabled) { background: #3d4051; border-color: #565a70; color: var(--reshape-text); }
.sk2d-tool:disabled { opacity: 0.35; cursor: not-allowed; }
.sk2d-tool[aria-pressed="true"] { background: var(--reshape-border); border-color: var(--reshape-accent-2); color: var(--reshape-text); }
.sk2d-auto { display: flex; align-items: center; gap: 3px; font-size: 12px; color: var(--reshape-text-muted, #6272a4); }
.sk-dof { font-family: var(--reshape-font-mono, monospace); font-size: 12px; padding: 1px 8px;
  border-radius: 999px; border: 1px solid var(--reshape-border, #44475a); }
.sk-dof-ok { color: var(--reshape-success, #50fa7b); border-color: var(--reshape-success, #50fa7b); }
.sk-dof-warn { color: var(--reshape-warn, #ffb86c); border-color: var(--reshape-warn, #ffb86c); }
.sk-dof-bad { color: var(--reshape-danger, #ff5555); border-color: var(--reshape-danger, #ff5555); }
.sk2d-dim { display: flex; gap: 3px; align-items: center; }
.sk2d-dim input { background: var(--reshape-surface, #1e1f29); color: var(--reshape-text);
  border: 1px solid var(--reshape-accent, #8be9fd); border-radius: var(--reshape-radius, 4px);
  padding: 2px 6px; font-family: var(--reshape-font-mono, monospace); }
.sk2d-status { color: var(--reshape-warn, #ffb86c); font-size: 12px; }
/* No cursor here: it is per-tool (TOOL_CURSOR), set inline from the active
   tool, so the canvas itself says which tool is armed. */
.sk2d-svg { width: 100%; height: 100%; touch-action: none; }
/* Stroke widths are SCREEN pixels via non-scaling-stroke: with a live
   pxPerMm a world-unit stroke is a hairline zoomed out and a slab zoomed
   in. Dash patterns ride the same space, hence the px-scale dasharrays. */
.sk-grid { stroke: var(--reshape-text, #f8f8f2); stroke-width: 1; opacity: 0.18; vector-effect: non-scaling-stroke; }
.sk-axis-x { stroke: #e0685a; stroke-width: 1.25; opacity: 0.85; vector-effect: non-scaling-stroke; }
.sk-axis-y { stroke: #5fbf8f; stroke-width: 1.25; opacity: 0.85; vector-effect: non-scaling-stroke; }
.sk-origin { fill: var(--reshape-accent, #8be9fd); }
.sk-line, .sk-circle, .sk-arc, polyline { fill: none; }
.sk-shape { stroke: var(--reshape-text, #f8f8f2); stroke-width: 1.6; fill: none; vector-effect: non-scaling-stroke; }
.sk-constr { stroke-dasharray: 5 4; opacity: 0.6; }
.sk-shape-sel { stroke: var(--reshape-pink, #ff79c6) !important; }
.sk-vertex { fill: var(--reshape-text, #f8f8f2); }
.sk-vertex-sel { fill: var(--reshape-pink, #ff79c6); }
.sk-snap-glyph, .sk-snap-glyph > * { fill: none; stroke: var(--reshape-accent, #8be9fd); stroke-width: 1.5;
  vector-effect: non-scaling-stroke; pointer-events: none; }
.sk-snap-glyph[data-snap="grid"] { fill: var(--reshape-accent, #8be9fd); }
/* The two marquees have to be told apart mid-drag, before the button comes
   up: long blue dashes for WINDOW (left-to-right, fully inside only), short
   green dashes for CROSSING (right-to-left, touched counts). Both colours are
   existing --reshape-* tokens (notes.ts's rule -- no new palette entries), and
   non-scaling-stroke keeps the dash pattern in screen pixels through zoom. */
.sk-marquee { stroke-width: 1.2; fill-opacity: 0.1; pointer-events: none; vector-effect: non-scaling-stroke; }
.sk-marquee-window { stroke: var(--reshape-accent, #8be9fd); fill: var(--reshape-accent, #8be9fd); stroke-dasharray: 9 4; }
.sk-marquee-crossing { stroke: var(--reshape-success, #50fa7b); fill: var(--reshape-success, #50fa7b); stroke-dasharray: 3 3; }
.sk-rubber { stroke: var(--reshape-accent, #8be9fd); stroke-width: 1.4; stroke-dasharray: 5 4; fill: none; vector-effect: non-scaling-stroke; }
.sk-preview { stroke: var(--reshape-accent, #8be9fd); stroke-width: 1.4; fill: none; opacity: 0.8; vector-effect: non-scaling-stroke; }
.sk-axis-hint { fill: var(--reshape-accent, #8be9fd); }
.sk-dim-ghost { fill: var(--reshape-accent-2, #bd93f9); font-family: var(--reshape-font-mono, monospace); pointer-events: none; }
/* Constraint glyphs (SPEC-mouse-parity Phase 2 item 8). Same pair as every
   other fixed-size mark here: the geometry is world units scaled by
   mm-per-px, the stroke is held in screen pixels by non-scaling-stroke. The
   hit circle is invisible but pointer-events: all, so the catch area is a
   comfortable radius rather than the 1px strokes themselves. */
.sk-rule-glyph { cursor: pointer; }
/* The icon's shapes are painted through .sk-rule-icon's CHILDREN, never
   through bare element selectors on the group: ".sk-rule-glyph circle" beats
   a plain ".sk-rule-hit" on specificity (0,1,1 vs 0,1,0), which drew a
   visible ring around every icon out of the two invisible circles behind it.
   Caught in the P2.8 smoke screenshot. */
.sk-rule-icon > * { fill: none; stroke: var(--reshape-accent-2, #bd93f9); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
.sk-rule-icon > .sk-rule-dot { fill: var(--reshape-accent-2, #bd93f9); stroke: none; }
.sk-rule-icon > .sk-rule-mirror { stroke-dasharray: 3 2; }
.sk-rule-hit { fill: none; stroke: none; pointer-events: all; }
.sk-rule-bg { fill: none; stroke: none; }
.sk-rule-glyph.sk-rule-hover .sk-rule-bg { fill: var(--reshape-accent-2, #bd93f9); fill-opacity: 0.18; }
.sk-rule-glyph.sk-rule-sel .sk-rule-bg { fill: var(--reshape-pink, #ff79c6); fill-opacity: 0.25; }
/* Selected reads PINK, the same colour a selected shape or vertex already
   wears here -- one selection language, not a second one for constraints. */
.sk-rule-glyph.sk-rule-sel .sk-rule-icon > * { stroke: var(--reshape-pink, #ff79c6); }
.sk-rule-glyph.sk-rule-sel .sk-rule-icon > .sk-rule-dot { fill: var(--reshape-pink, #ff79c6); stroke: none; }
/* The dimension value chips (SPEC-mouse-parity Phase 2 item 7): an HTML layer
   over the svg. The layer itself is transparent to the pointer so the canvas
   underneath keeps every click; only the chips themselves catch one. A chip
   is a flat label at rest and grows its box once focused, which is what
   "the input reopens" looks like. */
.sk2d-dims { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sk2d-dim-chip { position: absolute; transform: translate(-50%, -50%); pointer-events: auto;
  min-width: 2.5em; text-align: center; padding: 1px 4px; border-radius: 3px;
  border: 1px solid transparent; background: var(--reshape-bg, #282a36); color: var(--reshape-accent-2, #bd93f9);
  font-family: var(--reshape-font-mono, monospace); font-size: 12px; cursor: text; }
.sk2d-dim-chip.sk-rule-hover { border-color: var(--reshape-accent-2, #bd93f9); }
.sk2d-dim-chip.sk-rule-sel { border-color: var(--reshape-pink, #ff79c6); color: var(--reshape-pink, #ff79c6); }
.sk2d-dim-chip[data-editing="true"], .sk2d-dim-chip:focus { outline: none;
  background: var(--reshape-surface, #1e1f29); border-color: var(--reshape-accent, #8be9fd); color: var(--reshape-text, #f8f8f2); }

/* Toolbar: icon buttons, the word kept for screen readers and tooltips. */
.sk-ribbon .model-tool-icons { gap: 1px; }
.sk-ribbon .sk2d-tool { width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.sk-ico, .sk-task-ico { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.sk-ico .sk-ico-dot, .sk-task-ico .sk-ico-dot, .sk-ico .sk-ico-fill, .sk-task-ico .sk-ico-fill { fill: currentColor; stroke: none; }
.sk-ico .sk-ico-thin, .sk-task-ico .sk-ico-thin { stroke-width: 1; opacity: 0.7; }
.sk-ico .sk-ico-dash, .sk-task-ico .sk-ico-dash { stroke-dasharray: 2.5 2; }
.sk-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
/* Solver-state colours. Under-constrained geometry keeps the plain stroke;
   a row nothing can move turns green; rows named by a contradiction or a
   redundancy take the warm colours, and so do their constraint marks. */
.sk-shape.sk-full { stroke: #5ad07a; }
.sk-vertex.sk-full { fill: #5ad07a; }
.sk-shape.sk-conflict { stroke: #ff8a2a; }
.sk-vertex.sk-conflict { fill: #ff8a2a; }
.sk-shape.sk-redundant { stroke: #e6c229; }
.sk-vertex.sk-redundant { fill: #e6c229; }
.sk-shape.sk-constr { stroke: #5aa9ff; opacity: 0.9; }
.sk-shape-sel.sk-full, .sk-shape-sel.sk-conflict, .sk-shape-sel.sk-redundant { stroke: var(--reshape-pink, #ff79c6) !important; }
/* Constraint marks and dimension lines are red, like every sketcher's. */
.sk-rule-icon > * { stroke: #ee5b4f; }
.sk-rule-icon > .sk-rule-dot { fill: #ee5b4f; }
.sk-rule-glyph.sk-rule-conflict .sk-rule-icon > * { stroke: #ff8a2a; }
.sk-rule-glyph.sk-rule-conflict .sk-rule-icon > .sk-rule-dot { fill: #ff8a2a; }
.sk-rule-glyph.sk-rule-redundant .sk-rule-icon > * { stroke: #e6c229; }
.sk-rule-glyph.sk-rule-redundant .sk-rule-icon > .sk-rule-dot { fill: #e6c229; }
.sk-dimart { pointer-events: none; }
.sk-dimart line { stroke: #ee5b4f; stroke-width: 1.1; vector-effect: non-scaling-stroke; }
.sk-dimart-head { fill: #ee5b4f; stroke: none; }
.sk-dimart.sk-rule-conflict line { stroke: #ff8a2a; }
.sk-dimart.sk-rule-conflict .sk-dimart-head { fill: #ff8a2a; }
.sk-dimart.sk-rule-redundant line { stroke: #e6c229; }
.sk-dimart.sk-rule-redundant .sk-dimart-head { fill: #e6c229; }
.sk-dimart.sk-rule-sel line { stroke: var(--reshape-pink, #ff79c6); }
.sk-dimart.sk-rule-sel .sk-dimart-head { fill: var(--reshape-pink, #ff79c6); }
.sk2d-dim-chip { color: #ff6a5c; }
.sk-dimart-ref line { stroke: #4aa3ff; }
.sk-dimart-ref .sk-dimart-head { fill: #4aa3ff; }
.sk2d-dim-chip.sk-ref-chip { color: #4aa3ff; }
.sk2d-tool[aria-pressed="true"] { border-color: var(--reshape-accent, #8be9fd); }
.sk-ico-fill { fill: currentColor; }
.sk2d-dim-chip.sk-rule-conflict { color: #ff8a2a; }
.sk2d-dim-chip.sk-rule-redundant { color: #e6c229; }
.sk2d-dim-chip.sk-rule-sel { color: var(--reshape-pink, #ff79c6); }
/* The task panel docked in the right column. */
.sk-task { display: flex; flex-direction: column; font-family: var(--reshape-font-ui); font-size: 12px;
  color: var(--reshape-text, #f8f8f2); min-height: 0; flex: 1 1 auto; }
.sk-task-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.sk-task-sec { flex: 0 1 auto; min-height: 96px; display: flex; flex-direction: column; border-top: 1px solid var(--reshape-border, #44475a); }
.sk-task-sec .sk-task-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.sk-task-opts { flex: 0 0 auto; }
.sk-task-foot { flex: 0 0 auto; display: flex; gap: 8px; justify-content: flex-end; padding: 8px 10px;
  border-top: 1px solid var(--reshape-border, #44475a); }
.sk-task-btn { min-width: 64px; padding: 4px 12px; border-radius: 3px; cursor: pointer; font: inherit;
  background: var(--reshape-surface, #1e1f29); color: var(--reshape-text, #f8f8f2);
  border: 1px solid var(--reshape-border, #44475a); }
.sk-task-btn.is-primary { border-color: var(--reshape-accent, #8be9fd); color: var(--reshape-accent, #8be9fd); }
.sk-task-btn:hover { filter: brightness(1.15); }
.sk-task-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-weight: 600;
  border-bottom: 1px solid var(--reshape-border, #44475a); }
.sk-task-head .sk-ico { color: #ee5b4f; }
.sk-task-status { padding: 8px 10px; line-height: 1.45; border-bottom: 1px solid var(--reshape-border, #44475a); }
.sk-task-state { font-weight: 600; }
.sk-st-ok .sk-task-state { color: #5ad07a; }
.sk-st-warn .sk-task-state { color: #ffb86c; }
.sk-st-bad .sk-task-state { color: #ff6a5c; }
.sk-st-info .sk-task-state { color: var(--reshape-text-muted, #6272a4); }
.sk-task-detail { color: var(--reshape-text-muted, #a4a9c4); }
.sk-task-ids { margin-left: 6px; }
.sk-task-id { background: none; border: 0; padding: 0 1px; color: var(--reshape-accent, #8be9fd);
  text-decoration: underline; cursor: pointer; font: inherit; }
.sk-task-note { color: var(--reshape-warn, #ffb86c); margin-top: 4px; }
.sk-task-opts { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 6px 10px;
  color: var(--reshape-text-muted, #a4a9c4); border-bottom: 1px solid var(--reshape-border, #44475a); }
.sk-task-refresh { margin-left: auto; font: inherit; cursor: pointer; padding: 1px 8px; border-radius: 3px;
  background: var(--reshape-surface, #1e1f29); color: var(--reshape-text, #f8f8f2); border: 1px solid var(--reshape-border, #44475a); }
.sk-task-filter { padding: 0 10px 4px; color: var(--reshape-text-muted, #a4a9c4); }
.sk-task-filter label { display: flex; align-items: center; gap: 8px; }
.sk-task-filter select { flex: 1 1 auto; min-width: 0; font: inherit; background: var(--reshape-surface, #1e1f29);
  color: var(--reshape-text, #f8f8f2); border: 1px solid var(--reshape-border, #44475a); border-radius: 3px; padding: 1px 4px; }
.sk-task-vis { margin: 0; flex: 0 0 auto; }
.sk-task-gear, .sk-task-eye, .sk-task-mode { display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 1px solid transparent; border-radius: 3px; padding: 1px 3px; cursor: pointer;
  color: var(--reshape-text-muted, #a4a9c4); font: inherit; }
.sk-task-mode { color: var(--reshape-text, #f8f8f2); }
.sk-task-mode .sk-ico { stroke-width: 1.8; }
.sk-task-gear:hover, .sk-task-eye:hover:not(:disabled), .sk-task-mode:hover { color: var(--reshape-text, #f8f8f2);
  border-color: var(--reshape-border, #44475a); }
.sk-task-gear[aria-expanded="true"] { color: var(--reshape-accent, #8be9fd); border-color: var(--reshape-accent, #8be9fd); }
.sk-task-eye { margin-left: auto; margin-right: 10px; padding: 0 3px; }
.sk-task-eye:disabled { opacity: 0.4; cursor: default; }
.sk-task-menu { display: flex; flex-direction: column; gap: 4px; padding: 6px 10px; margin: 0 6px 4px;
  border: 1px solid var(--reshape-border, #44475a); border-radius: 4px; background: var(--reshape-surface, #1e1f29);
  color: var(--reshape-text-muted, #a4a9c4); }
.sk-task-menu label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.sk-task-modes { display: inline-flex; gap: 1px; flex: 0 0 auto; }
.sk-task-mode { padding: 1px 2px; }
.sk-task-mode.is-on { color: var(--reshape-pink, #ff79c6); border-color: var(--reshape-pink, #ff79c6); }
.sk-task-detail, .sk-task-state { white-space: nowrap; }
.sk-task-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-task-note { white-space: normal; }
.sk-task-sect { display: flex; justify-content: space-between; padding: 6px 10px 4px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; font-size: 11px; color: var(--reshape-text-muted, #a4a9c4); }
.sk-task-count { font-weight: 400; }
.sk-task-list { list-style: none; margin: 0; padding: 0 4px 6px; }
.sk-task-empty { padding: 4px 8px; color: var(--reshape-text-muted, #6272a4); }
.sk-task-row { display: flex; align-items: center; gap: 7px; padding: 3px 6px; border-radius: 3px; cursor: default; }
.sk-task-row:hover, .sk-task-row.is-hover { background: rgba(255, 255, 255, 0.06); }
.sk-task-row.is-sel { background: rgba(255, 121, 198, 0.2); }
.sk-task-ico { width: 16px; height: 16px; flex: 0 0 auto; color: #ee5b4f; }
.sk-el-full .sk-task-ico { color: #5ad07a; }
.sk-el-free .sk-task-ico { color: var(--reshape-text, #f8f8f2); }
.sk-el-conflict .sk-task-ico, .sk-task-row.sk-rule-conflict .sk-task-ico { color: #ff8a2a; }
.sk-el-redundant .sk-task-ico, .sk-task-row.sk-rule-redundant .sk-task-ico { color: #e6c229; }
.sk-task-row.sk-rule-conflict .sk-task-name { color: #ff8a2a; }
.sk-task-row.sk-rule-redundant .sk-task-name { color: #e6c229; }
.sk-task-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-task-val { font-family: var(--reshape-font-mono, monospace); color: #ff6a5c; }
.sk-task-flag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--reshape-text-muted, #6272a4); }
.sk-el-full .sk-task-flag { color: #5ad07a; }
.sk-task-del { visibility: hidden; background: none; border: 0; color: var(--reshape-text-muted, #a4a9c4);
  cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px; }
.sk-task-row:hover .sk-task-del, .sk-task-row.is-sel .sk-task-del { visibility: visible; }
.sk-task-del:hover { color: #ff6a5c; }

/* The sketch canvas is a light drawing sheet, the same paper the 3D viewport
   uses, so a part moves between the two without the ground changing under it. */
.sk2d-host { background: #f5f6f8; }
.sk2d-host .sk-grid { stroke: #7d8397; opacity: 0.26; }
.sk2d-host .sk-shape { stroke: #232634; stroke-width: 1.8; }
.sk2d-host .sk-vertex { fill: #232634; }
.sk2d-host .sk-shape.sk-full { stroke: #1c9c45; }
.sk2d-host .sk-vertex.sk-full { fill: #1c9c45; }
.sk2d-host .sk-shape.sk-conflict { stroke: #e8710a; }
.sk2d-host .sk-vertex.sk-conflict { fill: #e8710a; }
.sk2d-host .sk-shape.sk-redundant { stroke: #b58f00; }
.sk2d-host .sk-vertex.sk-redundant { fill: #b58f00; }
.sk2d-host .sk-shape.sk-constr { stroke: #2f7be0; }
.sk2d-host .sk-shape-sel { stroke: #d6249f !important; }
.sk2d-host .sk-vertex-sel { fill: #d6249f; }
.sk2d-host .sk-origin { fill: #1b7fc4; }
.sk2d-host .sk-rubber, .sk2d-host .sk-preview { stroke: #1b7fc4; }
.sk2d-host .sk-snap-glyph, .sk2d-host .sk-snap-glyph > * { stroke: #1b7fc4; }
.sk2d-host .sk-snap-glyph[data-snap="grid"] { fill: #1b7fc4; }
.sk2d-host .sk-rule-icon > * { stroke: #d93a2f; }
.sk2d-host .sk-rule-icon > .sk-rule-dot { fill: #d93a2f; }
.sk2d-host .sk-rule-glyph.sk-rule-conflict .sk-rule-icon > * { stroke: #e8710a; }
.sk2d-host .sk-rule-glyph.sk-rule-conflict .sk-rule-icon > .sk-rule-dot { fill: #e8710a; }
.sk2d-host .sk-rule-glyph.sk-rule-redundant .sk-rule-icon > * { stroke: #b58f00; }
.sk2d-host .sk-rule-glyph.sk-rule-redundant .sk-rule-icon > .sk-rule-dot { fill: #b58f00; }
.sk2d-host .sk-rule-glyph.sk-rule-sel .sk-rule-icon > * { stroke: #d6249f; }
.sk2d-host .sk-rule-glyph.sk-rule-sel .sk-rule-icon > .sk-rule-dot { fill: #d6249f; }
.sk2d-host .sk-dimart line { stroke: #d93a2f; }
.sk2d-host .sk-dimart-head { fill: #d93a2f; }
.sk2d-host .sk-dimart.sk-rule-conflict line { stroke: #e8710a; }
.sk2d-host .sk-dimart.sk-rule-conflict .sk-dimart-head { fill: #e8710a; }
.sk2d-host .sk-dimart.sk-rule-redundant line { stroke: #b58f00; }
.sk2d-host .sk-dimart.sk-rule-redundant .sk-dimart-head { fill: #b58f00; }
.sk2d-host .sk-dimart.sk-rule-sel line { stroke: #d6249f; }
.sk2d-host .sk-dimart.sk-rule-sel .sk-dimart-head { fill: #d6249f; }
.sk2d-host .sk2d-dim-chip { background: #f5f6f8; color: #d93a2f; }
.sk2d-host .sk-dimart-ref line { stroke: #1b6fd1; }
.sk2d-host .sk-dimart-ref .sk-dimart-head { fill: #1b6fd1; }
.sk2d-host .sk2d-dim-chip.sk-ref-chip { color: #1b6fd1; }
.sk2d-host .sk2d-dim-chip.sk-rule-conflict { color: #e8710a; }
.sk2d-host .sk2d-dim-chip.sk-rule-redundant { color: #b58f00; }
.sk2d-host .sk2d-dim-chip.sk-rule-sel { color: #d6249f; border-color: #d6249f; }
.sk2d-host .sk2d-dim-chip[data-editing="true"], .sk2d-host .sk2d-dim-chip:focus { background: #fff; color: #111; border-color: #1b7fc4; }
.sk2d-host .sk-dim-ghost { fill: #d93a2f; }
.sk2d-host .sk-axis-hint { fill: #1b7fc4; }
`;