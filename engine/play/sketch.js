// engine/play/sketch.js
//
// Sketch-mode UI for reSHape Studio: a 2D SVG canvas over the 3D viewport
// where the user draws lines, selects geometry, applies constraints, and
// types dimensions, driving the real Sketcher solver exposed by
// engine/bridge/fc-sketch.mjs (attachSketchCommands). This module owns none
// of the session or the 3D view — studio.js hands in a getSession() getter
// (so this module always sees the ready kernel instance) plus onEnter/
// onFinish callbacks. Self-contained: export is just initSketchMode().
//
// Coordinates: the kernel's sketchState() returns solved geometry in mm,
// Y-up. SVG is Y-down, so every SVG y attribute is the negated mm value
// (svgY = -worldY); the viewBox is chosen to match. No pan/zoom in this
// slice — the view is fixed at roughly -15..95mm on both axes.
//
// Out of scope for this slice (see SPEC): auto Equal/Parallel/Perpendicular
// inference, tangent/equal-radius constraints, symmetry, dimension inference,
// ellipse, b-spline, trim (partial-delete), 3-point arc mode, dragging
// existing geometry, snapping new circles/arcs to existing points beyond
// center snap, constraint glyphs on committed geometry, pan/zoom, click-to-
// edit an existing dimension.
//
// Rectangle/Circle/Arc/Delete (slice 1b): Rect and Circle are 2-click tools,
// Arc is a 3-click center->start->end tool (see arcAnglesFromClicks). Their
// geometry math is pure (arcAnglesFromClicks, sampleArc — the latter also
// draws every ArcOfCircle, sampled into a <polyline> to sidestep SVG arc-flag
// ambiguity entirely) so it's unit-testable without a DOM or a kernel, same
// as the Line tool's helpers above. Delete walks the selection in descending
// geoId order since sketchDelGeometry() renumbers remaining ids on each call.
//
// Auto-constraints (Phase 3b): while drawing, the Line tool infers Horizontal/
// Vertical (snapping the endpoint onto the axis first), Coincident when an
// endpoint lands on an unrelated existing vertex, and a pin-to-origin on the
// sketch's very first point — all gated by the `#autoConstrain` toggle and all
// protected by a safety valve (delConstraint + re-check if an add would
// conflict; see applyLineClick). The decision logic is pure (inferLineConstraint
// / snapAxis / planAutoConstraints) so it's unit-testable against a fake
// session, same as computeLineClickPlan/applyLineClick.

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 8;
const HIT_PX = 6;
const VIEW_LO = -15;
const VIEW_HI = 95;
const AXIS_TOL_DEG = 4;

const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const log = (line) => {
  const el = $('status');
  if (el) { el.textContent += `\n${line}`; el.scrollTop = el.scrollHeight; }
};
const guardOp = (fn) => {
  try { fn(); } catch (e) { log(`✗ ${String(e.message || e).split('\n')[0]}`); }
};

// ---------------------------------------------------------------------------
// Pure line-tool state machine. Given the in-progress chain, an optional
// snapped vertex, and the raw click point, decide what the click means —
// no DOM, no session call — so it can be unit-tested against a fake session
// per the SPEC's "iterate without the kernel" instruction.
// ---------------------------------------------------------------------------
export function computeLineClickPlan(chain, snap, worldPt) {
  const point = snap ? { x: snap.x, y: snap.y } : worldPt;
  if (!chain) {
    return { kind: 'start', point, snap };
  }
  const closesTo = (snap && chain.startGeoId != null &&
    snap.geoId === chain.startGeoId && snap.pointPos === chain.startPointPos)
    ? { geoId: chain.startGeoId, pointPos: chain.startPointPos }
    : null;
  return {
    kind: 'extend',
    from: { x: chain.prevX, y: chain.prevY },
    to: point,
    // The vertex `to` snapped onto (if any) — same object as `closesTo` when
    // the snap happens to be the chain's own start. Used by planAutoConstraints
    // to add an auto-Coincident WITHOUT double-adding the closing one.
    toSnap: snap || null,
    linkPrev: chain.prevGeoId != null ? { geoId: chain.prevGeoId, pointPos: chain.prevPointPos } : null,
    setsStart: chain.startGeoId == null,
    closesTo,
  };
}

// Pure: angle (deg, 0..360 from +X) of the segment from `from` to `to`.
function lineAngleDeg(from, to) {
  const deg = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

// Pure DECISION: does the candidate line from->to want to be Horizontal or
// Vertical? Returns 'Horizontal' | 'Vertical' | null. Never mutates its args.
export function inferLineConstraint(from, to, angleTolDeg = AXIS_TOL_DEG) {
  if (from.x === to.x && from.y === to.y) return null; // zero-length: no angle
  const deg = lineAngleDeg(from, to);
  const near = (target) => Math.min(Math.abs(deg - target), 360 - Math.abs(deg - target)) <= angleTolDeg;
  if (near(0) || near(180)) return 'Horizontal';
  if (near(90) || near(270)) return 'Vertical';
  return null;
}

// Pure: snaps `to` onto the axis implied by `kind`, relative to `from`, by
// setting the off-axis coordinate equal to `from`'s — so the committed line is
// truly axis-aligned (redundant-free) rather than a few-degrees-off yank.
// Returns a NEW point; never mutates `to`.
export function snapAxis(from, to, kind) {
  if (kind === 'Horizontal') return { x: to.x, y: from.y };
  if (kind === 'Vertical') return { x: from.x, y: to.y };
  return to;
}

// Pure: enriches a computeLineClickPlan() plan with what auto-constraining
// should do, given context the caller derived from the DOM/kernel state
// (autoConstrain toggle, whether the sketch was empty, whether this click
// landed near the origin). Returns a NEW plan; the original is untouched.
// When `autoConstrain` is false this is a no-op passthrough — applyLineClick
// never sees an autoCoincidentTo/axisKind/pinOriginCandidate field to act on.
export function planAutoConstraints(plan, ctx = {}) {
  const { autoConstrain = false, sketchEmpty = false, nearOrigin = false, angleTolDeg = AXIS_TOL_DEG } = ctx;
  if (!autoConstrain) return plan;
  if (plan.kind === 'start') {
    return { ...plan, pinOriginCandidate: sketchEmpty && nearOrigin && !plan.snap };
  }
  const axisKind = inferLineConstraint(plan.from, plan.to, angleTolDeg);
  const to = axisKind ? snapAxis(plan.from, plan.to, axisKind) : plan.to;
  const autoCoincidentTo = (!plan.closesTo && plan.toSnap) ? plan.toSnap : null;
  return { ...plan, to, axisKind, autoCoincidentTo };
}

// Executes a plan against a real (or fake) session. Returns
// { chain, gid, autoAdds } — `chain` is null when the plan closed the loop,
// `gid` is the geoId of the line just added (null for a 'start' plan, which
// adds no geometry yet), `autoAdds` lists the auto-constraints that were kept
// (already past the safety valve below).
//
// Safety valve (SPEC #4): each auto-constraint is added, the state re-read,
// and rolled back via session.delConstraint if `conflicting` grew because of
// it — `redundant` growth is fine and is never rolled back. `opts.log` is an
// optional (line) => void sink for the skip message; defaults to a no-op so
// this stays callable from a plain fake-session unit test with no DOM.
export function applyLineClick(session, sketchName, chain, plan, opts = {}) {
  const { log: logFn = () => {} } = opts;

  if (plan.kind === 'start') {
    return {
      chain: {
        startGeoId: plan.snap ? plan.snap.geoId : null,
        startPointPos: plan.snap ? plan.snap.pointPos : null,
        prevX: plan.point.x, prevY: plan.point.y,
        prevGeoId: plan.snap ? plan.snap.geoId : null,
        prevPointPos: plan.snap ? plan.snap.pointPos : null,
        pinOrigin: !!plan.pinOriginCandidate,
      },
      gid: null, autoAdds: [],
    };
  }

  const isFirstLineOfChain = chain.prevGeoId == null;
  const gid = session.sketchAddLine(sketchName, plan.from.x, plan.from.y, plan.to.x, plan.to.y);
  const autoAdds = [];

  // Lazily-read, threaded baseline: each auto-add's "after" reading becomes
  // the next auto-add's "before" reading, so a mis-attributed conflict from
  // an earlier add can't be blamed on a later one.
  let baseline = null;
  const readState = () => session.sketchState(sketchName);
  const tryAuto = (kind, addFn) => {
    if (!baseline) baseline = readState();
    const before = baseline.conflicting.length;
    const index = addFn();
    const after = readState();
    if (after.conflicting.length > before) {
      session.delConstraint(sketchName, index);
      baseline = readState();
      logFn(`auto-constraint skipped (would conflict): ${kind}`);
      return;
    }
    baseline = after;
    autoAdds.push({ index, kind });
  };

  if (plan.linkPrev) {
    session.constrainCoincident(sketchName, plan.linkPrev.geoId, plan.linkPrev.pointPos, gid, 1);
  }
  if (plan.axisKind) {
    tryAuto(plan.axisKind, () => (plan.axisKind === 'Horizontal'
      ? session.constrainHorizontal(sketchName, gid)
      : session.constrainVertical(sketchName, gid)));
  }
  if (plan.closesTo) {
    session.constrainCoincident(sketchName, gid, 2, plan.closesTo.geoId, plan.closesTo.pointPos);
  } else if (plan.autoCoincidentTo) {
    tryAuto('Coincident', () =>
      session.constrainCoincident(sketchName, gid, 2, plan.autoCoincidentTo.geoId, plan.autoCoincidentTo.pointPos));
  }
  if (chain.pinOrigin && isFirstLineOfChain) {
    tryAuto('PinOrigin', () => session.constrainPinOrigin(sketchName, gid, 1));
  }

  if (plan.closesTo) return { chain: null, gid, autoAdds };
  return {
    chain: {
      startGeoId: plan.setsStart ? gid : chain.startGeoId,
      startPointPos: plan.setsStart ? 1 : chain.startPointPos,
      prevX: plan.to.x, prevY: plan.to.y, prevGeoId: gid, prevPointPos: 2,
      pinOrigin: false, // already applied (or never applicable) — don't retry
    },
    gid, autoAdds,
  };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Pure: distance from `p` to the circle's stroke (0 = exactly on it).
function distToCircleStroke(p, center, r) {
  return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r);
}

// Pure: is world-space angle `theta` (radians) within the CCW sweep [a0, a1]?
// a1 may exceed a0 + 2*PI is never true (arcAnglesFromClicks caps the sweep
// under one full turn), so normalizing theta up into [a0, a0+2*PI) and
// comparing against a1 is exact.
function angleInArcRange(theta, a0, a1) {
  const twoPi = Math.PI * 2;
  const t = theta - Math.floor((theta - a0) / twoPi) * twoPi;
  return t <= a1 + 1e-9;
}

// Pure: center/start/end clicks -> {r, a0, a1} for session.sketchAddArc(),
// which wants radians, CCW from a0 to a1. `r` and `a0` come from the
// center->start vector; `a1` from the center->end vector, bumped by a full
// turn if it would otherwise sweep clockwise (a1 <= a0).
export function arcAnglesFromClicks(c1, c2, c3) {
  const r = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const a0 = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  let a1 = Math.atan2(c3.y - c1.y, c3.x - c1.x);
  if (a1 <= a0) a1 += Math.PI * 2;
  return { r, a0, a1 };
}

// Pure: samples `steps`+1 points along the arc (cx,cy,r,a0->a1), CCW. Used
// both for the live preview and to render every committed ArcOfCircle — a
// polyline avoids SVG's large-arc/sweep-flag ambiguity entirely.
export function sampleArc(cx, cy, r, a0, a1, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (a1 - a0) * (i / steps);
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

export function initSketchMode({ getSession, viewport, onEnter, onFinish }) {
  const svg = $('sketchSvg');
  const overlay = $('sketchOverlay');
  const gridLayer = $('gridLayer');
  const geomLayer = $('geomLayer');
  const rubberBand = $('rubberBand');
  const previewRect = $('previewRect');
  const previewCircle = $('previewCircle');
  const previewArc = $('previewArc');
  const previewEllipse = $('previewEllipse');
  const snapRing = $('snapRing');
  const axisHint = $('axisHint');
  const dofBadge = $('dofBadge');
  const dimInput = $('dimInput');
  const dimValue = $('dimValue');
  const dimLabel = $('dimLabel');

  const sess = () => getSession();
  // Default CHECKED per SPEC: missing element (older markup) still means "on".
  const isAutoConstrainOn = () => { const el = $('autoConstrain'); return !el || el.checked; };

  let sketchName = null;
  let tool = 'line';
  let chain = null;
  let toolClicks = []; // in-progress center/corner/start clicks for rect/circle/arc
  let selection = []; // [{geoId, pointPos|null}]
  let lastState = null;
  let dimTargetGeoId = null;
  let dimTargetKind = null; // 'distance' | 'radius' | 'distanceX' | 'distanceY' | 'angle'
  // Second reference for the two-argument dimensioned kinds above: a point
  // {geoId, pointPos} for distanceX/distanceY, a line geoId for angle. The
  // FIRST reference reuses dimTargetGeoId for angle (a line) but a point
  // for distanceX/distanceY needs its pointPos too, so those live in
  // dimTargetA instead -- dimTargetGeoId alone can't carry it.
  let dimTargetA = null;
  let dimTargetB = null;
  let gridDrawn = false;

  // -- coordinate mapping (screen px <-> world mm, Y-up) --------------------
  function worldFromEvent(evt) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };
  }
  function screenFromWorld(x, y) {
    const ctm = svg.getScreenCTM();
    const p = new DOMPoint(x, -y).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }
  // Same screen-px radius as vertex snapping (SNAP_PX) — the origin isn't a
  // real geometry vertex, so it isn't covered by findSnapVertex below.
  function isNearOriginScreen(evt) {
    const o = screenFromWorld(0, 0);
    return Math.hypot(o.x - evt.clientX, o.y - evt.clientY) < SNAP_PX;
  }

  // PointPos convention (matches fc-sketch.mjs's header comment): 1=start,
  // 2=end, 3=center. A Circle only has a center (3); an Arc has all three.
  function findSnapVertex(evt) {
    if (!lastState) return null;
    let best = null, bestDist = SNAP_PX;
    const consider = (geoId, pointPos, x, y) => {
      const s = screenFromWorld(x, y);
      const d = Math.hypot(s.x - evt.clientX, s.y - evt.clientY);
      if (d < bestDist) { bestDist = d; best = { geoId, pointPos, x, y }; }
    };
    for (const g of lastState.geometry) {
      if (g.type === 'LineSegment') {
        consider(g.id, 1, g.x1, g.y1);
        consider(g.id, 2, g.x2, g.y2);
      } else if (g.type === 'Circle') {
        consider(g.id, 3, g.cx, g.cy);
      } else if (g.type === 'ArcOfCircle') {
        consider(g.id, 1, g.x1, g.y1);
        consider(g.id, 2, g.x2, g.y2);
        consider(g.id, 3, g.cx, g.cy);
      } else if (g.type === 'Ellipse') {
        consider(g.id, 3, g.cx, g.cy); // centre only, matching Circle
      } else if (g.type === 'Point') {
        // A Point IS its own vertex (PointPos 1), which is the only way a
        // Symmetric/DistanceX/DistanceY can ever name it. Drawing it without
        // hit-testing it makes it decorative -- and undeletable, since
        // deleteSelection() reaches geometry through the selected corner.
        consider(g.id, 1, g.px, g.py);
      }
    }
    return best;
  }
  // Screen-space radius of a circle/arc at (cx,cy,r): project a point at
  // angle 0 and measure — exact under the fixed, unsheared viewBox this
  // slice uses (no independent x/y scale, no pan/zoom).
  function screenRadius(cx, cy, r) {
    const center = screenFromWorld(cx, cy);
    const edge = screenFromWorld(cx + r, cy);
    return Math.hypot(edge.x - center.x, edge.y - center.y);
  }
  function findShapeHit(evt) {
    if (!lastState) return null;
    let best = null, bestDist = HIT_PX;
    const world = worldFromEvent(evt);
    for (const g of lastState.geometry) {
      if (g.type === 'LineSegment') {
        const a = screenFromWorld(g.x1, g.y1);
        const b = screenFromWorld(g.x2, g.y2);
        const d = distToSegment({ x: evt.clientX, y: evt.clientY }, a, b);
        if (d < bestDist) { bestDist = d; best = { geoId: g.id, pointPos: null }; }
      } else if (g.type === 'Circle') {
        const center = screenFromWorld(g.cx, g.cy);
        const d = distToCircleStroke({ x: evt.clientX, y: evt.clientY }, center, screenRadius(g.cx, g.cy, g.r));
        if (d < bestDist) { bestDist = d; best = { geoId: g.id, pointPos: null }; }
      } else if (g.type === 'ArcOfCircle') {
        const center = screenFromWorld(g.cx, g.cy);
        const d = distToCircleStroke({ x: evt.clientX, y: evt.clientY }, center, screenRadius(g.cx, g.cy, g.r));
        if (d < bestDist) {
          const theta = Math.atan2(world.y - g.cy, world.x - g.cx);
          if (angleInArcRange(theta, g.a0, g.a1)) { bestDist = d; best = { geoId: g.id, pointPos: null }; }
        }
      }
      // Ellipse and Point are deliberately absent, unlike in findSnapVertex
      // above. A whole-shape pick only exists to feed a constraint that names
      // a whole shape, and nothing in this pass takes an ellipse that way (no
      // major/minor dimension constraint shipped); Delete already reaches an
      // ellipse through its selected centre. A Point has no stroke at all.
      // Add an ellipse branch here when a constraint needs one, not before --
      // it costs a rotated-frame distance, which is not free to get right.
    }
    return best;
  }

  // -- grid (drawn once) ------------------------------------------------------
  function gridLine(x1, y1, x2, y2, major) {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', -y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', -y2);
    l.setAttribute('stroke', 'var(--text)');
    l.setAttribute('stroke-width', major ? 0.15 : 0.04);
    l.setAttribute('opacity', major ? 0.18 : 0.07);
    return l;
  }
  function axisLine(x1, y1, x2, y2, color) {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', -y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', -y2);
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', 0.25);
    l.setAttribute('opacity', 0.85);
    return l;
  }
  function drawGridOnce() {
    if (gridDrawn || !gridLayer) return;
    gridDrawn = true;
    for (let i = VIEW_LO; i <= VIEW_HI; i += 1) {
      if (i === 0) continue; // axes drawn separately, on top
      const major = i % 10 === 0;
      gridLayer.appendChild(gridLine(i, VIEW_LO, i, VIEW_HI, major));
      gridLayer.appendChild(gridLine(VIEW_LO, i, VIEW_HI, i, major));
    }
    gridLayer.appendChild(axisLine(VIEW_LO, 0, VIEW_HI, 0, '#e0685a')); // X
    gridLayer.appendChild(axisLine(0, VIEW_LO, 0, VIEW_HI, '#5fbf8f')); // Y
    const origin = document.createElementNS(SVGNS, 'circle');
    origin.setAttribute('cx', 0); origin.setAttribute('cy', 0); origin.setAttribute('r', 1.1);
    origin.setAttribute('fill', 'var(--accent)');
    gridLayer.appendChild(origin);
  }

  // -- geometry + selection redraw --------------------------------------------
  function appendVertex(geoId, pointPos, x, y) {
    const ptSel = selection.some((s) => s.geoId === geoId && s.pointPos === pointPos);
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', -y); c.setAttribute('r', 0.9);
    c.setAttribute('class', ptSel ? 'sk-vertex sk-vertex-sel' : 'sk-vertex');
    geomLayer.appendChild(c);
  }
  function redrawGeometry() {
    if (!geomLayer || !lastState) return;
    geomLayer.replaceChildren();
    for (const g of lastState.geometry) {
      const shapeSel = selection.some((s) => s.geoId === g.id && s.pointPos == null);
      const shapeClass = shapeSel ? 'sk-line sk-line-sel' : 'sk-line';
      if (g.type === 'LineSegment') {
        const line = document.createElementNS(SVGNS, 'line');
        line.setAttribute('x1', g.x1); line.setAttribute('y1', -g.y1);
        line.setAttribute('x2', g.x2); line.setAttribute('y2', -g.y2);
        line.setAttribute('class', shapeClass);
        geomLayer.appendChild(line);
        appendVertex(g.id, 1, g.x1, g.y1);
        appendVertex(g.id, 2, g.x2, g.y2);
      } else if (g.type === 'Circle') {
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', g.cx); c.setAttribute('cy', -g.cy); c.setAttribute('r', g.r);
        c.setAttribute('class', shapeClass);
        geomLayer.appendChild(c);
        appendVertex(g.id, 3, g.cx, g.cy);
      } else if (g.type === 'ArcOfCircle') {
        const pts = sampleArc(g.cx, g.cy, g.r, g.a0, g.a1);
        const poly = document.createElementNS(SVGNS, 'polyline');
        poly.setAttribute('points', pts.map((p) => `${p.x},${-p.y}`).join(' '));
        poly.setAttribute('class', shapeClass);
        geomLayer.appendChild(poly);
        appendVertex(g.id, 1, g.x1, g.y1);
        appendVertex(g.id, 2, g.x2, g.y2);
        appendVertex(g.id, 3, g.cx, g.cy);
      } else if (g.type === 'Ellipse') {
        const e = document.createElementNS(SVGNS, 'ellipse');
        e.setAttribute('cx', g.cx); e.setAttribute('cy', -g.cy);
        e.setAttribute('rx', g.rx); e.setAttribute('ry', g.ry);
        e.setAttribute('class', shapeClass);
        // Every branch here draws at -y because SVG's Y axis points down
        // while the sketch's points up. That flip reverses the sense of
        // rotation too, so AngleXU (counter-clockwise in sketch coordinates)
        // becomes a clockwise SVG rotation -- hence the sign flip below.
        e.setAttribute('transform', `rotate(${-g.ang * 180 / Math.PI} ${g.cx} ${-g.cy})`);
        geomLayer.appendChild(e);
        appendVertex(g.id, 3, g.cx, g.cy);
      } else if (g.type === 'Point') {
        // Route through appendVertex like every other type's vertices, not a
        // bare circle -- otherwise Symmetric/DistanceX/DistanceY can never
        // name it, which is the whole reason the tool exists.
        appendVertex(g.id, 1, g.px, g.py);
      }
      // else: an unrecognized future geometry type — skip rather than crash.
    }
  }

  function updateDofBadge() {
    if (!dofBadge || !lastState) return;
    dofBadge.classList.remove('dof-ok', 'dof-warn', 'dof-bad');
    if (lastState.conflicting && lastState.conflicting.length > 0) {
      // Conflicting constraints only carry indices, not the geometry they
      // reference, so highlighting the offending lines isn't cheap here —
      // TODO: cross-reference sk.Constraints args once fc-sketch exposes them.
      dofBadge.textContent = 'Over-constrained';
      dofBadge.classList.add('dof-bad');
    } else if (lastState.fully) {
      dofBadge.textContent = 'Fully constrained ✓';
      dofBadge.classList.add('dof-ok');
    } else {
      dofBadge.textContent = `${lastState.dof} DoF`;
      dofBadge.classList.add('dof-warn');
    }
  }

  // "shape" selections are whole-geometry (pointPos==null) — a line, circle,
  // or arc; renamed from selLines() now that it covers all three kinds.
  function selShapes() { return selection.filter((s) => s.pointPos == null); }
  function selPoints() { return selection.filter((s) => s.pointPos != null); }
  // World coordinates of a selected POINT {geoId, pointPos}. PointPos
  // convention per fc-sketch.mjs's own header: 1=start, 2=end, 3=center.
  function pointWorld(sel) {
    const g = lastState && lastState.geometry.find((x) => x.id === sel.geoId);
    if (!g) return { x: 0, y: 0 };
    if (sel.pointPos === 2) return { x: g.x2, y: g.y2 };
    if (sel.pointPos === 3) return { x: g.cx, y: g.cy };
    return { x: g.x1, y: g.y1 };
  }
  function geomType(geoId) {
    const g = lastState && lastState.geometry.find((x) => x.id === geoId);
    return g ? g.type : null;
  }
  function setEnabled(id, enabled) { const el = $(id); if (el) el.disabled = !enabled; }
  function updateConstraintButtons() {
    const shapes = selShapes(), points = selPoints();
    const types = shapes.map((s) => geomType(s.geoId));
    const oneLine = types.length === 1 && types[0] === 'LineSegment' && points.length === 0;
    const oneCircle = types.length === 1 && types[0] === 'Circle' && points.length === 0;
    const oneArc = types.length === 1 && types[0] === 'ArcOfCircle' && points.length === 0;
    const twoLines = types.length === 2 && types.every((t) => t === 'LineSegment') && points.length === 0;
    const twoPoints = points.length === 2 && shapes.length === 0;
    const threePoints = points.length === 3 && shapes.length === 0;
    setEnabled('cHoriz', oneLine);
    setEnabled('cVert', oneLine);
    setEnabled('cDim', oneLine || oneCircle || oneArc);
    setEnabled('cCoin', twoPoints);
    setEnabled('cPar', twoLines);
    setEnabled('cPerp', twoLines);
    setEnabled('cEq', twoLines);
    setEnabled('cSym', threePoints);
    setEnabled('cDistX', twoPoints);
    setEnabled('cDistY', twoPoints);
    setEnabled('cAngle', twoLines);
    setEnabled('cDelete', selection.length > 0);
  }

  function refresh() {
    if (!sketchName) return;
    guardOp(() => {
      lastState = sess().sketchState(sketchName);
      redrawGeometry();
      updateDofBadge();
      updateConstraintButtons();
    });
  }

  // -- rubber-band + auto-constraint preview hints -----------------------------
  function setLineWorld(el, x1, y1, x2, y2) {
    el.setAttribute('x1', x1); el.setAttribute('y1', -y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', -y2);
  }
  function hideHints() {
    if (rubberBand) rubberBand.hidden = true;
    if (previewRect) previewRect.hidden = true;
    if (previewCircle) previewCircle.hidden = true;
    if (previewArc) previewArc.hidden = true;
    if (previewEllipse) previewEllipse.hidden = true;
    if (snapRing) snapRing.hidden = true;
    if (axisHint) axisHint.hidden = true;
  }
  const hideRubberBand = hideHints; // kept as an alias: same call sites as before
  function updateSnapHint(snap, axisKind, pt) {
    if (snapRing) {
      if (snap) {
        snapRing.setAttribute('cx', snap.x); snapRing.setAttribute('cy', -snap.y);
        snapRing.hidden = false;
      } else snapRing.hidden = true;
    }
    if (axisHint) {
      if (axisKind) {
        axisHint.setAttribute('x', pt.x + 1.5); axisHint.setAttribute('y', -pt.y - 1.5);
        axisHint.textContent = axisKind === 'Horizontal' ? '—' : '|';
        axisHint.hidden = false;
      } else axisHint.hidden = true;
    }
  }

  // -- tool switching -----------------------------------------------------------
  function setTool(t) {
    tool = t; chain = null; toolClicks = []; hideHints();
    for (const id of ['toolLine', 'toolSelect', 'toolRect', 'toolCircle', 'toolArc', 'toolEllipse', 'toolPoint']) {
      $(id)?.classList.toggle('active', id === `tool${t[0].toUpperCase()}${t.slice(1)}`);
    }
    svg.style.cursor = t === 'select' ? 'default' : 'crosshair';
    if (t !== 'select') { selection = []; redrawGeometry(); updateConstraintButtons(); }
  }

  // -- line tool ------------------------------------------------------------
  function onLineToolClick(evt) {
    const snap = findSnapVertex(evt);
    const world = worldFromEvent(evt);
    const rawPlan = computeLineClickPlan(chain, snap, world);
    const sketchEmpty = !lastState || lastState.geometry.length === 0;
    const nearOrigin = rawPlan.kind === 'start' && isNearOriginScreen(evt);
    const plan = planAutoConstraints(rawPlan, { autoConstrain: isAutoConstrainOn(), sketchEmpty, nearOrigin });

    if (plan.kind === 'start') {
      chain = applyLineClick(sess(), sketchName, chain, plan).chain;
      return;
    }
    guardOp(() => {
      const result = applyLineClick(sess(), sketchName, chain, plan, { log });
      chain = result.chain;
      hideHints();
      refresh();
    });
  }
  function endChainNoClose() { chain = null; hideHints(); }

  // -- select tool ------------------------------------------------------------
  function onSelectToolClick(evt) {
    const hit = findSnapVertex(evt) ?? findShapeHit(evt);
    if (!evt.shiftKey) selection = [];
    if (hit) {
      const key = { geoId: hit.geoId, pointPos: hit.pointPos ?? null };
      const idx = selection.findIndex((s) => s.geoId === key.geoId && s.pointPos === key.pointPos);
      if (idx >= 0) selection.splice(idx, 1); else selection.push(key);
    }
    redrawGeometry();
    updateConstraintButtons();
  }

  // -- rectangle / circle / arc tools (2/2/3 clicks) --------------------------
  // Only the FIRST click of circle/arc snaps onto an existing vertex (center
  // snap, per SPEC) — the radius/end clicks are always raw world points.
  function onRectToolClick(evt) {
    const world = worldFromEvent(evt);
    if (toolClicks.length === 0) { toolClicks = [world]; return; }
    guardOp(() => {
      const [c1] = toolClicks;
      sess().sketchAddRectangle(sketchName, c1.x, c1.y, world.x, world.y);
      toolClicks = [];
      hideHints();
      refresh();
    });
  }
  function onCircleToolClick(evt) {
    if (toolClicks.length === 0) {
      const snap = findSnapVertex(evt);
      toolClicks = [snap ? { x: snap.x, y: snap.y } : worldFromEvent(evt)];
      return;
    }
    const world = worldFromEvent(evt);
    guardOp(() => {
      const [c] = toolClicks;
      const r = Math.hypot(world.x - c.x, world.y - c.y);
      sess().sketchAddCircle(sketchName, c.x, c.y, r);
      toolClicks = [];
      hideHints();
      refresh();
    });
  }
  function onArcToolClick(evt) {
    if (toolClicks.length === 0) {
      const snap = findSnapVertex(evt);
      toolClicks = [snap ? { x: snap.x, y: snap.y } : worldFromEvent(evt)];
      return;
    }
    if (toolClicks.length === 1) { toolClicks = [toolClicks[0], worldFromEvent(evt)]; return; }
    guardOp(() => {
      const [c1, c2] = toolClicks;
      const { r, a0, a1 } = arcAnglesFromClicks(c1, c2, worldFromEvent(evt));
      sess().sketchAddArc(sketchName, c1.x, c1.y, r, a0, a1);
      toolClicks = [];
      hideHints();
      refresh();
    });
  }
  function onEllipseToolClick(evt) {
    if (toolClicks.length === 0) {
      const snap = findSnapVertex(evt);
      toolClicks = [snap ? { x: snap.x, y: snap.y } : worldFromEvent(evt)];
      return;
    }
    if (toolClicks.length === 1) { toolClicks = [toolClicks[0], worldFromEvent(evt)]; return; }
    guardOp(() => {
      const [c, rxPoint] = toolClicks;
      const rx = Math.abs(rxPoint.x - c.x);
      const ry = Math.abs(worldFromEvent(evt).y - c.y);
      sess().sketchAddEllipse(sketchName, c.x, c.y, rx, ry);
      toolClicks = [];
      hideHints();
      refresh();
    });
  }
  function onPointToolClick(evt) {
    const world = worldFromEvent(evt);
    guardOp(() => {
      sess().sketchAddPoint(sketchName, world.x, world.y);
      refresh();
    });
  }
  function updateRectPreview(evt) {
    if (!previewRect) return;
    if (toolClicks.length !== 1) { previewRect.hidden = true; return; }
    const c1 = toolClicks[0], w = worldFromEvent(evt);
    const x = Math.min(c1.x, w.x), y = Math.min(c1.y, w.y);
    previewRect.setAttribute('x', x); previewRect.setAttribute('y', -(y + Math.abs(w.y - c1.y)));
    previewRect.setAttribute('width', Math.abs(w.x - c1.x));
    previewRect.setAttribute('height', Math.abs(w.y - c1.y));
    previewRect.hidden = false;
  }
  function updateCirclePreview(evt) {
    if (!previewCircle) return;
    if (toolClicks.length !== 1) { previewCircle.hidden = true; return; }
    const c = toolClicks[0], w = worldFromEvent(evt);
    previewCircle.setAttribute('cx', c.x); previewCircle.setAttribute('cy', -c.y);
    previewCircle.setAttribute('r', Math.hypot(w.x - c.x, w.y - c.y));
    previewCircle.hidden = false;
  }
  function updateArcPreview(evt) {
    if (!previewArc) return;
    if (toolClicks.length !== 2) { previewArc.hidden = true; return; }
    const [c1, c2] = toolClicks;
    const { r, a0, a1 } = arcAnglesFromClicks(c1, c2, worldFromEvent(evt));
    previewArc.setAttribute('points', sampleArc(c1.x, c1.y, r, a0, a1).map((p) => `${p.x},${-p.y}`).join(' '));
    previewArc.hidden = false;
  }
  function updateEllipsePreview(evt) {
    if (!previewEllipse) return;
    if (toolClicks.length === 0) { previewEllipse.hidden = true; return; }
    const c = toolClicks[0], w = worldFromEvent(evt);
    previewEllipse.setAttribute('cx', c.x); previewEllipse.setAttribute('cy', -c.y);
    if (toolClicks.length === 1) {
      const rx = Math.abs(w.x - c.x);
      previewEllipse.setAttribute('rx', rx); previewEllipse.setAttribute('ry', rx);
    } else {
      const rx = Math.abs(toolClicks[1].x - c.x);
      previewEllipse.setAttribute('rx', rx); previewEllipse.setAttribute('ry', Math.abs(w.y - c.y));
    }
    previewEllipse.hidden = false;
  }

  // -- delete ------------------------------------------------------------------
  // geoIds renumber after each sketchDelGeometry() call, so delete in
  // descending order and never reuse an id once a lower one has been removed.
  function deleteSelection() {
    if (!selection.length) return;
    guardOp(() => {
      const ids = [...new Set(selection.map((s) => s.geoId))].sort((a, b) => b - a);
      for (const gid of ids) sess().sketchDelGeometry(sketchName, gid);
      selection = [];
      refresh();
    });
  }

  // -- constraints ------------------------------------------------------------
  function applyConstraint(fn) {
    guardOp(() => { fn(); selection = []; refresh(); });
  }
  function hideDim() {
    if (dimInput) dimInput.hidden = true;
    dimTargetGeoId = null; dimTargetKind = null; dimTargetA = null; dimTargetB = null;
  }

  on('toolLine', 'click', () => setTool('line'));
  on('toolSelect', 'click', () => setTool('select'));
  on('toolRect', 'click', () => setTool('rect'));
  on('toolCircle', 'click', () => setTool('circle'));
  on('toolArc', 'click', () => setTool('arc'));
  on('toolEllipse', 'click', () => setTool('ellipse'));
  on('toolPoint', 'click', () => setTool('point'));

  on('cHoriz', 'click', () => applyConstraint(() => sess().constrainHorizontal(sketchName, selShapes()[0].geoId)));
  on('cVert', 'click', () => applyConstraint(() => sess().constrainVertical(sketchName, selShapes()[0].geoId)));
  on('cPar', 'click', () => applyConstraint(() => {
    const [a, b] = selShapes(); return sess().constrainParallel(sketchName, a.geoId, b.geoId);
  }));
  on('cPerp', 'click', () => applyConstraint(() => {
    const [a, b] = selShapes(); return sess().constrainPerpendicular(sketchName, a.geoId, b.geoId);
  }));
  on('cEq', 'click', () => applyConstraint(() => {
    const [a, b] = selShapes(); return sess().constrainEqual(sketchName, a.geoId, b.geoId);
  }));
  on('cCoin', 'click', () => applyConstraint(() => {
    const [a, b] = selPoints(); return sess().constrainCoincident(sketchName, a.geoId, a.pointPos, b.geoId, b.pointPos);
  }));
  on('cSym', 'click', () => applyConstraint(() => {
    // Third selected point is the one the other two are symmetric ABOUT --
    // same "last selected is the pivot" convention selPoints() order gives
    // cCoin above, just with one more point.
    const [a, b, c] = selPoints();
    return sess().constrainSymmetric(sketchName, a.geoId, a.pointPos, b.geoId, b.pointPos, c.geoId, c.pointPos);
  }));
  // The popup field label: 'angle' types in degrees, 'radius' types a
  // radius, everything else (distance/distanceX/distanceY) types a length.
  function dimLabelFor(kind) {
    if (kind === 'angle') return 'Angle';
    if (kind === 'radius') return 'Radius';
    return 'Length';
  }
  on('cDistX', 'click', () => {
    const [a, b] = selPoints();
    if (!a || !b || !lastState || !dimInput || !dimValue) return;
    const pa = pointWorld(a), pb = pointWorld(b);
    dimTargetKind = 'distanceX'; dimTargetA = a; dimTargetB = b;
    dimValue.value = (pb.x - pa.x).toFixed(2);
    if (dimLabel) dimLabel.textContent = dimLabelFor(dimTargetKind);
    dimInput.hidden = false;
    dimValue.focus(); dimValue.select();
  });
  on('cDistY', 'click', () => {
    const [a, b] = selPoints();
    if (!a || !b || !lastState || !dimInput || !dimValue) return;
    const pa = pointWorld(a), pb = pointWorld(b);
    dimTargetKind = 'distanceY'; dimTargetA = a; dimTargetB = b;
    dimValue.value = (pb.y - pa.y).toFixed(2);
    if (dimLabel) dimLabel.textContent = dimLabelFor(dimTargetKind);
    dimInput.hidden = false;
    dimValue.focus(); dimValue.select();
  });
  on('cAngle', 'click', () => {
    const [a, b] = selShapes();
    if (!a || !b || !lastState || !dimInput || !dimValue) return;
    const ga = lastState.geometry.find((x) => x.id === a.geoId);
    const gb = lastState.geometry.find((x) => x.id === b.geoId);
    if (!ga || !gb) return;
    // NOTE the shape change: distanceX/distanceY store the whole picked POINT
    // ({geoId, pointPos}) because FreeCAD's DistanceX wants both halves, while
    // Angle names two LINES and takes bare geoIds. So dimTargetA/B hold
    // different shapes depending on dimTargetKind, and dimOk unpacks each kind
    // its own way. Said here because the assignment is where it would
    // otherwise look like an inconsistency rather than a deliberate one.
    dimTargetKind = 'angle'; dimTargetA = a.geoId; dimTargetB = b.geoId;
    const ax = ga.x2 - ga.x1, ay = ga.y2 - ga.y1;
    const bx = gb.x2 - gb.x1, by = gb.y2 - gb.y1;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * (180 / Math.PI);
    dimValue.value = turn.toFixed(2);
    if (dimLabel) dimLabel.textContent = dimLabelFor(dimTargetKind);
    dimInput.hidden = false;
    dimValue.focus(); dimValue.select();
  });
  on('cDim', 'click', () => {
    const shape = selShapes()[0];
    if (!shape || !lastState || !dimInput || !dimValue) return;
    const g = lastState.geometry.find((x) => x.id === shape.geoId);
    if (!g) return;
    dimTargetGeoId = shape.geoId;
    dimTargetKind = g.type === 'LineSegment' ? 'distance' : 'radius'; // circle or arc -> radius
    dimValue.value = (dimTargetKind === 'distance' ? Math.hypot(g.x2 - g.x1, g.y2 - g.y1) : g.r).toFixed(2);
    if (dimLabel) dimLabel.textContent = dimLabelFor(dimTargetKind);
    dimInput.hidden = false;
    dimValue.focus(); dimValue.select();
  });
  on('dimOk', 'click', () => {
    const v = Number(dimValue?.value);
    // distanceX/distanceY/angle are SIGNED (a negative gap or a negative
    // turn is a real, distinct ask -- see packages/sketch's own distanceY
    // test), so only distance/radius keep the positive-only rule.
    const signed = dimTargetKind === 'distanceX' || dimTargetKind === 'distanceY' || dimTargetKind === 'angle';
    if (!Number.isFinite(v) || (!signed && v <= 0)) {
      log(signed ? '✗ dimension: enter a number' : '✗ dimension: enter a positive number');
      return;
    }
    applyConstraint(() => {
      if (dimTargetKind === 'radius') return sess().constrainRadius(sketchName, dimTargetGeoId, v);
      if (dimTargetKind === 'distanceX') {
        return sess().constrainDistanceX(sketchName, dimTargetA.geoId, dimTargetA.pointPos, dimTargetB.geoId, dimTargetB.pointPos, v);
      }
      if (dimTargetKind === 'distanceY') {
        return sess().constrainDistanceY(sketchName, dimTargetA.geoId, dimTargetA.pointPos, dimTargetB.geoId, dimTargetB.pointPos, v);
      }
      if (dimTargetKind === 'angle') return sess().constrainAngle(sketchName, dimTargetA, dimTargetB, v);
      return sess().constrainDistance(sketchName, dimTargetGeoId, 1, dimTargetGeoId, 2, v);
    });
    hideDim();
  });
  on('dimCancel', 'click', hideDim);
  on('cDelete', 'click', deleteSelection);

  // -- canvas pointer/keyboard wiring ------------------------------------------
  svg.addEventListener('click', (evt) => {
    if (!sketchName) return;
    if (tool === 'line') onLineToolClick(evt);
    else if (tool === 'select') onSelectToolClick(evt);
    else if (tool === 'rect') onRectToolClick(evt);
    else if (tool === 'circle') onCircleToolClick(evt);
    else if (tool === 'arc') onArcToolClick(evt);
    else if (tool === 'ellipse') onEllipseToolClick(evt);
    else if (tool === 'point') onPointToolClick(evt);
  });
  svg.addEventListener('pointermove', (evt) => {
    if (!sketchName) return;
    if (tool === 'rect') return updateRectPreview(evt);
    if (tool === 'circle') return updateCirclePreview(evt);
    if (tool === 'arc') return updateArcPreview(evt);
    if (tool === 'ellipse') return updateEllipsePreview(evt);
    if (tool !== 'line' || !chain || !rubberBand) return;
    const snap = findSnapVertex(evt);
    const world = worldFromEvent(evt);
    let pt = snap ? { x: snap.x, y: snap.y } : world;
    let axisKind = null;
    // A vertex snap wins over an axis snap — matches applyLineClick, where
    // autoCoincidentTo is only considered when there's no closer vertex hit.
    if (isAutoConstrainOn() && !snap) {
      const from = { x: chain.prevX, y: chain.prevY };
      axisKind = inferLineConstraint(from, pt);
      if (axisKind) pt = snapAxis(from, pt, axisKind);
    }
    setLineWorld(rubberBand, chain.prevX, chain.prevY, pt.x, pt.y);
    rubberBand.hidden = false;
    updateSnapHint(snap, axisKind, pt);
  });
  svg.addEventListener('dblclick', () => { if (tool === 'line') endChainNoClose(); });
  document.addEventListener('keydown', (evt) => {
    if (!sketchName) return;
    // Don't hijack Backspace/Escape/Enter while the user is typing a
    // dimension (or any other input) — only the canvas tools own these keys.
    const tag = evt.target && evt.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (evt.key === 'Escape' || evt.key === 'Enter') {
      if (tool === 'line') endChainNoClose();
      else if (toolClicks.length) { toolClicks = []; hideHints(); }
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && tool === 'select') {
      deleteSelection();
    }
  });

  // -- entry / exit -------------------------------------------------------------
  function enter(name) {
    sketchName = name;
    chain = null; selection = [];
    setTool('line');
    if (overlay) overlay.hidden = false;
    viewport.classList.add('sketching');
    drawGridOnce();
    refresh();
    if (typeof onEnter === 'function') onEnter();
  }
  function exit() {
    const finishedName = sketchName;
    if (overlay) overlay.hidden = true;
    viewport.classList.remove('sketching');
    sketchName = null; chain = null; selection = [];
    hideRubberBand(); hideDim();
    if (typeof onFinish === 'function') onFinish(finishedName);
  }

  return { enter, exit };
}
