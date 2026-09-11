// packages/engine/src/fc-session-node.mjs
//
// NODE/TEST ONLY. Split out of fc-session.mjs (SPEC-engine-port.md §2.1):
// uses node:fs, node:child_process and node:module, so it must never be
// imported by the browser entry point (packages/engine/src/load-browser.mjs
// does the browser-equivalent load with a preload data pack instead of host
// staging). Import loadNodeKernel from here and createFcSession from
// ./fc-session.mjs separately -- they used to live in one file, now split by
// runtime.
//
// Mirrors engine/scripts/smoke.mjs's proven sequence: FREECAD_HOME staging
// (bind Mod/Ext at HOME and HOME/share, cp fallback), preRun ENV (the ONLY
// hook std::getenv sees), noInitialRun + a single placeholder callMain
// (keeps the app alive without opening a real file). Runs inside the
// kernel-build-final container where the resource trees exist.
export async function loadNodeKernel(kernelJsPath) {
  const { createRequire } = await import('node:module');
  const { existsSync, mkdirSync, readdirSync, cpSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const require = createRequire(import.meta.url);

  const MOD = process.env.FREECAD_MOD_SRC || '/work/fw/src/Mod';
  const EXT = process.env.FREECAD_EXT_SRC || '/work/build/Ext';
  const HOME = process.env.FREECAD_HOME || '/freecad_home';
  const PYTHON_HOME = process.env.FREECAD_PYTHONHOME || '/opt/toolchains/python-wasm';
  const PYTHON_PATH = process.env.FREECAD_PYTHONPATH || `${PYTHON_HOME}/lib/python3.14`;

  function ensureMounted(target, linkPath) {
    if (existsSync(linkPath) && readdirSync(linkPath).length > 0) return;
    mkdirSync(linkPath, { recursive: true });
    try {
      execFileSync('mount', ['--bind', target, linkPath], { stdio: 'pipe' });
      return;
    } catch {
      cpSync(target, linkPath, { recursive: true, dereference: true });
    }
  }
  if (existsSync(MOD) && existsSync(EXT)) {
    mkdirSync(HOME, { recursive: true });
    ensureMounted(MOD, resolve(HOME, 'Mod'));
    ensureMounted(EXT, resolve(HOME, 'Ext'));
    // getResourceDir() == AppHomePath + "/share/", so mirror one level deeper.
    ensureMounted(MOD, resolve(HOME, 'share', 'Mod'));
    ensureMounted(EXT, resolve(HOME, 'share', 'Ext'));
  }

  const createFreeCAD = require(kernelJsPath);
  // Capture at creation time -- see the note in fc-session.mjs's
  // createFcSession on why a later Module.print reassignment cannot work.
  const lines = [];
  const Module = await createFreeCAD({
    preRun: [
      (m) => {
        m.ENV.FREECAD_WASM_KERNEL = '1';
        m.ENV.PYTHONHOME = PYTHON_HOME;
        m.ENV.PYTHONPATH = PYTHON_PATH;
        m.ENV.FREECAD_HOME = HOME;
      },
    ],
    noInitialRun: true,
    print: (s) => { lines.push(s); console.log(s); },
    printErr: (s) => { lines.push(s); console.error(s); },
  });
  Module.__reshapeLines = lines;
  Module.callMain(['/nonexistent-placeholder.FCStd']);
  return Module;
}
