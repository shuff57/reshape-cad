// engine/play/studio.js
//
// The clickable modeler: the same browser kernel loader as play.js, but driven
// through the command bridge (createFcSession + attachCommands) instead of a
// one-shot script. Toolbar buttons call typed PartDesign commands; after each,
// the tip solid's mesh is read back and rendered, and the feature tree panel
// is refreshed. This is the step-③ "wire the modeler to the GUI" payoff.

import { createFcSession } from '/bridge/fc-session.mjs';
import { attachCommands } from '/bridge/fc-commands.mjs';

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
let mesh = null;

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();
(function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();

// The bridge mesh() returns flat arrays: positions [x,y,z,...], indices [i,j,k,...].
function showMesh({ positions, indices }) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  if (!positions || positions.length === 0) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0x5aa9e6, metalness: 0.1, roughness: 0.55 });
  mesh = new THREE.Mesh(g, m);
  scene.add(mesh);
}

// --- kernel load + session -------------------------------------------------
let session = null;
const state = { body: null, sketch: null, pad: null };
const t0 = performance.now();
log(`crossOriginIsolated: ${window.crossOriginIsolated}`);

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
    session = attachCommands(createFcSession(mod));
    session.newDocument('studio');
    log('session ready — click New Body to start');
    refreshTree();
    setButtons(true);
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
  treeList.innerHTML = '';
  for (const o of rows) {
    const li = document.createElement('li');
    li.className = 'tree-row';
    const kind = o.type.split('::').pop();
    li.innerHTML = `<span class="tk">${kind}</span> ${o.label}`;
    treeList.appendChild(li);
  }
}
function lastOfType(typeId) {
  const hits = session.tree().objects.filter((o) => o.type === typeId);
  return hits.length ? hits[hits.length - 1].name : null;
}
function render() {
  try { showMesh(session.mesh()); } catch (e) { log(`mesh: ${e.message}`); }
  refreshTree();
}

// --- buttons ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function setButtons(on) {
  ['newBody', 'rect', 'pad', 'apply'].forEach((id) => { $(id).disabled = !on; });
}
setButtons(false);

function guard(fn) {
  return () => { try { fn(); } catch (e) { log(`✗ ${e.message.split('\n')[0]}`); } };
}

$('newBody').addEventListener('click', guard(() => {
  session.newBody('Body');
  state.body = lastOfType('PartDesign::Body');
  state.sketch = null; state.pad = null;
  log(`+ ${state.body}`);
  render();
}));

$('rect').addEventListener('click', guard(() => {
  if (!state.body) return log('make a Body first');
  const w = Number($('w').value), h = Number($('h').value);
  session.sketchRect(state.body, 'Sketch', w, h);
  state.sketch = lastOfType('Sketcher::SketchObject');
  log(`+ ${state.sketch} (${w}×${h})`);
  render();
}));

$('pad').addEventListener('click', guard(() => {
  if (!state.sketch) return log('draw a Rect Sketch first');
  const len = Number($('len').value);
  session.pad(state.body, state.sketch, 'Pad', len);
  state.pad = lastOfType('PartDesign::Pad');
  log(`+ ${state.pad} (length ${len})`);
  render();
}));

$('apply').addEventListener('click', guard(() => {
  if (!state.pad) return log('Pad something first');
  const len = Number($('len').value);
  session.setParam(state.pad, 'Length', len);
  log(`~ ${state.pad}.Length = ${len}`);
  render();
}));
