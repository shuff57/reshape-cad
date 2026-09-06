// engine/play/play.js
//
// G5 playground driver. Loads the FreeCADCmd wasm kernel (window.createFreeCAD,
// exposed by /kernel/FreeCADCmd.js -- see engine/scripts/smoke.mjs for the
// same init sequence under Node) and drives it through freecad_run_python(),
// same as the G4 smoke test, but in a real browser tab instead of NODERAWFS.
//
// KNOWN LIMITATION (see G4/G5 handoff report): the current kernel build was
// compiled with FREECAD_WASM_NODERAWFS=ON. That bakes in an unconditional
// Node-only assumption at MULTIPLE points in the generated JS -- confirmed
// empirically in a real (headless Chromium) browser, not just by reading
// the source: the actual first failure is a bare `require("path")` used to
// build the FS layer's path-manipulation helpers (only guarded by
// ENVIRONMENT_IS_NODE in some call sites, not this one), which throws
// "require is not defined" before the module ever reaches the
// NODERAWFS-specific "...only supported on Node.js environment" check
// further down in FS init. Either failure means the same thing: this
// artifact cannot run outside Node yet. This file is written to work
// unmodified against a future NODERAWFS=OFF build (MEMFS + a preloaded
// asset package for the Python stdlib and FREECAD_HOME data); until then it
// surfaces whatever the real load error is in the status line instead of
// hanging.

const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const saveBtn = document.getElementById('save');
const codeEl = document.getElementById('code');

function log(line) {
  statusEl.textContent += `\n${line}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

// --- three.js viewport -----------------------------------------------------
const viewport = document.getElementById('right');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202225);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(80, 80, 80);
const renderer = new THREE.WebGLRenderer({ antialias: true });
viewport.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(1, 2, 3);
scene.add(dirLight);
scene.add(new THREE.AxesHelper(20));
let mesh = null;

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

function showTessellation({ vertices, triangles }) {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.flat());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x4c8bf5, metalness: 0.1, roughness: 0.6 });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
}

// --- kernel loading ----------------------------------------------------------
let Module = null;
const t0 = performance.now();

log(`crossOriginIsolated: ${window.crossOriginIsolated}`);

fetch('/kernel/FreeCADCmd.wasm', { method: 'HEAD' })
  .then((r) => log(`wasm size: ${r.headers.get('content-length') ?? 'unknown'} bytes`))
  .catch(() => {});

createFreeCAD({
  noInitialRun: true,
  print: (msg) => log(msg),
  printErr: (msg) => log(`[err] ${msg}`),
})
  .then((mod) => {
    Module = mod;
    log(`Kernel loaded in ${Math.round(performance.now() - t0)}ms`);
    Module.callMain([]);
    runBtn.disabled = false;
  })
  .catch((err) => {
    log(`KERNEL LOAD FAILED: ${err.message || err}`);
    log('This build requires Node (NODERAWFS) and cannot run in a browser yet -- see G4/G5 handoff notes.');
  });

runBtn.disabled = true;

runBtn.addEventListener('click', () => {
  if (!Module) return;
  statusEl.textContent = 'Running...';
  const code = codeEl.value;
  const rc = Module.ccall('freecad_run_python', 'number', ['string'], [code]);
  log(`freecad_run_python() returned ${rc}`);
  if (rc !== 0) return;

  try {
    const jsonBytes = Module.FS.readFile('/tmp/g5_result.json', { encoding: 'utf8' });
    const result = JSON.parse(jsonBytes);
    log(`volume: ${result.volume} mm^3, ${result.vertices.length} verts / ${result.triangles.length} tris`);
    showTessellation(result);
    saveBtn.disabled = false;
  } catch (err) {
    log(`could not read /tmp/g5_result.json: ${err.message || err}`);
  }
});

saveBtn.addEventListener('click', () => {
  if (!Module) return;
  try {
    const bytes = Module.FS.readFile('/tmp/g5_out.FCStd');
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'g5_out.FCStd';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    log(`could not read /tmp/g5_out.FCStd: ${err.message || err}`);
  }
});
