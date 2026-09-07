// engine/play/studio.js
//
// The clickable modeler: the same browser kernel loader as play.js, but driven
// through the command bridge (createFcSession + attachCommands) instead of a
// one-shot script. Toolbar buttons call typed PartDesign commands; after each,
// the tip solid's mesh is read back and rendered, and the feature tree panel
// is refreshed. This is the step-③ "wire the modeler to the GUI" payoff.

import { createFcSession } from '/bridge/fc-session.mjs';
import { attachCommands } from '/bridge/fc-commands.mjs';
import { attachSketchCommands } from '/bridge/fc-sketch.mjs';
import { initSketchMode } from './sketch.js';
import { initPick3d } from './pick3d.js';

// Track U #5 fix. The FreeCAD-web port emits "promising main" glue that reads a
// bare `resolveGlobalSymbol` (an Emscripten dynamic-linking symbol) even though
// we link static with -sJSPI=0. Its guard is `if (!WebAssembly.promising) return`,
// which does NOT short-circuit in a JSPI-capable browser (Chrome), so the glue
// reads the never-declared symbol and throws inside __wasm_call_ctors, aborting
// kernel init before it ever reaches "session ready". Predefine it as a benign
// stub (a static build never actually invokes it) so the read + reassignment in
// the glue both succeed. Must exist before createFreeCAD() runs the ctors.
globalThis.resolveGlobalSymbol =
  globalThis.resolveGlobalSymbol || function () { return { sym: undefined }; };

const statusEl = document.getElementById('status');
const treeList = document.getElementById('treeList');
const log = (line) => {
  statusEl.textContent += `\n${line}`;
  statusEl.scrollTop = statusEl.scrollHeight;
};

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}
const headOk = async (url) => {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
};

// --- three.js viewport -----------------------------------------------------
const viewport = document.getElementById('right');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(80, 80, 80);
const renderer = new THREE.WebGLRenderer({ antialias: true });
viewport.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 1.2));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(1, 2, 3);
scene.add(dir);
scene.add(new THREE.AxesHelper(20));

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();
(function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();

// --- kernel load + session -------------------------------------------------
let session = null;
// state.pad is specifically the original Pad feature (Set Length targets it
// forever). state.tip is whatever solid is CURRENTLY at the end of the
// feature chain (Pad -> Fillet -> Chamfer -> ...) — Fillet/Chamfer's `Base`
// must always be the latest tip, not the original Pad, so the two need to be
// tracked separately.
// state.selectedFeature (a tree-row click) is SEPARATE from state.selected
// (a 3D face/edge pick, slice 2b) — the two never cross.
const state = { body: null, sketch: null, pad: null, tip: null, selected: null, selectedFeature: null };
const t0 = performance.now();
log(`crossOriginIsolated: ${window.crossOriginIsolated}`);

// Shared by pick3d's onSelect AND the fillet/chamfer handlers below (which
// clear the selection themselves after a feature-creating op, since
// pick3d.rebuild() disposes the old selection without re-notifying).
function updateSelectionReadout(sel) {
  state.selected = sel;
  const readout = document.getElementById('selReadout');
  if (sel) {
    const label = `${sel.kind === 'face' ? 'Face' : 'Edge'} ${sel.id + 1}`; // 0-based id -> 1-based FreeCAD name
    log(`▷ selected ${label}`);
    if (readout) readout.textContent = label;
  } else {
    log('▷ selection cleared');
    if (readout) readout.textContent = '—';
  }
  updateFeatureButtons();
}

// Fillet/Chamfer only make sense on an EDGE selection, and only once the
// kernel is up — re-run whenever either condition could have changed.
function updateFeatureButtons() {
  const enabled = !!session && state.selected?.kind === 'edge';
  ['fillet', 'chamfer'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

// Pocket needs a drawn sketch AND a solid to cut into. Re-run wherever
// state.sketch/state.tip could have changed — render() covers most of that
// (Finish Sketch -> onFinish -> render(), New Body, Rect/Circle Sketch, Pad,
// Fillet, Chamfer, Open file, Set Length all call it already); New Sketch
// itself doesn't, but Pocket's enablement doesn't matter mid-draw.
function updatePocketButton() {
  const el = document.getElementById('pocket');
  if (el) el.disabled = !(session && state.sketch && state.tip);
}

// Revolve only needs a drawn sketch (like Pad, it can BE the first feature —
// unlike Pocket, it doesn't require an existing solid to cut into), so it's a
// separate condition from updatePocketButton's rather than a shared one.
// Called alongside updatePocketButton() everywhere state.sketch can change.
function updateRevolveButton() {
  const el = document.getElementById('revolve');
  if (el) el.disabled = !(session && state.sketch);
}

// --- pickable solid (slice 2b) -----------------------------------------------
// Session-agnostic per SPEC: pick3d never touches the session — studio.js
// reads session.meshFaces() and hands the RESULT into rebuild().
const pick3d = initPick3d({
  scene, THREE, getCamera: () => camera, renderer,
  onSelect: updateSelectionReadout,
});

(async () => {
  const base = (await headOk('/kernel-browser/FreeCADCmd.js')) ? '/kernel-browser/' : '/kernel/';
  log(`kernel base: ${base}`);
  window.Module = {
    print: (m) => log(m),
    printErr: (m) => log(`[err] ${m}`),
    noInitialRun: true,
    preRun: [(m) => {
      m.ENV.FREECAD_WASM_KERNEL = '1';
      m.ENV.FREECAD_HOME = '/freecad';
      m.ENV.PYTHONHOME = '/pyhome';
      m.ENV.PYTHONPATH = '/pyhome/lib/python314.zip';
    }],
  };
  try {
    await loadScript('/freecad-data.js');
    await loadScript(`${base}FreeCADCmd.js`);
    const mod = await createFreeCAD(window.Module);
    log(`kernel loaded in ${Math.round(performance.now() - t0)}ms`);
    mod.callMain(['/nonexistent-placeholder.FCStd']);
    session = attachSketchCommands(attachCommands(createFcSession(mod)));
    session.newDocument('studio');
    log('session ready — click New Body to start');
    refreshTree();
    setButtons(true);
    updateFeatureButtons(); // session is ready now, but no edge is selected yet — stays disabled
    updatePocketButton(); // ditto — no sketch drawn yet
    updateRevolveButton();
  } catch (err) {
    log(`KERNEL LOAD FAILED: ${err.message || err}`);
  }
})();

// --- tree + refresh --------------------------------------------------------
// User-facing tree: hide the Origin/datum plumbing, show Body/Sketch/features.
const HIDE = new Set(['App::Origin', 'App::Line', 'App::Plane', 'App::Point']);
function refreshTree() {
  if (!session) return;
  const rows = session.tree().objects.filter((o) => !HIDE.has(o.type));
  treeList.replaceChildren();
  for (const o of rows) {
    const li = document.createElement('li');
    li.className = 'tree-row';
    li.dataset.name = o.name; // click target -> which feature (see the delegated listener below)
    if (o.name === state.selectedFeature) li.classList.add('tree-row-sel'); // survive an incidental re-render
    const tk = document.createElement('span');
    tk.className = 'tk';
    tk.textContent = o.type.split('::').pop(); // kind, from the controlled TypeId
    li.append(tk, document.createTextNode(' ' + o.label)); // label is data — textNode, not HTML
    treeList.appendChild(li);
  }
}
function lastOfType(typeId) {
  const hits = session.tree().objects.filter((o) => o.type === typeId);
  return hits.length ? hits[hits.length - 1].name : null;
}

// --- editable history: click a tree row to inspect/edit/delete it ----------
// state.selectedFeature is SEPARATE from state.selected (the 3D pick, above).
function highlightTreeRow(name) {
  for (const li of treeList.children) li.classList.toggle('tree-row-sel', li.dataset.name === name);
}
function hideHistPanel() {
  const el = document.getElementById('histPanel');
  if (el) el.hidden = true;
}
function clearFeatureSelection() {
  state.selectedFeature = null;
  highlightTreeRow(null);
  hideHistPanel();
}
// Builds the panel from session.featureInfo()'s {type, param, value}: the
// value input + Apply are only shown when param is set (Sketch/Body have
// none — nothing to edit, Delete is always available).
function populateHistPanel(info) {
  const panel = document.getElementById('histPanel');
  if (!panel) return;
  const typeEl = document.getElementById('histType');
  if (typeEl) typeEl.textContent = `${info.type} — ${info.name}`;
  const hasParam = info.param != null;
  const row = document.getElementById('histValueRow');
  if (row) row.hidden = !hasParam;
  if (hasParam) {
    const label = document.getElementById('histParamLabel');
    if (label) label.textContent = info.param;
    const input = document.getElementById('histValue');
    if (input) input.value = info.value;
  }
  panel.hidden = false;
}
function selectFeature(name) {
  try {
    const info = session.featureInfo(name);
    if (!info || !info.ok) { clearFeatureSelection(); return; }
    state.selectedFeature = name;
    highlightTreeRow(name);
    populateHistPanel(info);
  } catch (err) {
    log(`✗ ${extractFriendlyError(err)}`);
    clearFeatureSelection();
  }
}
// Delegated (not per-row) so it survives refreshTree()'s replaceChildren();
// treeList itself is never recreated, only its children. Clicking the
// already-selected row, or empty space below the rows, clears the selection.
treeList.addEventListener('click', (evt) => {
  const li = evt.target.closest('.tree-row');
  const name = li && li.dataset.name;
  if (!name || state.selectedFeature === name) { clearFeatureSelection(); return; }
  selectFeature(name);
});

on('histApply', 'click', guard(() => {
  const name = state.selectedFeature;
  if (!name) return;
  const v = Number(document.getElementById('histValue').value);
  try {
    session.editFeature(name, v);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  log(`~ ${name} = ${v}`);
  render();            // rebuilds tree + 3D from the new state
  selectFeature(name); // re-read the (possibly reverted) value back into the panel
}));

on('histDelete', 'click', guard(() => {
  const name = state.selectedFeature;
  if (!name) return;
  try {
    session.deleteFeature(name);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  log(`− deleted ${name}`);
  state.selectedFeature = null;
  hideHistPanel();
  render();
}));
// Rebuilds the pickable solid from the active tip (no arg = FreeCAD's own
// default). Kept the try/catch shape of the old showMesh(session.mesh())
// call it replaces — meshFaces() degrades to {faces:[],edges:[],empty:true}
// rather than throwing, but a mid-recompute error is still possible. Also
// keeps state.tip in sync with whatever's actually at the tip (e.g. after
// opening a file, or Set Length) — leave it as-is on an empty result rather
// than wiping out a previously valid tip.
function render() {
  try {
    const fm = session.meshFaces();
    if (!fm.empty && fm.object) state.tip = fm.object;
    pick3d.rebuild(fm);
  } catch (e) { log(`mesh: ${e.message}`); }
  refreshTree();
  updatePocketButton();
  updateRevolveButton();
}

// --- buttons ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function setButtons(on) {
  ['newBody', 'rect', 'circle', 'sketchNew', 'pad', 'pocket', 'revolve', 'apply', 'save', 'open', 'pickFaces', 'pickEdges', 'fillet', 'chamfer'].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !on; // null-safe: a restyle that drops an id won't crash init
  });
}
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
setButtons(false);

function guard(fn) {
  return () => { try { fn(); } catch (e) { log(`✗ ${e.message.split('\n')[0]}`); } };
}

// --- sketch mode -------------------------------------------------------------
// sketch.js owns the 2D canvas + interaction; this module only owns the
// session and the 3D view, per its initSketchMode({getSession,...}) contract.
const sketchUI = initSketchMode({
  getSession: () => session,
  viewport,
  onEnter: () => { const el = $('sketchFinish'); if (el) el.style.display = ''; },
  onFinish: (finishedSketch) => {
    const el = $('sketchFinish'); if (el) el.style.display = 'none';
    if (finishedSketch) state.sketch = finishedSketch;
    render();
  },
});

// A face picked in 3D (Faces mode) + an existing solid means "sketch on that
// face" (for Pocket); otherwise fall back to the original flat XY sketch.
// Either way, read the REAL created name back via lastOfType — FreeCAD
// auto-numbers a second 'Sketch' to 'Sketch001', so the literal can't be
// assumed once a sketch already exists in the document.
on('sketchNew', 'click', guard(() => {
  if (!state.body) {
    session.newBody('Body');
    state.body = lastOfType('PartDesign::Body');
  }
  const onFace = state.selected?.kind === 'face' && state.tip;
  if (onFace) {
    const face = 'Face' + (state.selected.id + 1);
    session.sketchNewOnFace(state.body, 'Sketch', state.tip, face);
  } else {
    session.sketchNew(state.body, 'Sketch');
  }
  state.sketch = lastOfType('Sketcher::SketchObject');
  log(onFace ? `+ ${state.sketch} on Face ${state.selected.id + 1}` : `+ ${state.sketch} (XY)`);
  sketchUI.enter(state.sketch);
}));

on('sketchFinish', 'click', guard(() => sketchUI.exit()));

// --- 3D face/edge pick mode --------------------------------------------------
// Only meaningful in 3D (not sketch mode) — toggles what pick3d's raycaster
// targets. `.primary` styling on whichever button is active mirrors the
// existing .fbtn.active pattern sketch.js uses for its own tool buttons.
function setPickMode(m) {
  pick3d.setMode(m);
  $('pickFaces')?.classList.toggle('primary', m === 'face');
  $('pickEdges')?.classList.toggle('primary', m === 'edge');
}
on('pickFaces', 'click', () => setPickMode('face'));
on('pickEdges', 'click', () => setPickMode('edge'));

on('newBody', 'click', guard(() => {
  session.newBody('Body');
  state.body = lastOfType('PartDesign::Body');
  state.sketch = null; state.pad = null;
  log(`+ ${state.body}`);
  render();
}));

on('rect', 'click', guard(() => {
  if (!state.body) return log('make a Body first');
  const w = Number($('w').value), h = Number($('h').value);
  session.sketchRect(state.body, 'Sketch', w, h);
  state.sketch = lastOfType('Sketcher::SketchObject');
  log(`+ ${state.sketch} (${w}×${h})`);
  render();
}));

on('circle', 'click', guard(() => {
  if (!state.body) return log('make a Body first');
  const r = Number(($('r') || {}).value || 6);
  session.sketchCircle(state.body, 'Sketch', r);
  state.sketch = lastOfType('Sketcher::SketchObject');
  log(`+ ${state.sketch} (circle r${r})`);
  render();
}));

on('pad', 'click', guard(() => {
  if (!state.sketch) return log('draw a Rect Sketch first');
  const len = Number($('len').value);
  session.pad(state.body, state.sketch, 'Pad', len);
  state.pad = lastOfType('PartDesign::Pad');
  // A Pad only makes a solid from a single CLOSED profile. If the sketch has an
  // open wire (a loose arc/line) the recompute leaves the Pad shape null — mesh
  // of the Pad itself comes back empty. Surface that instead of logging a
  // phantom "+ Pad" and rendering nothing.
  const fm = session.meshFaces(state.pad);
  const madeSolid = !fm.empty && fm.faces && fm.faces.length > 0;
  // On success, rebuild pick3d from the PADDED solid immediately — it's the
  // freshest tip, so the just-created solid is pickable without a second click.
  // Also seeds state.tip: the Pad is the first Base a Fillet/Chamfer can target.
  if (madeSolid && fm.object) state.tip = fm.object;
  pick3d.rebuild(madeSolid ? fm : { faces: [], edges: [] });
  refreshTree();
  if (madeSolid) {
    state.sketch = null; // a sketch feeds exactly ONE feature — clear it so Pad/Pocket need a fresh one
    log(`+ ${state.pad} (length ${len})`);
  } else {
    log(`✗ Pad made no solid — the profile isn't one closed loop (an open arc/line, or gaps between edges). Close the sketch or delete open geometry, then Pad again.`);
  }
  updatePocketButton(); // state.tip / state.sketch just changed
  updateRevolveButton();
}));

on('apply', 'click', guard(() => {
  if (!state.pad) return log('Pad something first');
  const len = Number($('len').value);
  session.setParam(state.pad, 'Length', len);
  log(`~ ${state.pad}.Length = ${len}`);
  render();
}));

// Cuts the drawn profile inward from whichever face/plane it was sketched on.
// Mirrors the fillet/chamfer shape exactly: try the op, catch -> friendly
// message via extractFriendlyError() (session.pocket() throws the same clean-
// message contract on an open/invalid profile), success -> new tip + rebuild.
on('pocket', 'click', guard(() => {
  if (!state.sketch) return log('draw a sketch on a face first');
  const depth = Number($('len').value);
  try {
    session.pocket(state.body, state.sketch, 'Pocket', depth);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  state.tip = lastOfType('PartDesign::Pocket');
  log(`+ pocket ${state.sketch} depth ${depth}`);
  state.sketch = null; // consumed by the Pocket — a new cut needs a fresh face-sketch
  pick3d.rebuild(session.meshFaces());
  refreshTree();
  updatePocketButton();
  updateRevolveButton();
}));

// Spins the drawn profile around the sketch's own vertical (Y) axis into a
// solid of revolution. Like Pad, it can BE the first feature (no state.tip
// required to enable it) — unlike Pocket, which needs an existing solid to
// cut into. Same guard()+try/catch+extractFriendlyError() shape as the rest:
// the bridge throws a clean message if the profile crosses the axis.
on('revolve', 'click', guard(() => {
  if (!state.sketch) return log('draw a sketch first');
  const angle = Number($('revAngle').value) || 360;
  try {
    session.revolve(state.body, state.sketch, 'Revolution', angle);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  state.tip = lastOfType('PartDesign::Revolution');
  log(`+ revolve ${state.sketch} ${angle}°`);
  state.sketch = null; // consumed by the Revolution — a sketch feeds exactly one feature
  pick3d.rebuild(session.meshFaces());
  refreshTree();
  updatePocketButton();
  updateRevolveButton();
}));

// The bridge's fillet/chamfer now REJECT an impossible radius/size BEFORE
// recompute (an oversized one used to corrupt the wasm heap during OCCT's
// recompute, crashing the session) and THROW a ValueError with a helpful
// message instead. So the contract is now: the call either succeeds (a valid
// feature) or throws (nothing created, tip unchanged) — no more meshFaces()
// empty-check needed to detect failure.
//
// The thrown Error's message is `${what} failed (rc=${rc}):\n${out}` (see
// attachCommands' run() in fc-commands.mjs), where `out` is the raw Python
// stdout/stderr — a full traceback ending in the actual `ValueError: ...`
// line. Pull that line out instead of showing the traceback or the generic
// "fillet failed (rc=-1)" guard() would otherwise log.
function extractFriendlyError(err) {
  const lines = String((err && err.message) || err || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/ValueError:/.test(lines[i]) || /too large/i.test(lines[i]) || /try a smaller/i.test(lines[i])) {
      return lines[i].replace(/^.*ValueError:\s*/, '');
    }
  }
  return lines[0] || 'operation failed';
}

// Fillet and Chamfer round/bevel the selected edge on the CURRENT tip
// (state.tip, not state.pad — so a second fillet chains off the first one's
// result rather than re-targeting the original Pad).
on('fillet', 'click', guard(() => {
  if (state.selected?.kind !== 'edge') return log('select an edge first');
  const edge = 'Edge' + (state.selected.id + 1);
  const r = Number($('filletR').value);
  try {
    session.fillet(state.body, state.tip, [edge], r);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  state.tip = lastOfType('PartDesign::Fillet');
  pick3d.rebuild(session.meshFaces());
  log(`+ fillet ${edge} r${r}`);
  updateSelectionReadout(null); // the tip changed under the old selection — clear it
  refreshTree();
  updatePocketButton(); // state.tip just changed — Pocket's other operand
}));

on('chamfer', 'click', guard(() => {
  if (state.selected?.kind !== 'edge') return log('select an edge first');
  const edge = 'Edge' + (state.selected.id + 1);
  const size = Number($('filletR').value);
  try {
    session.chamfer(state.body, state.tip, [edge], size);
  } catch (err) {
    return log(`✗ ${extractFriendlyError(err)}`);
  }
  state.tip = lastOfType('PartDesign::Chamfer');
  pick3d.rebuild(session.meshFaces());
  log(`+ chamfer ${edge} size${size}`);
  updateSelectionReadout(null);
  refreshTree();
  updatePocketButton();
}));

// Save the live document to a real .FCStd and hand it to the browser download.
on('save', 'click', guard(() => {
  const bytes = session.saveDocument();
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'model.FCStd';
  a.click();
  URL.revokeObjectURL(a.href);
  log(`saved model.FCStd (${bytes.length} bytes)`);
}));

// Open a .FCStd the user picks; it becomes the active document. Re-derive the
// current Body/Sketch/Pad from the opened tree so Set Length still works.
on('open', 'click', () => { const f = $('file'); if (f) f.click(); });
on('file', 'change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const name = session.openDocument(bytes);
    state.body = lastOfType('PartDesign::Body');
    state.sketch = lastOfType('Sketcher::SketchObject');
    state.pad = lastOfType('PartDesign::Pad');
    log(`opened ${f.name} → doc ${name}`);
    render();
  } catch (err) {
    log(`✗ open: ${err.message.split('\n')[0]}`);
  } finally {
    e.target.value = ''; // allow re-opening the same file
  }
});
