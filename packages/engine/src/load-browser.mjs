// packages/engine/src/load-browser.mjs
//
// Wraps engine/play/studio.js's inline kernel bootstrap (lines ~137-168 of
// that file, as it stood before this port) into one clean async function.
// FreeCAD's wasm kernel does NOT load like replicad's -- see
// packages/kernel/src/config.ts's own header for that comparison. It has no
// ES module `import()`: it is classic `<script>` tag injection
// (`loadScript('freecad-data.js')`, then `loadScript('FreeCADCmd.js')`),
// a GLOBAL `window.Module` config object set before either script runs (with
// `preRun`, `print`, `printErr`, `noInitialRun`), then the GLOBAL
// `createFreeCAD(window.Module)` factory and one placeholder `callMain([...])`
// to bring the app up without opening a real file. This function exists so
// the rest of the app never has to know any of that.
//
// getEngineBaseUrl() (config.ts) supplies the URL prefix both scripts load
// from -- packages/sandbox-dev/vite.config.ts's engineStaticServer() serves
// engine/build/g5-artifacts/ (FreeCADCmd.js/.wasm) and
// engine/play/freecad-data.* at that prefix.

import { getEngineBaseUrl } from './config.js';

// Track U #5 fix, carried over verbatim from engine/play/studio.js: the
// FreeCAD-web port's glue reads a bare `resolveGlobalSymbol` (an Emscripten
// dynamic-linking symbol) even though this build links static
// (-sJSPI=0). Its own guard, `if (!WebAssembly.promising) return`, does NOT
// short-circuit in a JSPI-capable browser (Chrome), so the glue reads the
// never-declared global and throws inside __wasm_call_ctors, aborting kernel
// init before it ever reaches a ready state. Predefine it as a benign stub
// (a static build never actually invokes it) so the read succeeds. Must
// exist before createFreeCAD() runs the ctors, i.e. before FreeCADCmd.js is
// injected below.
function installResolveGlobalSymbolStub() {
  globalThis.resolveGlobalSymbol =
    globalThis.resolveGlobalSymbol || function () { return { sym: undefined }; };
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

/**
 * Load the FreeCAD wasm kernel and bring it to a ready Emscripten Module,
 * equivalent to studio.js's inline IIFE. `baseUrl` defaults to
 * getEngineBaseUrl() (`/reshape/engine`); pass one explicitly to override.
 *
 * Returns the ready Module -- pass it straight to createFcSession() (see
 * fc-session.mjs) to open a document and start issuing commands.
 */
export async function loadFreeCadEngine(baseUrl = getEngineBaseUrl()) {
  installResolveGlobalSymbolStub();

  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const lines = [];
  window.Module = {
    print: (m) => lines.push(m),
    printErr: (m) => lines.push(`[err] ${m}`),
    noInitialRun: true,
    preRun: [(m) => {
      m.ENV.FREECAD_WASM_KERNEL = '1';
      m.ENV.FREECAD_HOME = '/freecad';
      m.ENV.PYTHONHOME = '/pyhome';
      m.ENV.PYTHONPATH = '/pyhome/lib/python314.zip';
    }],
  };

  await loadScript(`${base}freecad-data.js`);
  await loadScript(`${base}FreeCADCmd.js`);

  // FreeCADCmd.js (classic script, not a module) defines the global
  // createFreeCAD factory -- same convention studio.js relies on.
  const mod = await globalThis.createFreeCAD(window.Module);
  mod.__reshapeLines = lines;
  mod.callMain(['/nonexistent-placeholder.FCStd']);
  return mod;
}
