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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelDoc, SketchFeature, SoupGeom, SoupRule } from '@shuff57/reshape-script/model-types';
import {
  angleInArcRange,
  arcEnds,
  arcFromClicks,
  distToCircleStroke,
  distToSegment,
  inferLineConstraint,
  namedPointsOf,
  nextGeomId,
  pointWorld,
  readSolved,
  renumber,
  sampleArc,
  snapAxis,
  arcAngles,
  type CoreGeom,
  type LineChain,
  type Pt,
  type SoupGeomNew,
} from './sketch-canvas-core.js';
import { pointSlots } from '@shuff57/reshape-kernel/sketch-session';

const SNAP_PX = 8;
const HIT_PX = 6;
const AXIS_TOL_DEG = 4;
/** mm of sketch plane visible around the origin, both axes. */
const VIEW = 100;

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'delete';
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
  const [hoverSnap, setHoverSnap] = useState<{ id: number; at: 'a' | 'b' | 'c'; world: Pt } | null>(null);
  const [dim, setDim] = useState<{
    kind: 'distance' | 'radius' | 'distanceX' | 'distanceY' | 'angle';
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
  const pendingDrag = useRef<{ sa: number; sb: number; tx: number; ty: number } | null>(null);

  const writeDoc = useCallback(
    (nextGeoms: SoupGeom[], nextRules: SoupRule[]) => {
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

  // --- coordinate mapping ------------------------------------------------------
  const view = useMemo(() => `${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`, []);

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

  // --- tool plumbing -----------------------------------------------------------
  const findSnap = useCallback(
    (e: { clientX: number; clientY: number }) => {
      let best: { id: number; at: 'a' | 'b' | 'c'; world: Pt } | null = null;
      let bestDist = SNAP_PX;
      for (const g of solved) {
        for (const { at } of namedPointsOf(g)) {
          const w = pointWorld(g, at);
          if (!w) continue;
          const s = screenFromWorld(w);
          const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
          if (d < bestDist) {
            bestDist = d;
            best = { id: g.id, at, world: w };
          }
        }
      }
      return best;
    },
    [solved, screenFromWorld, worldFromEvent],
  );

  const findHit = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const w = worldFromEvent(e);
      let best: Sel | null = null;
      let bestDist = HIT_PX;
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
    [solved, worldFromEvent],
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

  const onRectClick = useCallback(
    (e: React.MouseEvent) => {
      const w = worldFromEvent(e);
      if (clicks.length === 0) {
        setClicks([w]);
        return;
      }
      const [c1] = clicks as [Pt];
      const id = nextGeomId(geoms as CoreGeom[]);
      const a: [number, number] = [c1.x, c1.y];
      const b2: [number, number] = [w.x, c1.y];
      const c: [number, number] = [w.x, w.y];
      const d: [number, number] = [c1.x, w.y];
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
      setClicks([]);
    },
    [clicks, geoms, rules, writeDoc, worldFromEvent],
  );

  const onCircleClick = useCallback(
    (e: React.MouseEvent) => {
      if (clicks.length === 0) {
        const snap = findSnap(e);
        setClicks([snap ? snap.world : worldFromEvent(e)]);
        return;
      }
      const [c] = clicks as [Pt];
      const w = worldFromEvent(e);
      const r = Math.hypot(w.x - c.x, w.y - c.y);
      if (r > 1e-9) {
        pushGeom({ k: 'circle', c: [c.x, c.y], r });
      }
      setClicks([]);
    },
    [clicks, findSnap, pushGeom, worldFromEvent],
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

  // --- constraint buttons -----------------------------------------------------------
  const selShapes = useMemo(() => sel.filter((s) => s.at === null), [sel]);
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
  const canDimLine = selShapes.length === 1 && geomKind(selShapes[0].id, solved) === 'line';
  const canDimRadius =
    selShapes.length === 1 && ['circle', 'arc'].includes(String(geomKind(selShapes[0].id, solved)));

  const openDim = useCallback(
    (kind: 'distance' | 'radius' | 'distanceX' | 'distanceY' | 'angle') => {
      const g = solved.find((x) => x.id === selShapes[0]?.id);
      if (!g) return;
      if (kind === 'radius' && g.k !== 'circle' && g.k !== 'arc') return;
      const initial =
        kind === 'radius'
          ? String(g.r)
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
    else if (dim.kind === 'distance') applyRule({ k: 'distance', a: g.id, aEnd: 'a', b: g.id, bEnd: 'b', value: v });
    setDim(null);
  }, [applyRule, dim, solved]);

  // --- drag to solve -----------------------------------------------------------------
  const draggingRef = useRef<{ id: number; at: 'a' | 'b' | 'c' } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (tool !== 'select') return;
      const snap = findSnap(e);
      if (!snap) return;
      draggingRef.current = { id: snap.id, at: snap.at };
      // Capture keeps moves flowing outside the svg on a real pointer; a
      // synthetic driver has no active pointer, and capture throws NotFound
      // there — losing it is fine, the move handler still fires on the svg.
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // no active pointer: nothing to capture, keep the drag ref
      }
    },
    [findSnap, tool],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const w = worldFromEvent(e);
      setPointer(w);
      setHoverSnap(findSnap(e));
      const d = draggingRef.current;
      if (!d || !sessionRef.current) return;
      const slots = pointSlots(geoms as any, d.id, d.at);
      if (!slots) return;
      const payload = { sa: slots[0], sb: slots[1], tx: w.x, ty: w.y };
      pendingDrag.current = payload;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingDrag.current;
        pendingDrag.current = null;
        if (!p) return;
        const s = sessionRef.current;
        if (s.drag(p.sa, p.sb, p.tx, p.ty)) {
          setSolved(readSolved(geoms as CoreGeom[], s.params));
        } else {
          setStatus(s.lastError() ?? 'the drag did not solve');
        }
      });
    },
    [findSnap, geoms, worldFromEvent],
  );

  const onPointerUp = useCallback(() => {
    const d = draggingRef.current;
    draggingRef.current = null;
    if (!d) return;
    // Commit the dragged positions as row values: read the solved vector back
    // into the doc (one onChange per gesture = one undo entry).
    const rows = readSolved(geoms as CoreGeom[], sessionRef.current.params) as SoupGeom[];
    writeDoc(rows, rules);
  }, [geoms, rules, writeDoc]);

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
      } else if (e.key === 'l' && !e.metaKey && !e.ctrlKey) setTool('line');
      else if (e.key === 's' && !e.metaKey && !e.ctrlKey) setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chain, clicks.length, dim, onDeleteClick, onExit, tool]);

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
        r={0.9}
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
          <text className="sk-axis-hint" x={pt.x + 1.2} y={-pt.y - 1.2}>
            {axisKind === 'horizontal' ? '—' : '|'}
          </text>
        )}
      </>
    );
  } else if (tool === 'rect' && clicks.length === 1 && pointer) {
    const [c1] = clicks as [Pt];
    preview = (
      <rect
        className="sk-preview"
        x={Math.min(c1.x, pointer.x)}
        y={-Math.max(c1.y, pointer.y)}
        width={Math.abs(pointer.x - c1.x)}
        height={Math.abs(pointer.y - c1.y)}
      />
    );
  } else if (tool === 'circle' && clicks.length === 1 && pointer) {
    const [c] = clicks as [Pt];
    preview = (
      <circle className="sk-preview" cx={c.x} cy={-c.y} r={Math.hypot(pointer.x - c.x, pointer.y - c.y)} />
    );
  } else if (tool === 'arc' && clicks.length === 2 && pointer) {
    const [c1, c2] = clicks as [Pt, Pt];
    const arc = arcFromClicks(c1, c2, pointer);
    if (arc) {
      const pts = sampleArc(arc.cx, arc.cy, arc.r, arc.a0, arc.sweep);
      preview = <polyline className="sk-preview" points={pts.map((p) => `${p.x},${-p.y}`).join(' ')} />;
    }
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

  return (
    <div className="sk2d-host">
      <style>{SK2D_CSS}</style>
      <div className="sk2d-toolbar">
        {(
          [
            ['select', 'Select'],
            ['line', 'Line'],
            ['rect', 'Rect'],
            ['circle', 'Circle'],
            ['arc', 'Arc'],
          ] as Array<[Tool, string]>
        ).map(([t, label]) => (
          <button key={t} className={`sk2d-tool${tool === t ? ' is-active' : ''}`} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
        <span className="sk2d-sep" />
        <button className="sk2d-tool" disabled={!canHoriz} onClick={() => applyRule({ k: 'horizontal', a: selShapes[0].id })}>
          ⟷
        </button>
        <button className="sk2d-tool" disabled={!canVert} onClick={() => applyRule({ k: 'vertical', a: selShapes[0].id })}>
          ↕
        </button>
        <button
          className="sk2d-tool"
          disabled={!canCoin}
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
          onClick={() => {
            const [a, b] = selShapes as [Sel, Sel];
            applyRule({ k: 'equal', a: a.id, b: b.id });
          }}
        >
          =
        </button>
        <button className="sk2d-tool" disabled={!canDimLine} onClick={() => openDim('distance')}>
          Dim
        </button>
        <button className="sk2d-tool" disabled={!canDimRadius} onClick={() => openDim('radius')}>
          R
        </button>
        <button className="sk2d-tool" disabled={sel.length === 0} onClick={onDeleteClick}>
          Delete
        </button>
        <span className="sk2d-sep" />
        <label className="sk2d-auto">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto
        </label>
        <span className={`sk-dof ${dofClass}`}>{dofClass === 'sk-dof-bad' ? '⨯ ' : ''}{dofText}</span>
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
            <button onClick={commitDim}>✓</button>
            <button onClick={() => setDim(null)}>✕</button>
          </span>
        )}
        {status && <span className="sk2d-status">{status}</span>}
      </div>
      <svg
        ref={svgRef}
        className="sk2d-svg"
        viewBox={view}
        preserveAspectRatio="xMidYMid meet"
        onClick={(e) => {
          if (tool === 'line') onLineClick(e);
          else if (tool === 'select') onSelectClick(e);
          else if (tool === 'rect') onRectClick(e);
          else if (tool === 'circle') onCircleClick(e);
          else if (tool === 'arc') onArcClick(e);
        }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onDoubleClick={() => {
          setChain(null);
          setClicks([]);
        }}
      >
        <g className="sk2d-grid">{gridNodes()}</g>
        <g className="sk2d-geom">{shapes}</g>
        <g className="sk2d-preview">{preview}</g>
        {hoverSnap && (
          <circle className="sk-snap-ring" cx={hoverSnap.world.x} cy={-hoverSnap.world.y} r={1.4} />
        )}
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

function gridNodes(): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (let i = -VIEW; i <= VIEW; i += 10) {
    if (i === 0) continue;
    nodes.push(<line key={`v${i}`} className="sk-grid" x1={i} y1={-VIEW} x2={i} y2={VIEW} />);
    nodes.push(<line key={`h${i}`} className="sk-grid" x1={-VIEW} y1={i} x2={VIEW} y2={i} />);
  }
  nodes.push(<line key="ax" className="sk-axis-x" x1={-VIEW} y1={0} x2={VIEW} y2={0} />);
  nodes.push(<line key="ay" className="sk-axis-y" x1={0} y1={-VIEW} x2={0} y2={VIEW} />);
  nodes.push(<circle key="o" className="sk-origin" cx={0} cy={0} r={0.8} />);
  return nodes;
}

const SK2D_CSS = `
.sk2d-host { position: absolute; inset: 0; display: flex; flex-direction: column;
  z-index: 30; background: var(--reshape-bg, #282a36); }
.sk2d-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--reshape-space-2, 4px);
  padding: var(--reshape-space-2, 4px) var(--reshape-space-3, 8px);
  border-bottom: 1px solid var(--reshape-border, #44475a); flex: none; z-index: 2;
  overflow: visible; }
.sk2d-tool { padding: 3px 8px; border-radius: var(--reshape-radius, 4px); border: none;
  background: none; color: var(--reshape-text, #f8f8f2); cursor: pointer;
  font-size: var(--reshape-font-size-sm, 12px); font-family: var(--reshape-font-ui); }
.sk2d-tool:hover:not(:disabled) { background: var(--reshape-surface-alt, #36333a); color: var(--reshape-accent, #8be9fd); }
.sk2d-tool:disabled { opacity: 0.35; cursor: default; }
.sk2d-tool.is-active { background: var(--reshape-surface-alt, #36333a); color: var(--reshape-pink, #ff79c6); }
.sk2d-sep { width: 1px; height: 16px; background: var(--reshape-border, #44475a); }
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
.sk2d-svg { flex: 1; width: 100%; height: 100%; cursor: crosshair; touch-action: none; }
.sk-grid { stroke: var(--reshape-text, #f8f8f2); stroke-width: 0.3; opacity: 0.25; }
.sk-axis-x { stroke: #e0685a; stroke-width: 0.25; opacity: 0.85; }
.sk-axis-y { stroke: #5fbf8f; stroke-width: 0.25; opacity: 0.85; }
.sk-origin { fill: var(--reshape-accent, #8be9fd); }
.sk-line, .sk-circle, .sk-arc, polyline { fill: none; }
.sk-shape { stroke: var(--reshape-text, #f8f8f2); stroke-width: 0.35; fill: none; }
.sk-constr { stroke-dasharray: 1 0.8; opacity: 0.6; }
.sk-shape-sel { stroke: var(--reshape-pink, #ff79c6) !important; }
.sk-vertex { fill: var(--reshape-text, #f8f8f2); }
.sk-vertex-sel { fill: var(--reshape-pink, #ff79c6); }
.sk-snap-ring { fill: none; stroke: var(--reshape-accent, #8be9fd); stroke-width: 0.3; }
.sk-rubber { stroke: var(--reshape-accent, #8be9fd); stroke-width: 0.3; stroke-dasharray: 0.8 0.5; fill: none; }
.sk-preview { stroke: var(--reshape-accent, #8be9fd); stroke-width: 0.3; fill: none; opacity: 0.8; }
.sk-axis-hint { fill: var(--reshape-accent, #8be9fd); font-size: 2.5px; }
`;