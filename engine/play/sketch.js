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
// Out of scope for this slice (see SPEC): arcs/circles, auto constraints,
// delete/trim, on-canvas constraint glyphs, pan/zoom, click-to-edit an
// existing dimension. sketchState() can return circles (cx/cy/r) once that
// lands — they're skipped below (TODO markers) rather than crashing on them.

const SVGNS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 8;
const HIT_PX = 6;
const VIEW_LO = -15;
const VIEW_HI = 95;

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
    linkPrev: chain.prevGeoId != null ? { geoId: chain.prevGeoId, pointPos: chain.prevPointPos } : null,
    setsStart: chain.startGeoId == null,
    closesTo,
  };
}

// Executes a plan against a real (or fake) session; returns the next chain
// state, or null when the plan closed the loop (chain ends).
export function applyLineClick(session, sketchName, chain, plan) {
  if (plan.kind === 'start') {
    return {
      startGeoId: plan.snap ? plan.snap.geoId : null,
      startPointPos: plan.snap ? plan.snap.pointPos : null,
      prevX: plan.point.x, prevY: plan.point.y,
      prevGeoId: plan.snap ? plan.snap.geoId : null,
      prevPointPos: plan.snap ? plan.snap.pointPos : null,
    };
  }
  const gid = session.sketchAddLine(sketchName, plan.from.x, plan.from.y, plan.to.x, plan.to.y);
  if (plan.linkPrev) {
    session.constrainCoincident(sketchName, plan.linkPrev.geoId, plan.linkPrev.pointPos, gid, 1);
  }
  if (plan.closesTo) {
    session.constrainCoincident(sketchName, gid, 2, plan.closesTo.geoId, plan.closesTo.pointPos);
    return null;
  }
  return {
    startGeoId: plan.setsStart ? gid : chain.startGeoId,
    startPointPos: plan.setsStart ? 1 : chain.startPointPos,
    prevX: plan.to.x, prevY: plan.to.y, prevGeoId: gid, prevPointPos: 2,
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

export function initSketchMode({ getSession, viewport, onEnter, onFinish }) {
  const svg = $('sketchSvg');
  const overlay = $('sketchOverlay');
  const gridLayer = $('gridLayer');
  const geomLayer = $('geomLayer');
  const rubberBand = $('rubberBand');
  const dofBadge = $('dofBadge');
  const dimInput = $('dimInput');
  const dimValue = $('dimValue');

  const sess = () => getSession();

  let sketchName = null;
  let tool = 'line';
  let chain = null;
  let selection = []; // [{geoId, pointPos|null}]
  let lastState = null;
  let dimTargetGeoId = null;
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

  function findSnapVertex(evt) {
    if (!lastState) return null;
    let best = null, bestDist = SNAP_PX;
    for (const g of lastState.geometry) {
      if (g.type !== 'LineSegment') continue; // circles: later slice
      for (const [pointPos, x, y] of [[1, g.x1, g.y1], [2, g.x2, g.y2]]) {
        const s = screenFromWorld(x, y);
        const d = Math.hypot(s.x - evt.clientX, s.y - evt.clientY);
        if (d < bestDist) { bestDist = d; best = { geoId: g.id, pointPos, x, y }; }
      }
    }
    return best;
  }
  function findLineHit(evt) {
    if (!lastState) return null;
    let best = null, bestDist = HIT_PX;
    for (const g of lastState.geometry) {
      if (g.type !== 'LineSegment') continue;
      const a = screenFromWorld(g.x1, g.y1);
      const b = screenFromWorld(g.x2, g.y2);
      const d = distToSegment({ x: evt.clientX, y: evt.clientY }, a, b);
      if (d < bestDist) { bestDist = d; best = { geoId: g.id, pointPos: null }; }
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
  function redrawGeometry() {
    if (!geomLayer || !lastState) return;
    geomLayer.replaceChildren();
    for (const g of lastState.geometry) {
      if (g.type !== 'LineSegment') continue; // TODO: circles, phase 2b
      const lineSel = selection.some((s) => s.geoId === g.id && s.pointPos == null);
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', g.x1); line.setAttribute('y1', -g.y1);
      line.setAttribute('x2', g.x2); line.setAttribute('y2', -g.y2);
      line.setAttribute('class', lineSel ? 'sk-line sk-line-sel' : 'sk-line');
      geomLayer.appendChild(line);
      for (const [pointPos, x, y] of [[1, g.x1, g.y1], [2, g.x2, g.y2]]) {
        const ptSel = selection.some((s) => s.geoId === g.id && s.pointPos === pointPos);
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', -y); c.setAttribute('r', 0.9);
        c.setAttribute('class', ptSel ? 'sk-vertex sk-vertex-sel' : 'sk-vertex');
        geomLayer.appendChild(c);
      }
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

  function selLines() { return selection.filter((s) => s.pointPos == null); }
  function selPoints() { return selection.filter((s) => s.pointPos != null); }
  function setEnabled(id, enabled) { const el = $(id); if (el) el.disabled = !enabled; }
  function updateConstraintButtons() {
    const lines = selLines(), points = selPoints();
    const oneLine = lines.length === 1 && points.length === 0;
    const twoLines = lines.length === 2 && points.length === 0;
    const twoPoints = points.length === 2 && lines.length === 0;
    setEnabled('cHoriz', oneLine);
    setEnabled('cVert', oneLine);
    setEnabled('cDim', oneLine);
    setEnabled('cCoin', twoPoints);
    setEnabled('cPar', twoLines);
    setEnabled('cPerp', twoLines);
    setEnabled('cEq', twoLines);
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

  // -- rubber-band preview -----------------------------------------------------
  function setLineWorld(el, x1, y1, x2, y2) {
    el.setAttribute('x1', x1); el.setAttribute('y1', -y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', -y2);
  }
  function hideRubberBand() { if (rubberBand) rubberBand.hidden = true; }

  // -- tool switching -----------------------------------------------------------
  function setTool(t) {
    tool = t; chain = null; hideRubberBand();
    $('toolLine')?.classList.toggle('active', t === 'line');
    $('toolSelect')?.classList.toggle('active', t === 'select');
    svg.style.cursor = t === 'line' ? 'crosshair' : 'default';
    if (t !== 'select') { selection = []; redrawGeometry(); updateConstraintButtons(); }
  }

  // -- line tool ------------------------------------------------------------
  function onLineToolClick(evt) {
    const snap = findSnapVertex(evt);
    const world = worldFromEvent(evt);
    const plan = computeLineClickPlan(chain, snap, world);
    if (plan.kind === 'start') { chain = applyLineClick(sess(), sketchName, chain, plan); return; }
    guardOp(() => {
      chain = applyLineClick(sess(), sketchName, chain, plan);
      hideRubberBand();
      refresh();
    });
  }
  function endChainNoClose() { chain = null; hideRubberBand(); }

  // -- select tool ------------------------------------------------------------
  function onSelectToolClick(evt) {
    const hit = findSnapVertex(evt) ?? findLineHit(evt);
    if (!evt.shiftKey) selection = [];
    if (hit) {
      const key = { geoId: hit.geoId, pointPos: hit.pointPos ?? null };
      const idx = selection.findIndex((s) => s.geoId === key.geoId && s.pointPos === key.pointPos);
      if (idx >= 0) selection.splice(idx, 1); else selection.push(key);
    }
    redrawGeometry();
    updateConstraintButtons();
  }

  // -- constraints ------------------------------------------------------------
  function applyConstraint(fn) {
    guardOp(() => { fn(); selection = []; refresh(); });
  }
  function hideDim() { if (dimInput) dimInput.hidden = true; dimTargetGeoId = null; }

  on('toolLine', 'click', () => setTool('line'));
  on('toolSelect', 'click', () => setTool('select'));

  on('cHoriz', 'click', () => applyConstraint(() => sess().constrainHorizontal(sketchName, selLines()[0].geoId)));
  on('cVert', 'click', () => applyConstraint(() => sess().constrainVertical(sketchName, selLines()[0].geoId)));
  on('cPar', 'click', () => applyConstraint(() => {
    const [a, b] = selLines(); return sess().constrainParallel(sketchName, a.geoId, b.geoId);
  }));
  on('cPerp', 'click', () => applyConstraint(() => {
    const [a, b] = selLines(); return sess().constrainPerpendicular(sketchName, a.geoId, b.geoId);
  }));
  on('cEq', 'click', () => applyConstraint(() => {
    const [a, b] = selLines(); return sess().constrainEqual(sketchName, a.geoId, b.geoId);
  }));
  on('cCoin', 'click', () => applyConstraint(() => {
    const [a, b] = selPoints(); return sess().constrainCoincident(sketchName, a.geoId, a.pointPos, b.geoId, b.pointPos);
  }));
  on('cDim', 'click', () => {
    const line = selLines()[0];
    if (!line || !lastState || !dimInput || !dimValue) return;
    dimTargetGeoId = line.geoId;
    const g = lastState.geometry.find((x) => x.id === line.geoId);
    dimValue.value = g ? Math.hypot(g.x2 - g.x1, g.y2 - g.y1).toFixed(2) : '';
    dimInput.hidden = false;
    dimValue.focus(); dimValue.select();
  });
  on('dimOk', 'click', () => {
    const v = Number(dimValue?.value);
    if (!Number.isFinite(v) || v <= 0) { log('✗ dimension: enter a positive number'); return; }
    applyConstraint(() => sess().constrainDistance(sketchName, dimTargetGeoId, 1, dimTargetGeoId, 2, v));
    hideDim();
  });
  on('dimCancel', 'click', hideDim);

  // -- canvas pointer/keyboard wiring ------------------------------------------
  svg.addEventListener('click', (evt) => {
    if (!sketchName) return;
    if (tool === 'line') onLineToolClick(evt);
    else if (tool === 'select') onSelectToolClick(evt);
  });
  svg.addEventListener('pointermove', (evt) => {
    if (!sketchName || tool !== 'line' || !chain || !rubberBand) return;
    const snap = findSnapVertex(evt);
    const world = worldFromEvent(evt);
    const pt = snap ? { x: snap.x, y: snap.y } : world;
    setLineWorld(rubberBand, chain.prevX, chain.prevY, pt.x, pt.y);
    rubberBand.hidden = false;
  });
  svg.addEventListener('dblclick', () => { if (tool === 'line') endChainNoClose(); });
  document.addEventListener('keydown', (evt) => {
    if (!sketchName || tool !== 'line') return;
    if (evt.key === 'Escape' || evt.key === 'Enter') endChainNoClose();
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
