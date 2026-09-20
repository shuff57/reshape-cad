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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelDoc, SketchFeature, SoupGeom, SoupRule } from '@shuff57/reshape-script/model-types';
import {
  angleInArcRange,
  arcEnds,
  arcFromClicks,
  distToCircleStroke,
  distToSegment,
  findSnap as findSnapCore,
  inferLineConstraint,
  namedPointsOf,
  nextGeomId,
  pointWorld,
  readSolved,
  renumber,
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
  type CoreGeom,
  type LineChain,
  type Pt,
  type SnapHit,
  type SoupGeomNew,
} from './sketch-canvas-core.js';
import { pointSlots } from '@shuff57/reshape-kernel/sketch-session';
import {
  applyWheelZoom,
  fitView,
  panByPx,
  screenPxToWorld,
  type BBox2Like,
  type SizePx,
  type SketchView,
} from '../sketch-view.js';
import { loadSchemeName, schemeToMouseButtons } from '../camera-controls.js';

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
/** Grid: the smallest 1-2-5 step whose spacing is at least this many screen
 *  pixels, and a ceiling on how many lines one frame may draw. */
const GRID_MIN_PX = 9;
const GRID_MAX_LINES = 400;
/** Pointer travel under which a press is a CLICK, so the click-click tool
 *  flow -- not the drag-to-create gesture -- owns it. Screen px. */
const DRAG_PX = 3;

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'slot' | 'trim';
/** The tools a single drag can finish on its own (SPEC-mouse-parity Phase 2
 *  item 2). Line and arc are not among them: a chain and a three-point arc
 *  need more points than one drag carries. */
type CreateTool = 'rect' | 'circle' | 'slot';
const isCreateTool = (t: Tool): t is CreateTool => t === 'rect' || t === 'circle' || t === 'slot';
type Sel = { id: number; at: 'a' | 'b' | 'c' | null };

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
  const rafRef = useRef<number | null>(null);
  // A LIST of point pulls, not one: a point drag queues a single pair of
  // slots, a whole-entity drag queues one per named point of the row and the
  // solve applies them in order, each warm-starting from the last.
  const pendingDrag = useRef<Array<{ sa: number; sb: number; tx: number; ty: number }> | null>(null);

  const writeDoc = useCallback(
    (rawGeoms: SoupGeom[], rawRules: SoupRule[]) => {
      // Circle-in-mixed-wire canonicalization (kernel §5.3.10's own advice,
      // applied mechanically): a circle welded to lines by 2 tangencies
      // becomes an arc pair split at the contact points, so wire discovery
      // walks it like any other curve. Sketches without such a circle pass
      // through untouched.
      const split = splitWeldedCircles(rawGeoms as CoreGeom[], rawRules as unknown as Array<Record<string, any>>);
      const nextGeoms = split.geoms as SoupGeom[];
      const nextRules = split.rules as unknown as SoupRule[];
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
    writeDoc(geoms, []);
  }, [geoms, sketch.geoms, sketch.geom, writeDoc]);



  // Open + solve whenever the rows change; the session is a function of them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One session, one load: StrictMode double-invokes effects, and the
      // second invoke must WAIT for the first one's load() instead of
      // calling open() on an un-initialised module (the race the dogfood run
      // caught). load() resolves immediately once this.wasm is set.
      if (!sessionRef.current) {
        const { SketchSession2D } = await import('@shuff57/reshape-kernel/sketch-session');
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
      setDiagnosis(s.diagnose());
      setSolved(readSolved(geoms as CoreGeom[], s.params));
    })();
    return () => {
      cancelled = true;
    };
  }, [geoms, rules]);

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


  const selPoints = useMemo(() => sel.filter((s) => s.at !== null), [sel]);

  const applyRule = useCallback(
    (r: SoupRule) => {
      pushRule(r);
      setSel([]);
    },
    [pushRule],
  );

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
              : '0';
      setDim({ kind, a: selShapes[0] ?? null, b: null, value: initial });
    },
    [selShapes, solved],
  );

  const commitDim = useCallback(() => {
    if (!dim) return;
    const v = Number(dim.value);
    if (!Number.isFinite(v) || (v <= 0 && dim.kind !== 'distanceX' && dim.kind !== 'distanceY')) {
      setStatus('enter a number (positive unless a signed offset)');
      return;
    }
    const g = dim.a ? solved.find((x) => x.id === dim.a!.id) : null;
    if (!g) return;
    if (dim.kind === 'radius') applyRule({ k: 'radius', a: g.id, value: v });
    else if (dim.kind === 'diameter') applyRule({ k: 'diameter', a: g.id, value: v });
    else if (dim.kind === 'distance') applyRule({ k: 'distance', a: g.id, aEnd: 'a', b: g.id, bEnd: 'b', value: v });
    setDim(null);
  }, [applyRule, dim, solved]);

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
      // No handle under the press, but a BODY: drag the whole row. Every one
      // of its named points moves by the same delta -- both ends of a line,
      // a circle's centre, an arc's centre and both ends -- each as one
      // solver drag() of the slot pair behind it. The centre goes first so an
      // arc translates its frame before its ends follow it.
      const hit = findHit(e);
      if (!hit || hit.at !== null) return;
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

  const onPointerUp = useCallback(() => {
    if (panRef.current) {
      panRef.current = null;
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
  }, [commitCircle, commitRect, commitSlotBox, geoms, rules, writeDoc]);

  // --- keyboard -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (dim) setDim(null);
        else if (chain || clicks.length) {
          setChain(null);
          setClicks([]);
        } else onExit?.();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select') {
        onDeleteClick();
      } else if (e.key.toLowerCase() === 'f' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        fit();
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) setTool('line');
      else if (e.key === 's' && !e.metaKey && !e.ctrlKey) setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chain, clicks.length, dim, fit, onDeleteClick, onExit, tool]);

  // --- render --------------------------------------------------------------------------
  const selKey = (id: number, at: 'a' | 'b' | 'c' | null) => `${id}:${at ?? ''}`;
  const isSel = (id: number, at: 'a' | 'b' | 'c' | null) => sel.some((s) => s.id === id && s.at === at);

  const vertex = (id: number, at: 'a' | 'b' | 'c', w: Pt, key: string) => {
    const selected = isSel(id, at);
    return (
      <circle
        key={key}
        className={`sk-vertex${selected ? ' sk-vertex-sel' : ''}`}
        cx={w.x}
        cy={-w.y}
        r={VERTEX_R_PX * mmPerPx}
        data-part={`v:${id}:${at}`}
      />
    );
  };

  const shapes: React.ReactNode[] = [];
  for (const g of solved) {
    const shapeSel = isSel(g.id, null);
    const cls = `sk-shape${shapeSel ? ' sk-shape-sel' : ''}${g.construction ? ' sk-constr' : ''}`;
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
  }

  const dofClass = diagnosis
    ? diagnosis.bucket === 'conflicting'
      ? 'sk-dof-bad'
      : diagnosis.dof === 0
        ? 'sk-dof-ok'
        : 'sk-dof-warn'
    : '';
  const dofText = diagnosis
    ? diagnosis.bucket === 'conflicting'
      ? 'Over-constrained'
      : diagnosis.dof === 0
        ? 'Fully constrained ✓'
        : `${diagnosis.dof} DoF`
    : '';

  // Docked into the ribbon, same portal target ModelEditor's own toolbar
  // uses -- while a sketch is open, ModelEditor hides its 3D groups behind
  // that same host and leaves File/Edit/Done, so this renders right after
  // them rather than floating a second toolbar over the canvas.
  const ribbonHost = typeof document !== 'undefined' ? document.getElementById('reshapeRibbon') : null;
  return (
    <div className="sk2d-host">
      <style>{SK2D_CSS}</style>
      {ribbonHost && createPortal(
        <div className="model-tools">
          <div className="model-tool-group">
            <div className="model-tool-icons">
              {(
                [
                  ['select', 'Select'],
                  ['line', 'Line'],
                  ['rect', 'Rect'],
                  ['circle', 'Circle'],
                  ['arc', 'Arc'],
                  ['slot', 'Slot'],
                  ['trim', 'Trim'],
                ] as Array<[Tool, string]>
              ).map(([t, label]) => (
                <button key={t} className="sk2d-tool" aria-pressed={tool === t} onClick={() => setTool(t)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="model-tool-group-label">Draw</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" disabled={!canHoriz} title="Horizontal" onClick={() => applyRule({ k: 'horizontal', a: selShapes[0].id })}>
                ⟷
              </button>
              <button className="sk2d-tool" disabled={!canVert} title="Vertical" onClick={() => applyRule({ k: 'vertical', a: selShapes[0].id })}>
                ↕
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
                Coincident
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
                ∥
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
                =
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
                ⟂
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
                Tangent
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
                On Object
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
                Symmetric
              </button>
              <button
                className="sk2d-tool"
                disabled={!canLock}
                title="Lock this point where it is"
                onClick={() => {
                  const [p] = selPoints as [Sel];
                  applyRule({ k: 'lock', a: p.id, aEnd: p.at! });
                }}
              >
                Lock
              </button>
            </div>
            <span className="model-tool-group-label">Constrain</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" disabled={!canDimLine} onClick={() => openDim('distance')}>
                Dim
              </button>
              <button className="sk2d-tool" disabled={!canDimRadius} onClick={() => openDim('radius')}>
                R
              </button>
              <button className="sk2d-tool" disabled={!canDimDiameter} title="Diameter" onClick={() => openDim('diameter')}>
                ⌀
              </button>
              {dim && (
                <span className="sk2d-dim">
                  <input
                    autoFocus
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
              <button className="sk2d-tool" disabled={sel.length === 0} onClick={onDeleteClick}>
                Delete
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Toggle construction geometry (dashed; solved but never profiled)"
                onClick={onConstrClick}
              >
                Constr
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Mirror the selected rows about the Y axis (x -> -x)"
                onClick={() => onMirror('y')}
              >
                Mirror
              </button>
              <button
                className="sk2d-tool"
                disabled={selShapes.length === 0}
                title="Copy the selected rows, shifted 10mm right"
                onClick={() => onCopy(10, 0)}
              >
                Copy
              </button>
            </div>
            <span className="model-tool-group-label">Modify</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <button className="sk2d-tool" title="Fit the sketch in the view (Shift+F)" onClick={fit}>
                Fit
              </button>
            </div>
            <span className="model-tool-group-label">View</span>
          </div>
          <div className="model-tool-divider" />
          <div className="model-tool-group">
            <div className="model-tool-icons">
              <label className="sk2d-auto">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto
              </label>
              <span className={`sk-dof ${dofClass}`}>{dofClass === 'sk-dof-bad' ? '⨯ ' : ''}{dofText}</span>
              {status && <span className="sk2d-status">{status}</span>}
            </div>
            <span className="model-tool-group-label">Status</span>
          </div>
        </div>,
        ribbonHost
      )}
      <svg
        ref={svgRef}
        className="sk2d-svg"
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
          if (tool === 'line') onLineClick(e);
          else if (tool === 'select') onSelectClick(e);
          else if (tool === 'rect') onRectClick(e);
          else if (tool === 'circle') onCircleClick(e);
          else if (tool === 'arc') onArcClick(e);
          else if (tool === 'slot') onSlotClick(e);
          else if (tool === 'trim') onTrimClick(e);
        }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          // Only when the active scheme pans with the right button; any other
          // scheme leaves the browser menu alone (Phase 4 owns the real one).
          if (panButton === 2) e.preventDefault();
        }}
        onDoubleClick={() => {
          setChain(null);
          setClicks([]);
        }}
      >
        <g className="sk2d-grid">{gridNodes(view, size)}</g>
        <g className="sk2d-geom">{shapes}</g>
        <g className="sk2d-preview">{preview}</g>
        {hoverSnap && snapGlyph(hoverSnap, mmPerPx)}
      </svg>
    </div>
  );
}

// --- module helpers --------------------------------------------------------------------

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
.sk2d-svg { width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
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
.sk-rubber { stroke: var(--reshape-accent, #8be9fd); stroke-width: 1.4; stroke-dasharray: 5 4; fill: none; vector-effect: non-scaling-stroke; }
.sk-preview { stroke: var(--reshape-accent, #8be9fd); stroke-width: 1.4; fill: none; opacity: 0.8; vector-effect: non-scaling-stroke; }
.sk-axis-hint { fill: var(--reshape-accent, #8be9fd); }
`;