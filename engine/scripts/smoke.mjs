#!/usr/bin/env node
// engine/scripts/smoke.mjs
//
// G4 node smoke test for the headless FreeCAD wasm kernel (Track A2).
//
// Loads FreeCADCmd.js/.wasm (built via Dockerfile.kernel's kernel-artifacts
// target), initializes the FreeCAD application, then drives it entirely
// through freecad_run_python() -- the same C entry point the browser
// playground (G5) will use. This is the FreeCAD-web wasm kernel's own
// interactive API (src/Main/MainCmd.cpp): main() runs App::Application::init
// + runApplication() once, and because FREECAD_WASM_KERNEL is set in the
// environment, main() returns without tearing the application down
// (EXIT_RUNTIME=0 keeps the module alive), leaving Python callable via
// freecad_run_python(const char* code) -> PyRun_SimpleString(code) for the
// rest of the process's life.
//
// Test: Box 40x40x20 minus a Cylinder r=6 (centered on the box's top face)
// via Part::Cut, recompute, print volume, save .FCStd, export STEP + STL,
// reload the saved document, recompute again, and assert the reloaded
// volume matches the original within 0.1%.
//
// Usage: node engine/scripts/smoke.mjs [path/to/FreeCADCmd.js] [outDir]

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const kernelJs = resolve(
  process.argv[2] || resolve(here, '..', 'build', 'g3-artifacts', 'FreeCADCmd.js')
);
const outDir = resolve(process.argv[3] || resolve(here, '..', 'build', 'g4-out'));

if (!existsSync(kernelJs)) {
  console.error(`G4 FAIL: kernel not found at ${kernelJs}`);
  console.error('Build it first (Dockerfile.kernel target kernel-artifacts) or pass its path as argv[2].');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const fcstdPath = resolve(outDir, 'g4smoke.FCStd');
const stepPath = resolve(outDir, 'g4smoke.step');
const stlPath = resolve(outDir, 'g4smoke.stl');

// NODERAWFS=1 means the wasm module's filesystem calls hit the REAL host
// filesystem directly (no virtual MEMFS staging), so these are ordinary
// absolute paths, forward-slashed for the Python side.
const py = (path) => path.replace(/\\/g, '/');

const pythonScript = process.env.SMOKE_PY_FILE
  ? readFileSync(process.env.SMOKE_PY_FILE, 'utf8')
  : `
import sys
import FreeCAD as App
import Part

doc = App.newDocument("G4Smoke")

box = doc.addObject("Part::Box", "Box")
box.Length = 40
box.Width = 40
box.Height = 20

cyl = doc.addObject("Part::Cylinder", "Cylinder")
cyl.Radius = 6
cyl.Height = 20
cyl.Placement = App.Placement(App.Vector(20, 20, 0), App.Rotation())

cut = doc.addObject("Part::Cut", "Cut")
cut.Base = box
cut.Tool = cyl
doc.recompute()

if cut.Shape.isNull():
    print("G4_RESULT:FAIL:cut shape is null after recompute")
    sys.exit(0)

vol1 = cut.Shape.Volume
print(f"G4_VOLUME_AFTER_CUT:{vol1!r}")

save_path = "${py(fcstdPath)}"
step_path = "${py(stepPath)}"
stl_path = "${py(stlPath)}"

doc.saveAs(save_path)
Part.export([cut], step_path)
Part.export([cut], stl_path)

App.closeDocument(doc.Name)

doc2 = App.openDocument(save_path)
doc2.recompute()
cut2 = doc2.getObject("Cut")
if cut2 is None or cut2.Shape.isNull():
    print("G4_RESULT:FAIL:reloaded cut shape missing or null")
    sys.exit(0)

vol2 = cut2.Shape.Volume
print(f"G4_VOLUME_AFTER_RELOAD:{vol2!r}")

diff_pct = abs(vol1 - vol2) / vol1 * 100.0
print(f"G4_VOLUME_DIFF_PCT:{diff_pct!r}")

if diff_pct < 0.1:
    print("G4_RESULT:PASS")
else:
    print(f"G4_RESULT:FAIL:volume diff {diff_pct}% exceeds 0.1% tolerance")
`;

console.log(`Loading kernel: ${kernelJs}`);
const t0 = Date.now();
const createFreeCAD = require(kernelJs);

// getenv("FREECAD_WASM_KERNEL") in MainCmd.cpp is what keeps the app alive
// after main() returns instead of tearing everything down. PYTHONHOME /
// PYTHONPATH are read the same way by Base::Interpreter::initInterpreter()
// (src/Base/Interpreter.cpp, FC_OS_WASM branch) to locate the stdlib --
// note these must go through Module.ENV below, NOT just process.env /
// docker -e, since emscripten's getenv() shim reads its own internal ENV
// object, not the host process environment directly.
const PYTHON_HOME = process.env.FREECAD_PYTHONHOME || '/opt/toolchains/python-wasm';
const PYTHON_PATH = process.env.FREECAD_PYTHONPATH || `${PYTHON_HOME}/lib/python3.14`;

// App::Application::init() sets mConfig["AppHomePath"] from
// ApplicationDirectories::findHomePath(argv[0]). The FC_OS_WASM branch of
// that function (src/App/ApplicationDirectories.cpp) has no /proc/self/exe
// to walk, so it just reads getenv("FREECAD_HOME") and falls back to the
// literal path "/freecad". App/FreeCADInit.py's InitPipeline.scan() then
// derives std_mod = AppHomePath/"Mod" and std_ext = AppHomePath/"Ext":
// std_ext is what "import freecad" (the ExtMod bridge package, called from
// init_applications -> ExtModScanner.scan()) resolves against, and std_mod
// is where each workbench's Init.py AND its data resources live (e.g.
// Mod/Material/Resources/Materials/Standard/Default.FCMat -- Part::Box's
// default material lookup fails with "Material not found" without it).
//
// In this build tree those two pieces live in different places: the
// generated Ext/freecad/__init__.py (CMake-templated from
// src/Ext/freecad/__init__.py.template) only exists under the *build* dir,
// while the Mod resource data (Resources/, Init.py, etc.) only exists under
// the *source* checkout -- the build dir's src/Mod is object files/CMake
// bookkeeping, not the resource tree. So AppHomePath can't just be one of
// the two; we stage a synthetic home dir that bind-mounts each piece from
// where it actually is (see ensureMounted below for why a symlink doesn't
// work). App::Application::getResourceDir() (used by Mod/Material's
// default-material lookup, among others) resolves to AppHomePath + "share/"
// in this build, not AppHomePath itself -- verified empirically via
// App.getResourceDir() -- so both Mod and Ext are mounted twice: once at
// FREECAD_HOME for AppHomePath-relative consumers (FreeCADInit.py's
// std_mod/std_ext, i.e. "import freecad" and workbench Init.py scanning),
// and again at FREECAD_HOME/share for getResourceDir()-relative consumers
// (e.g. Mod/Material/Resources/Materials/Standard/Default.FCMat).
const FREECAD_MOD_SRC = process.env.FREECAD_MOD_SRC || '/work/fw/src/Mod';
const FREECAD_EXT_SRC = process.env.FREECAD_EXT_SRC || '/work/build/Ext';
const FREECAD_HOME = process.env.FREECAD_HOME || '/freecad_home';

// A plain symlink does NOT work here: Emscripten's NODERAWFS reads
// directory entries via fs.readdirSync(..., {withFileTypes:true}), whose
// Dirent.isDirectory() reflects the entry's own (lstat) type, not the
// symlink target's -- so Python's pathlib.iterdir() on a symlinked "Mod"
// raises NotADirectoryError even though the target is a real directory.
// A bind mount is a real directory entry (no symlink involved), so it
// passes that check; fall back to a recursive copy if bind mounts aren't
// available (e.g. no CAP_SYS_ADMIN, or a non-Linux host).
function ensureMounted(target, linkPath) {
  if (existsSync(linkPath) && readdirSync(linkPath).length > 0) {
    return; // already staged (prior run in this container)
  }
  mkdirSync(linkPath, { recursive: true });
  try {
    execFileSync('mount', ['--bind', target, linkPath], { stdio: 'pipe' });
    return;
  } catch (err) {
    console.warn(`mount --bind failed for ${linkPath} (${err.message.split('\n')[0]}), falling back to a recursive copy`);
  }
  const { cpSync } = require('node:fs');
  cpSync(target, linkPath, { recursive: true, dereference: true });
}

if (existsSync(FREECAD_MOD_SRC) && existsSync(FREECAD_EXT_SRC)) {
  mkdirSync(FREECAD_HOME, { recursive: true });
  ensureMounted(FREECAD_MOD_SRC, resolve(FREECAD_HOME, 'Mod'));
  ensureMounted(FREECAD_EXT_SRC, resolve(FREECAD_HOME, 'Ext'));
  // App::Application::getResourceDir() in this build does NOT return
  // AppHomePath as-is -- verified empirically (print(App.getResourceDir()))
  // that it returns AppHomePath + "/share/". MaterialManagerLocal and other
  // Mod resource lookups (src/Mod/Material/App/MaterialManagerLocal.cpp)
  // build their search path as getResourceDir() + "/Mod/Material/Resources/
  // Materials", so without this extra "share" layer Part::Box's default
  // material lookup fails with "Material not found" even though
  // FREECAD_HOME/Mod is staged correctly. Stage the same trees one level
  // deeper too so both AppHomePath-relative and getResourceDir()-relative
  // consumers find them.
  ensureMounted(FREECAD_MOD_SRC, resolve(FREECAD_HOME, 'share', 'Mod'));
  ensureMounted(FREECAD_EXT_SRC, resolve(FREECAD_HOME, 'share', 'Ext'));
  console.log(`Staged FREECAD_HOME=${FREECAD_HOME} (Mod -> ${FREECAD_MOD_SRC}, Ext -> ${FREECAD_EXT_SRC}, mirrored under share/)`);
} else {
  console.warn(
    `WARNING: FREECAD_MOD_SRC (${FREECAD_MOD_SRC}) or FREECAD_EXT_SRC (${FREECAD_EXT_SRC}) not found -- ` +
      'leaving FREECAD_HOME unstaged; "import freecad" and Mod resource lookups (e.g. default Material) will fail.'
  );
}

const wasmPath = kernelJs.replace(/\.js$/, '.wasm');
const wasmSize = existsSync(wasmPath) ? readFileSync(wasmPath).length : null;

// Emscripten does NOT read a Module.ENV object passed into the MODULARIZE
// factory, and it does not import process.env -- the runtime builds its
// own ENV table during startup. The only supported hook is preRun, which
// runs after the runtime exists (so Module.ENV is populated) and before
// main(). This is what actually reaches std::getenv() inside the wasm
// module -- everything tried before this (factory ENV, process.env) did
// not.
createFreeCAD({
  preRun: [
    (m) => {
      m.ENV.FREECAD_WASM_KERNEL = '1';
      m.ENV.PYTHONHOME = PYTHON_HOME;
      m.ENV.PYTHONPATH = PYTHON_PATH;
      // ApplicationDirectories::findHomePath() (FC_OS_WASM branch) reads
      // FREECAD_HOME, defaulting to "/freecad". See the staging block above
      // for why FREECAD_HOME points at a synthetic directory rather than
      // either of the real build/source trees directly.
      m.ENV.FREECAD_HOME = FREECAD_HOME;
      console.log('preRun: Module.ENV set, FREECAD_WASM_KERNEL=' + m.ENV.FREECAD_WASM_KERNEL + ' FREECAD_HOME=' + m.ENV.FREECAD_HOME);
    },
  ],
  arguments: [],
  noInitialRun: true, // we call callMain() ourselves, once, deliberately
  print: (msg) => console.log(msg),
  printErr: (msg) => console.error(msg),
})
  .then((Module) => {
    const loadMs = Date.now() - t0;
    console.log(`Kernel loaded in ${loadMs}ms, wasm size ${wasmSize ?? 'unknown'} bytes`);
    console.log('Module.ENV defined in preRun?', typeof Module.ENV !== 'undefined');

    console.log('Running main() (App::Application::init + runApplication)...');
    // A non-empty argv file list keeps RunMode at "Exit" instead of being
    // flipped to "Cmd" (interactive console) by
    // Application::processCmdLineFiles() (src/App/Application.cpp): when
    // getCmdLineFiles() is empty, RunMode="Exit" is silently overwritten to
    // "Cmd", which launches Base::Interpreter().runCommandLine() -- that
    // console's EOF-driven exit (no tty under node) appears to finalize the
    // Python interpreter before this script ever gets to call
    // freecad_run_python() again, causing an OOB memory crash. The path
    // below does not need to exist -- processFiles() catches and logs a
    // per-file exception without touching RunMode, as long as `files` is
    // non-empty going in.
    const mainRc = Module.callMain(['/nonexistent-placeholder.FCStd']);
    console.log(`main() returned ${mainRc}`);

    console.log('Running G4 smoke Python script via freecad_run_python()...');
    const pyRc = Module.ccall('freecad_run_python', 'number', ['string'], [pythonScript]);
    console.log(`freecad_run_python() returned ${pyRc}`);

    // Generic module-smoke mode: when SMOKE_PY_FILE is set, pythonScript is that
    // file's contents; run it through the same proven loader and exit on its
    // return code, skipping the box-cut-specific assertions below. Used for
    // per-module smokes (PartDesign, ...) and as "run any Python through the
    // engine" bridge infra. The default G4 behavior is unchanged when unset.
    if (process.env.SMOKE_PY_FILE) {
      console.log(`SMOKE_PY_DONE rc=${pyRc}`);
      process.exit(pyRc === 0 ? 0 : 1);
    }

    if (pyRc !== 0) {
      console.error('G4 FAIL: freecad_run_python returned non-zero (Python exception -- see printed traceback above)');
      process.exitCode = 1;
      return;
    }

    // The PASS/FAIL marker is in the captured stdout above (G4_RESULT:...).
    // We don't re-parse it here since Module.print already streamed it to
    // this process's stdout in real time; the caller (or a human) reads it
    // from there. Exit code reflects freecad_run_python's own return value
    // only -- a Python-side assertion failure would need to raise to flip
    // pyRc non-zero, which the script above deliberately avoids (it prints
    // G4_RESULT:FAIL:... and returns normally) so the full diagnostic
    // reaches stdout instead of being swallowed by PyRun_SimpleString's
    // traceback-to-stderr behavior on an uncaught exception.
  })
  .catch((err) => {
    console.error('G4 FAIL: kernel failed to load or run:', err);
    process.exitCode = 1;
  });
