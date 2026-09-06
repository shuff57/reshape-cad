// engine/play/play.js
//
// G5 playground driver. Loads the FreeCADCmd wasm kernel and drives it
// through freecad_run_python(), same init sequence as the G4 smoke test
// (engine/scripts/smoke.mjs), but in a real browser tab.
//
// Kernel base URL: tries /kernel-browser/ first (the future NODERAWFS=OFF,
// MEMFS browser build a2-headless-build is relinking into
// engine/build/g5-artifacts/), falls back to /kernel/ (today's G4 Node-only
// build -- known, confirmed live in Chromium, to fail with "require is not
// defined" before FS init even reaches its NODERAWFS-only guard). Either
// way the real load error is surfaced in the status line, never silently
// swallowed.
//
// Data pack: freecad-data.data/.js (built by engine/play's file_packager
// invocation -- see the G4/G5 handoff notes for the exact command) preload
// a pruned FREECAD_HOME (Ext/freecad bridge package, Mod/{Material,Part,
// Sketcher} Init.py, Mod/Material/Resources/Materials/Standard) into MEMFS
// at /freecad (mirrored at /freecad/share, matching getResourceDir()'s
// AppHomePath+"share/" behavior -- see smoke.mjs) and a pruned Python 3.14
// stdlib, zipped, at /pyhome/lib/python314.zip (zipimport, not one file per
// module -- 2.7MB vs 12MB unpacked, and far fewer preload entries).
// file_packager's loader script expects a pre-existing global object named
// by --export-name (here "Module") to mutate in place (attaching preRun
// callbacks that mount the FS); we build that object ourselves below and
// pass the SAME reference into createFreeCAD(), because the MODULARIZE
// factory uses whatever object it's given as its internal Module.

const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const saveBtn = document.getElementById('save');
const codeEl = document.getElementById('code');

function log(line) {
  statusEl.textContent += `\n${line}`;
  statusEl.scrollTop = statusEl.scrollHeight;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
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
let fcModule = null;
const t0 = performance.now();

log(`crossOriginIsolated: ${window.crossOriginIsolated}`);

(async () => {
  const browserBase = '/kernel-browser/';
  const nodeOnlyBase = '/kernel/';
  const base = (await headOk(`${browserBase}FreeCADCmd.js`)) ? browserBase : nodeOnlyBase;
  log(`kernel base: ${base}${base === nodeOnlyBase ? ' (G5 browser build not deployed yet -- using the G4 Node-only build, which is expected to fail here)' : ''}`);

  const wasmHead = await fetch(`${base}FreeCADCmd.wasm`, { method: 'HEAD' }).catch(() => null);
  if (wasmHead) log(`wasm size: ${wasmHead.headers.get('content-length') ?? 'unknown'} bytes`);

  // window.Module is the object file_packager's loader (freecad-data.js,
  // built with --export-name=Module) mutates in place; we pass this exact
  // reference into createFreeCAD() below so the preload hooks it attaches
  // actually run against the real Module instance.
  window.Module = {
    print: (msg) => log(msg),
    printErr: (msg) => log(`[err] ${msg}`),
    noInitialRun: true,
    preRun: [
      (m) => {
        m.ENV.FREECAD_WASM_KERNEL = '1';
        m.ENV.FREECAD_HOME = '/freecad';
        m.ENV.PYTHONHOME = '/pyhome';
        m.ENV.PYTHONPATH = '/pyhome/lib/python314.zip';
      },
    ],
  };

  try {
    await loadScript('/freecad-data.js'); // populates window.Module.preRun with the FS-mount step
    await loadScript(`${base}FreeCADCmd.js`); // defines window.createFreeCAD
    const mod = await createFreeCAD(window.Module);
    fcModule = mod;
    log(`Kernel loaded in ${Math.round(performance.now() - t0)}ms`);
    fcModule.callMain(['/nonexistent-placeholder.FCStd']);
    runBtn.disabled = false;
  } catch (err) {
    log(`KERNEL LOAD FAILED: ${err.message || err}`);
    log('See G4/G5 handoff notes for the known NODERAWFS-only-build limitation.');
  }
})();

runBtn.disabled = true;

runBtn.addEventListener('click', () => {
  if (!fcModule) return;
  statusEl.textContent = 'Running...';
  const code = codeEl.value;
  const rc = fcModule.ccall('freecad_run_python', 'number', ['string'], [code]);
  log(`freecad_run_python() returned ${rc}`);
  if (rc !== 0) return;

  try {
    const jsonBytes = fcModule.FS.readFile('/out/mesh.json', { encoding: 'utf8' });
    const result = JSON.parse(jsonBytes);
    log(`volume: ${result.volume} mm^3, ${result.vertices.length} verts / ${result.triangles.length} tris`);
    showTessellation(result);
    saveBtn.disabled = false;
  } catch (err) {
    log(`could not read /out/mesh.json: ${err.message || err}`);
  }
});

saveBtn.addEventListener('click', () => {
  if (!fcModule) return;
  try {
    const bytes = fcModule.FS.readFile('/out/model.FCStd');
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'model.FCStd';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    log(`could not read /out/model.FCStd: ${err.message || err}`);
  }
});
