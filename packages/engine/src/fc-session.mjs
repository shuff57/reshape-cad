// packages/engine/src/fc-session.mjs
//
// The command bridge: a persistent FreeCAD document living inside the wasm
// engine, mutated by incremental commands, with the tip solid's mesh and the
// feature tree read back to JS after each op.
//
// PORTABLE half only. createFcSession(Module) -- given an already-loaded,
// already-initialized Emscripten module (freecad_run_python available,
// main() already run once), returns a session with exec/read/mesh/tree +
// typed PartDesign commands. Same code path in Node and in the browser; only
// the module *loading* differs, and that is the caller's job -- see
// fc-session-node.mjs (Node/test-only) or load-browser.mjs (browser) for the
// two loaders. Split out of a single fc-session.mjs (SPEC-engine-port.md
// §2.1): loadNodeKernel() uses node:fs/node:child_process/node:module and
// must never ship in the browser bundle this file is part of.
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
      `        if s is not None and not s.isNull() and len(s.Faces) > 0:\n` +
      `            hit = o  # require faces: a solid, not a leftover sketch wire\n` +
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

  // Per-FACE tessellation for 3D selection (the Slice-2 keystone). Where mesh()
  // returns one undifferentiated blob, this returns one mesh per OCCT face and
  // one polyline per edge, each tagged with its 0-based sub-element index. That
  // index maps to FreeCAD's 1-based sub-element name -- faceId i == "Face{i+1}",
  // edgeId j == "Edge{j+1}" (verified: getElement('Face1').Area == Faces[0].Area)
  // -- so a click in 3D that resolves to faceId i can drive Pocket/Fillet on
  // "Face{i+1}" later. Same active-solid target rule as mesh().
  function meshFaces(objName = null, deflection = 0.1) {
    const target = objName
      ? `doc.getObject(${JSON.stringify(objName)})`
      : `(_active_solid(doc))`;
    return read(
      `import json, FreeCAD as App\n` +
      `doc = App.ActiveDocument\n` +
      `def _active_solid(d):\n` +
      `    hit = None\n` +
      `    for o in d.Objects:\n` +
      `        s = getattr(o, 'Shape', None)\n` +
      `        if s is not None and not s.isNull() and len(s.Faces) > 0:\n` +
      `            hit = o  # require faces: a solid, not a leftover sketch wire\n` +
      `    return hit\n` +
      `o = ${target}\n` +
      `if o is None or getattr(o, 'Shape', None) is None or o.Shape.isNull():\n` +
      `    payload = {'faces': [], 'edges': [], 'empty': True}\n` +
      `else:\n` +
      `    sh = o.Shape\n` +
      `    faces = []\n` +
      `    for i, f in enumerate(sh.Faces):\n` +
      `        vs, ts = f.tessellate(${Number(deflection)})\n` +
      `        pos = []\n` +
      `        for v in vs:\n` +
      `            pos.extend([v.x, v.y, v.z])\n` +
      `        idx = []\n` +
      `        for t in ts:\n` +
      `            idx.extend([t[0], t[1], t[2]])\n` +
      `        faces.append({'id': i, 'positions': pos, 'indices': idx})\n` +
      `    edges = []\n` +
      `    for j, e in enumerate(sh.Edges):\n` +
      `        pts = e.discretize(Deflection=${Number(deflection)})\n` +
      `        flat = []\n` +
      `        for p in pts:\n` +
      `            flat.extend([p.x, p.y, p.z])\n` +
      `        edges.append({'id': j, 'points': flat})\n` +
      `    payload = {'object': o.Name, 'faces': faces, 'edges': edges, 'volume': round(sh.Volume, 6)}\n` +
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

  // Export one object's solid to an ASCII STL and return its bytes
  // (Uint8Array) for download. Same portable channel as saveDocument: the
  // kernel writes into the engine FS (MEMFS in the browser, the host mount
  // under NODERAWFS) and JS reads the file back out.
  //
  // Deflection is an ABSOLUTE chord tolerance in mm (TopoShape.cpp:1002 passes
  // isRelative=false), so 0.01 means 0.01mm regardless of model size -- fine
  // for a 10mm part, slow and enormous for a 1000mm one. It is a parameter
  // rather than a constant for that reason, but nothing in the UI passes it
  // yet; the default matches TopoShapePyImp.cpp's own.
  function exportStl(objectName, stlPath = '/tmp/model.stl', deflection = 0.01) {
    // Clear the target FIRST. Without this, an export that writes nothing
    // leaves the PREVIOUS run's file in place and readFile happily returns
    // it -- the user downloads a stale model under a new name and there is
    // no symptom at all. Unlink before, and "the file exists after" becomes
    // real proof this export produced it.
    try { Module.FS.unlink(stlPath); } catch { /* first run: nothing to clear */ }
    const { rc, out } = exec(
      `import FreeCAD as App\n` +
      `_o = App.ActiveDocument.getObject(${JSON.stringify(objectName)})\n` +
      `if _o is None: raise ValueError('no such object: ' + ${JSON.stringify(objectName)})\n` +
      `_o.Shape.exportStl(${JSON.stringify(stlPath)}, ${Number(deflection)})\n`
    );
    if (rc !== 0) throw new Error(`exportStl failed:\n${out}`);
    // Module.FS.readFile throws an Emscripten ErrnoError, which does NOT
    // carry a .message. studio.js's guard() does `e.message.split(...)`, so
    // letting it escape crashes the handler and the user sees NOTHING -- no
    // log line, no download, no error. Measured in the browser: exporting a
    // bare Sketch (state.tip can be one) got exactly that. Translate it into
    // a real Error that says what to do instead.
    let bytes;
    try { bytes = Module.FS.readFile(stlPath); }
    catch {
      throw new Error(
        `exportStl: ${objectName} wrote no STL. Only a solid has faces to mesh — ` +
        `a sketch or a bare wire exports nothing. Pad it into a solid first.`
      );
    }
    if (!bytes.length) throw new Error(`exportStl: ${objectName} exported an empty STL (0 bytes)`);
    return bytes;
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
    meshFaces,
    tree,
    saveDocument,
    openDocument,
    exportStl,
    // typed PartDesign/Sketcher commands are attached in fc-commands.mjs
    // (mechanical Python emitters) so this core stays small and stable.
  };
}
