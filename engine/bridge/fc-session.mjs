// engine/bridge/fc-session.mjs
//
// The command bridge: a persistent FreeCAD document living inside the wasm
// engine, mutated by incremental commands, with the tip solid's mesh and the
// feature tree read back to JS after each op.
//
// Two layers:
//   createFcSession(Module) -- PORTABLE. Given an already-loaded, already-
//     initialized Emscripten module (freecad_run_python available, main()
//     already run once), returns a session with exec/read/mesh/tree + typed
//     PartDesign commands. Same code path in Node and in the browser; only the
//     module *loading* differs, and that is the caller's job.
//   loadNodeKernel(kernelJsPath) -- NODE/TEST ONLY. Reproduces the proven
//     loader (preRun ENV, FREECAD_HOME staging, noInitialRun + callMain
//     placeholder) from engine/scripts/smoke.mjs and hands back a Module ready
//     for createFcSession. The browser loader (engine/play/play.js) does the
//     equivalent with a preload data pack instead of host staging.
//
// Readback contract: Python prints exactly one line of the form
//   @@RESHAPE:<json>@@
// per read() call. JS captures stdout (via a print hook installed at session
// creation), scans for that sentinel, and JSON.parses the payload. Chosen over
// a temp-file handshake because it is identical under NODERAWFS (Node) and
// MEMFS (browser) -- no filesystem-path divergence.

const OUT_PATH = '/tmp/reshape_out.json';

// ---------------------------------------------------------------------------
// Portable session
// ---------------------------------------------------------------------------
export function createFcSession(Module) {
  if (!Module || typeof Module.ccall !== 'function') {
    throw new Error('createFcSession: need a loaded Emscripten Module with ccall');
  }

  // Emscripten binds its stdout/stderr callbacks (out/err) from Module.print /
  // Module.printErr during runtime init -- BEFORE this function runs -- so
  // reassigning Module.print here is too late to capture freecad_run_python
  // output. The loader therefore installs a capturing print AT module-creation
  // time and exposes the collected lines as Module.__reshapeLines; we read that
  // shared array. Fall back to a late hook only if it's absent (a caller that
  // didn't use one of our loaders); that path works only if out isn't bound yet.
  let buffer = Module.__reshapeLines;
  if (!Array.isArray(buffer)) {
    buffer = [];
    Module.__reshapeLines = buffer;
    const priorPrint = Module.print;
    const priorErr = Module.printErr;
    Module.print = (line) => { buffer.push(line); if (priorPrint) priorPrint(line); };
    Module.printErr = (line) => { buffer.push(line); if (priorErr) priorErr(line); };
  }

  const runPython = (code) =>
    Module.ccall('freecad_run_python', 'number', ['string'], [code]);

  // Run a snippet; return { rc, out } where out is everything printed during
  // this call (buffer is cleared first).
  function exec(code) {
    buffer.length = 0;
    const rc = runPython(code);
    return { rc, out: buffer.join('\n') };
  }

  // Run a snippet expected to print exactly one @@RESHAPE:<json>@@ line;
  // return the parsed object. Throws on non-zero rc or missing/invalid payload.
  // Read back a JSON payload the snippet wrote to OUT_PATH. Stdout capture is
  // not viable on the NODERAWFS node kernel (Python's fd 1 goes straight to the
  // host via fs.writeSync, bypassing Module.print AND process.stdout.write), so
  // the portable channel is a file: the snippet writes OUT_PATH, JS reads it
  // through Module.FS (MEMFS in the browser, the host mount under NODERAWFS).
  function read(code) {
    const { rc, out } = exec(code);
    if (rc !== 0) throw new Error(`freecad_run_python rc=${rc} (traceback on stderr)\n${out}`);
    const reader = Module.__reshapeReadFile
      || ((p) => Module.FS.readFile(p, { encoding: 'utf8' }));
    let txt;
    try { txt = reader(OUT_PATH); }
    catch (e) { throw new Error(`could not read ${OUT_PATH}: ${e.message}`); }
    try { return JSON.parse(txt); }
    catch (e) { throw new Error(`bad JSON in ${OUT_PATH}: ${e.message}\n${String(txt).slice(0, 400)}`); }
  }

  // -- lifecycle -----------------------------------------------------------
  // Create (or reset) the working document. Idempotent: closes an existing one.
  function newDocument(name = 'studio') {
    const { rc, out } = exec(
      `import FreeCAD as App\n` +
      `try:\n` +
      `    App.closeDocument(App.ActiveDocument.Name)\n` +
      `except Exception:\n` +
      `    pass\n` +
      `doc = App.newDocument(${JSON.stringify(name)})\n`
    );
    if (rc !== 0) throw new Error(`newDocument failed:\n${out}`);
  }

  // -- readback ------------------------------------------------------------
  // Tessellate one object's Shape (default: the active Body's tip) into a flat
  // three.js-ready mesh. deflection is the chord tolerance in mm.
  function mesh(objName = null, deflection = 0.1) {
    const target = objName
      ? `doc.getObject(${JSON.stringify(objName)})`
      : `(_active_solid(doc))`;
    return read(
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `def _active_solid(d):\n` +
      `    # last object that carries a non-null Shape (the visible result)\n` +
      `    hit = None\n` +
      `    for o in d.Objects:\n` +
      `        s = getattr(o, 'Shape', None)\n` +
      `        if s is not None and not s.isNull():\n` +
      `            hit = o\n` +
      `    return hit\n` +
      `o = ${target}\n` +
      `if o is None or getattr(o, 'Shape', None) is None or o.Shape.isNull():\n` +
      `    payload = {'positions': [], 'indices': [], 'empty': True}\n` +
      `else:\n` +
      `    vs, ts = o.Shape.tessellate(${Number(deflection)})\n` +
      `    positions = []\n` +
      `    for v in vs:\n` +
      `        positions.extend([v.x, v.y, v.z])\n` +
      `    indices = []\n` +
      `    for t in ts:\n` +
      `        indices.extend([t[0], t[1], t[2]])\n` +
      `    payload = {'object': o.Name, 'positions': positions, 'indices': indices, 'volume': round(o.Shape.Volume, 6)}\n` +
      `open(${JSON.stringify(OUT_PATH)}, 'w').write(json.dumps(payload))\n`
    );
  }

  // The feature tree: every document object as {name,label,type}. Headless has
  // no ViewObject, so visibility is not reported here (the UI tracks it).
  function tree() {
    return read(
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `rows = [{'name': o.Name, 'label': o.Label, 'type': o.TypeId} for o in doc.Objects]\n` +
      `open(${JSON.stringify(OUT_PATH)}, 'w').write(json.dumps({'objects': rows}))\n`
    );
  }

  // Save the active document to a real .FCStd and return its bytes (Uint8Array)
  // for download. Portable: Module.FS reads the file the kernel just wrote
  // (MEMFS in the browser, the host mount under NODERAWFS).
  function saveDocument(fcstdPath = '/tmp/model.FCStd') {
    const { rc, out } = exec(
      `import FreeCAD as App\n` +
      `App.ActiveDocument.saveAs(${JSON.stringify(fcstdPath)})\n`
    );
    if (rc !== 0) throw new Error(`saveDocument failed:\n${out}`);
    return Module.FS.readFile(fcstdPath);
  }

  // Open a .FCStd from bytes (Uint8Array): write it into the engine FS, then
  // App.openDocument() -- which becomes the new ActiveDocument, so subsequent
  // mesh()/tree()/commands operate on it. Returns the opened document's Name.
  function openDocument(bytes, fcstdPath = '/tmp/opened.FCStd') {
    Module.FS.writeFile(fcstdPath, bytes);
    return read(
      `import json, FreeCAD as App\n` +
      `doc = App.openDocument(${JSON.stringify(fcstdPath)})\n` +
      `doc.recompute()\n` +
      `open(${JSON.stringify(OUT_PATH)}, 'w').write(json.dumps({'name': doc.Name}))\n`
    ).name;
  }

  return {
    Module,
    exec,
    read,
    newDocument,
    mesh,
    tree,
    saveDocument,
    openDocument,
    // typed PartDesign/Sketcher commands are attached in fc-commands.mjs
    // (mechanical Python emitters) so this core stays small and stable.
  };
}

// ---------------------------------------------------------------------------
// Node/test-only loader. Mirrors engine/scripts/smoke.mjs's proven sequence:
// FREECAD_HOME staging (bind Mod/Ext at HOME and HOME/share, cp fallback),
// preRun ENV (the ONLY hook std::getenv sees), noInitialRun + a single
// placeholder callMain (keeps the app alive without opening a real file).
// Runs inside the kernel-build-final container where the resource trees exist.
// ---------------------------------------------------------------------------
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
  // Capture at creation time -- see the note in createFcSession on why a later
  // Module.print reassignment cannot work.
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
