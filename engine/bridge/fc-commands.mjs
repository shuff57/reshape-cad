// engine/bridge/fc-commands.mjs
//
// Typed PartDesign command emitters on top of the command bridge core
// (fc-session.mjs). Two layers:
//
//   emit.*          -- PURE Python-source emitters. Plain args in, a Python
//                      snippet string out. No side effects, no I/O, no engine:
//                      unit-testable by asserting on the emitted strings.
//   attachCommands  -- thin session wrappers. Binds one method per emitter
//                      onto a session created by createFcSession(): builds the
//                      Python via emit.*, runs it with session.exec(), throws
//                      on non-zero rc (Python raised), returns the created or
//                      edited object's name. Nothing else on the session is
//                      touched or reimplemented -- exec/read/mesh/tree stay
//                      the core's.
//
// Emitted Python assumes a live persistent document (doc = App.ActiveDocument,
// created via session.newDocument()). Every snippet re-imports FreeCAD/Part/
// Sketcher defensively (imports are idempotent) and re-binds doc, so snippets
// are safe to send one at a time. v1 is XY-plane only: a sketch added to a
// Body with no attachment sits on the global XY plane, and a geometrically-
// closed wire is enough for Pad -- no constraints, no face attachment.
//
// Injection hygiene: string names are emitted via JSON.stringify, which is a
// valid Python double-quoted string literal, so names containing quotes or
// backslashes cannot break out of the literal. Numbers are emitted bare:
// integers stay integers (40, not 40.0), floats pass through as-is; anything
// that is not a finite number is rejected rather than interpolated.

const pyStr = (s) => JSON.stringify(String(s));

// A Python list literal of strings from a JS string array; each element is a
// safe double-quoted literal (JSON.stringify), so sub-element names can't break
// out. Throws on an empty list — a fillet/chamfer needs at least one edge.
const pyStrList = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new TypeError('expected a non-empty array of sub-element names');
  }
  return '[' + arr.map(pyStr).join(', ') + ']';
};

const pyNum = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${what}: expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
};

const vec = (x, y, z = 0) =>
  `App.Vector(${pyNum(x, 'vector x')},${pyNum(y, 'vector y')},${pyNum(z, 'vector z')})`;

const HEAD =
  'import FreeCAD as App\n' +
  'import Part\n' +
  'import Sketcher\n' +
  'doc = App.ActiveDocument\n';

const RECT_END = 'doc.recompute()\n';

// Fillet/Chamfer can fail EXPECTEDLY (radius too big). Raising to
// freecad_run_python dumps a Python traceback into the browser status log, so
// instead these commands catch internally and report a clean status through
// the file channel (same OUT_PATH the readback commands use). The wrapper reads
// it and throws only a short, user-facing message — no traceback.
const OUT_PATH = '/tmp/reshape_out.json';
const wrapStatus = (body) =>
  'import json\n' + HEAD +
  '_res = {"ok": True}\n' +
  'try:\n' +
  body.replace(/^/gm, '    ') +
  '\nexcept Exception as _e:\n' +
  '    _res = {"ok": False, "error": str(_e)}\n' +
  `open(${JSON.stringify(OUT_PATH)}, "w").write(json.dumps(_res))\n`;

// Editable-history: each feature type's single driving parameter. Editing any
// other property, or a Sketch, is out of scope (a Sketch is re-entered in the
// 2D editor instead).
const FEATURE_PARAM =
  "_PARAM = {'PartDesign::Pad':'Length', 'PartDesign::Pocket':'Length', " +
  "'PartDesign::Revolution':'Angle', 'PartDesign::Fillet':'Radius', " +
  "'PartDesign::Chamfer':'Size'}\n";

export const emit = {
  // Add a PartDesign Body to the active document. Returns the Python source.
  newBody(name = 'Body') {
    return HEAD + `doc.addObject("PartDesign::Body", ${pyStr(name)})\n`;
  },

  // Add a Sketch to a Body and draw a closed rectangle wire
  // 0,0 -> w,0 -> w,h -> 0,h -> 0,0 (matches the proven pd-smoke pattern:
  // a geometrically-closed wire, no constraints). Recomputes.
  sketchRect(bodyName, sketchName, width, height) {
    const w = pyNum(width, 'width');
    const h = pyNum(height, 'height');
    return (
      HEAD +
      `sk = doc.getObject(${pyStr(bodyName)}).newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `sk.addGeometry(Part.LineSegment(${vec(0, 0)}, ${vec(w, 0)}), False)\n` +
      `sk.addGeometry(Part.LineSegment(${vec(w, 0)}, ${vec(w, h)}), False)\n` +
      `sk.addGeometry(Part.LineSegment(${vec(w, h)}, ${vec(0, h)}), False)\n` +
      `sk.addGeometry(Part.LineSegment(${vec(0, h)}, ${vec(0, 0)}), False)\n` +
      RECT_END
    );
  },

  // Add a Sketch to a Body with one circle centered (cx,cy) on the XY plane.
  // Recomputes.
  sketchCircle(bodyName, sketchName, radius, cx = 0, cy = 0) {
    const r = pyNum(radius, 'radius');
    return (
      HEAD +
      `sk = doc.getObject(${pyStr(bodyName)}).newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `sk.addGeometry(Part.Circle(${vec(cx, cy)}, App.Vector(0,0,1), ${r}), False)\n` +
      RECT_END
    );
  },

  // Pad a Body's sketch to a solid. Profile is resolved by name so the snippet
  // needs no live handle to the sketch object. Recomputes.
  pad(bodyName, sketchName, padName, length) {
    return (
      HEAD +
      `pad = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Pad", ${pyStr(padName)})\n` +
      `pad.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `pad.Length = ${pyNum(length, 'length')}\n` +
      RECT_END
    );
  },

  // Set a numeric property on a document object by name (setattr), recompute.
  // value must be a finite number: it is emitted bare, never quoted.
  setParam(objName, prop, value) {
    return (
      HEAD +
      `setattr(doc.getObject(${pyStr(objName)}), ${pyStr(prop)}, ${pyNum(value, 'value')})\n` +
      RECT_END
    );
  },

  // Fillet the picked edges of a Body's tip solid. edgeNames are FreeCAD
  // sub-element names on `baseName` (e.g. ['Edge3','Edge7']) — the UI maps a
  // picked 0-based edge id to "Edge{id+1}". The Fillet becomes the new tip.
  //
  // CRITICAL guard: an impossible fillet (radius too large for the local
  // geometry) does NOT raise on recompute — OCCT's fillet algorithm corrupts
  // the wasm heap DURING the failed recompute ("memory access out of bounds"),
  // and no later removeObject can heal it: the very next tessellation crashes
  // the browser session. Detection-after-the-fact is therefore useless; the
  // radius must be rejected BEFORE recompute. We cap it conservatively at
  // ~half the solid's smallest bounding-box dimension — grossly oversized
  // radii (the crash cases) are many times over that, while normal fillets sit
  // well under it. A radius under the cap that still fails is caught by the
  // secondary State check (safe to read; only tessellation crashes).
  fillet(bodyName, baseName, edgeNames, radius) {
    const r = pyNum(radius, 'radius');
    return wrapStatus(
      `base = doc.getObject(${pyStr(baseName)})\n` +
      `bb = base.Shape.BoundBox\n` +
      `maxr = 0.49 * min(bb.XLength, bb.YLength, bb.ZLength)\n` +
      `if ${r} > maxr:\n` +
      `    raise ValueError('fillet radius %.3g is too large for this solid (max ~%.3g mm) — use a smaller radius' % (${r}, maxr))\n` +
      `fl = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Fillet", "Fillet")\n` +
      `fl.Base = (base, ${pyStrList(edgeNames)})\n` +
      `fl.Radius = ${r}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in fl.State) or fl.Shape.isNull():\n` +
      `    doc.removeObject(fl.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('fillet failed for this edge — try a smaller radius')`
    );
  },

  // Chamfer (bevel) the picked edges. Same crash-guard + cap as fillet, driving
  // .Size instead of .Radius.
  chamfer(bodyName, baseName, edgeNames, size) {
    const z = pyNum(size, 'size');
    return wrapStatus(
      `base = doc.getObject(${pyStr(baseName)})\n` +
      `bb = base.Shape.BoundBox\n` +
      `maxs = 0.49 * min(bb.XLength, bb.YLength, bb.ZLength)\n` +
      `if ${z} > maxs:\n` +
      `    raise ValueError('chamfer size %.3g is too large for this solid (max ~%.3g mm) — use a smaller size' % (${z}, maxs))\n` +
      `ch = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Chamfer", "Chamfer")\n` +
      `ch.Base = (base, ${pyStrList(edgeNames)})\n` +
      `ch.Size = ${z}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in ch.State) or ch.Shape.isNull():\n` +
      `    doc.removeObject(ch.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('chamfer failed for this edge — try a smaller size')`
    );
  },

  // Pocket: cut a closed profile (a sketch, usually attached to a face) inward
  // by `length`. Subtractive counterpart to Pad. Same clean-status wrapper: an
  // open/invalid profile leaves a null shape — detect it, delete, report a
  // clear message instead of a phantom feature.
  pocket(bodyName, sketchName, pocketName, length) {
    return wrapStatus(
      `pk = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Pocket", ${pyStr(pocketName)})\n` +
      `pk.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `pk.Length = ${pyNum(length, 'length')}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in pk.State) or pk.Shape.isNull():\n` +
      `    doc.removeObject(pk.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('pocket failed — the profile must be one closed loop lying on the face')`
    );
  },

  // Hole-through: cut a closed profile (a sketch) all the way through the
  // body, regardless of depth. A PartDesign::Pocket with Type = 'ThroughAll' —
  // the FreeCAD hole idiom, so no depth number to compute and get wrong.
  // Midplane = True: the cut is made symmetric about the sketch plane, so the
  // hole reaches material whichever side FreeCAD's pocket direction convention
  // picks (kernel-measured: a bare XY sketch under a Pad cuts -Z only, i.e.
  // empty space — the box came out uncut at vol=32000; see msgbox #59).
  // Same clean-status wrapper as pocket: an open/invalid profile leaves a
  // null shape — detect it, delete, report a clear message.
  holeThrough(bodyName, sketchName, holeName) {
    return wrapStatus(
      `pk = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Pocket", ${pyStr(holeName)})\n` +
      `pk.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `pk.Type = 'ThroughAll'\n` +
      `pk.Midplane = True\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in pk.State) or pk.Shape.isNull():\n` +
      `    doc.removeObject(pk.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('hole failed — the profile must be one closed loop lying on the solid')`
    );
  },

  // Additive PartDesign primitives. Unlike profile-driven features (pocket,
  // revolve), these build from positive dimensions alone, so they cannot fail
  // from an open/invalid profile — no clean-status wrapper, no null-shape
  // guard. Each is created as a Body method (doc.getObject(BODY).newObject),
  // mirroring emit.pad. pyNum guards every number (throws in JS before
  // emission), so a bad dimension never reaches the engine.
  sphere(bodyName, featName, radius) {
    return (
      HEAD +
      `sp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Sphere", ${pyStr(featName)})\n` +
      `sp.Radius = ${pyNum(radius, 'radius')}\n` +
      RECT_END
    );
  },

  cone(bodyName, featName, radius1, radius2, height) {
    return (
      HEAD +
      `cn = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Cone", ${pyStr(featName)})\n` +
      `cn.Radius1 = ${pyNum(radius1, 'radius1')}\n` +
      `cn.Radius2 = ${pyNum(radius2, 'radius2')}\n` +
      `cn.Height = ${pyNum(height, 'height')}\n` +
      RECT_END
    );
  },

  torus(bodyName, featName, ringRadius, tubeRadius) {
    return (
      HEAD +
      `tr = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Torus", ${pyStr(featName)})\n` +
      `tr.Radius1 = ${pyNum(ringRadius, 'ringRadius')}\n` +
      `tr.Radius2 = ${pyNum(tubeRadius, 'tubeRadius')}\n` +
      RECT_END
    );
  },

  prism(bodyName, featName, radius, height) {
    return (
      HEAD +
      `pr = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Prism", ${pyStr(featName)})\n` +
      `pr.Polygon = 6\n` +
      `pr.Circumradius = ${pyNum(radius, 'radius')}\n` +
      `pr.Height = ${pyNum(height, 'height')}\n` +
      RECT_END
    );
  },

  wedge(bodyName, featName, width, height) {
    return (
      HEAD +
      `wd = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Wedge", ${pyStr(featName)})\n` +
      `wd.Width = ${pyNum(width, 'width')}\n` +
      `wd.Height = ${pyNum(height, 'height')}\n` +
      RECT_END
    );
  },

  // Revolve: spin a closed profile around the sketch's vertical axis (V_Axis)
  // into a solid of revolution (a lathe turn). angle in degrees (default 360).
  // The profile must not cross the axis. Same clean-status guard as pocket.
  revolve(bodyName, sketchName, revName, angle = 360) {
    return wrapStatus(
      `rev = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Revolution", ${pyStr(revName)})\n` +
      `rev.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `rev.ReferenceAxis = (doc.getObject(${pyStr(sketchName)}), ['V_Axis'])\n` +
      `rev.Angle = ${pyNum(angle, 'angle')}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in rev.State) or rev.Shape.isNull():\n` +
      `    doc.removeObject(rev.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('revolve failed — the profile must be a closed loop that does not cross the vertical axis')`
    );
  },

  // -- editable history ----------------------------------------------------
  // Read a feature's editable driving parameter (name/label/type/param/value),
  // for the history editor. param is null for a feature with nothing to edit.
  featureInfo(objName) {
    return (
      'import json\n' + HEAD + FEATURE_PARAM +
      `o = doc.getObject(${pyStr(objName)})\n` +
      `if o is None:\n` +
      `    _res = {'ok': False, 'error': 'no such feature'}\n` +
      `else:\n` +
      `    _p = _PARAM.get(o.TypeId)\n` +
      `    _res = {'ok': True, 'name': o.Name, 'label': o.Label, 'type': o.TypeId.split('::')[-1], 'param': _p}\n` +
      `    if _p:\n` +
      `        _v = getattr(o, _p)\n` +
      `        _res['value'] = float(_v.Value) if hasattr(_v, 'Value') else float(_v)\n` +
      `open(${JSON.stringify(OUT_PATH)}, 'w').write(json.dumps(_res))\n`
    );
  },

  // Edit a feature's driving parameter, SAFELY. Fillet/Chamfer get the same
  // bbox radius cap as creation (an oversized value corrupts wasm). After the
  // edit + recompute, if ANY feature is left Invalid (FreeCAD's topological
  // naming can break a downstream ref on an upstream change), the value is
  // reverted and a clear error raised — the model is never left broken.
  editFeature(objName, value) {
    const v = pyNum(value, 'value');
    return wrapStatus(
      FEATURE_PARAM +
      `o = doc.getObject(${pyStr(objName)})\n` +
      `if o is None:\n` +
      `    raise ValueError('no such feature')\n` +
      `p = _PARAM.get(o.TypeId)\n` +
      `if not p:\n` +
      `    raise ValueError('this feature has no editable parameter')\n` +
      `if o.TypeId in ('PartDesign::Fillet', 'PartDesign::Chamfer'):\n` +
      `    bb = o.Base[0].Shape.BoundBox\n` +
      `    maxr = 0.49 * min(bb.XLength, bb.YLength, bb.ZLength)\n` +
      `    if ${v} > maxr:\n` +
      `        raise ValueError('value %.3g is too large for this solid (max ~%.3g mm)' % (${v}, maxr))\n` +
      `old = getattr(o, p)\n` +
      `oldv = old.Value if hasattr(old, 'Value') else old\n` +
      `setattr(o, p, ${v})\n` +
      `doc.recompute()\n` +
      `bad = [x.Label for x in doc.Objects if 'Invalid' in x.State]\n` +
      `if bad:\n` +
      `    setattr(o, p, oldv)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('that value broke a later feature (%s) — reverted' % ', '.join(bad))`
    );
  },

  // Delete a feature — but only if nothing depends on it (delete from the tip
  // backward), so the chain is never left with an orphaned reference. Before
  // removing, move the Body.Tip back to the previous feature: otherwise Tip is
  // left dangling at the just-deleted object and the Body's mirrored Shape
  // points at freed geometry, so the next tessellation reads out-of-bounds
  // memory and crashes wasm ("mesh: memory access out of bounds").
  deleteFeature(objName) {
    return wrapStatus(
      `o = doc.getObject(${pyStr(objName)})\n` +
      `if o is None:\n` +
      `    raise ValueError('no such feature')\n` +
      `deps = sorted(set(x.Label for x in o.InList if x.TypeId.startswith('PartDesign::') and x.TypeId != 'PartDesign::Body'))\n` +
      `if deps:\n` +
      `    raise ValueError('delete the later feature(s) first — %s depends on this' % ', '.join(deps))\n` +
      `body = None\n` +
      `for b in doc.Objects:\n` +
      `    if b.TypeId == 'PartDesign::Body' and o in b.Group:\n` +
      `        body = b\n` +
      `        break\n` +
      `prev = getattr(o, 'BaseFeature', None)\n` +
      `if body is not None and getattr(body, 'Tip', None) is o:\n` +
      `    body.Tip = prev\n` +
      `doc.removeObject(o.Name)\n` +
      `doc.recompute()`
    );
  },
};

// ---------------------------------------------------------------------------
// Session wrappers. attachCommands(session) adds one method per emitter to a
// createFcSession() session and returns the same session (chainable).
// ---------------------------------------------------------------------------
export function attachCommands(session) {
  if (!session || typeof session.exec !== 'function') {
    throw new Error('attachCommands: need a session with exec() (see fc-session.mjs)');
  }

  const run = (what, py) => {
    const { rc, out } = session.exec(py);
    if (rc !== 0) throw new Error(`${what} failed (rc=${rc}):\n${out}`);
  };

  session.newBody = (name = 'Body') => {
    run('newBody', emit.newBody(name));
    return name;
  };
  session.sketchRect = (bodyName, sketchName, width, height) => {
    run('sketchRect', emit.sketchRect(bodyName, sketchName, width, height));
    return sketchName;
  };
  session.sketchCircle = (bodyName, sketchName, radius, cx = 0, cy = 0) => {
    run('sketchCircle', emit.sketchCircle(bodyName, sketchName, radius, cx, cy));
    return sketchName;
  };
  session.pad = (bodyName, sketchName, padName, length) => {
    run('pad', emit.pad(bodyName, sketchName, padName, length));
    return padName;
  };
  session.setParam = (objName, prop, value) => {
    run('setParam', emit.setParam(objName, prop, value));
    return objName;
  };
  // Fillet/Chamfer report success/failure through the file channel (no
  // traceback): read the status and throw only the short user-facing message.
  session.fillet = (bodyName, baseName, edgeNames, radius) => {
    const res = session.read(emit.fillet(bodyName, baseName, edgeNames, radius));
    if (!res.ok) throw new Error(res.error || 'fillet failed');
    return 'Fillet';
  };
  session.chamfer = (bodyName, baseName, edgeNames, size) => {
    const res = session.read(emit.chamfer(bodyName, baseName, edgeNames, size));
    if (!res.ok) throw new Error(res.error || 'chamfer failed');
    return 'Chamfer';
  };
  session.pocket = (bodyName, sketchName, pocketName, length) => {
    const res = session.read(emit.pocket(bodyName, sketchName, pocketName, length));
    if (!res.ok) throw new Error(res.error || 'pocket failed');
    return pocketName;
  };
  session.holeThrough = (bodyName, sketchName, holeName) => {
    const res = session.read(emit.holeThrough(bodyName, sketchName, holeName));
    if (!res.ok) throw new Error(res.error || 'hole failed');
    return holeName;
  };
  // Additive primitives build from positive dimensions alone, so they use
  // pad's run() pattern (not the read/status pattern) — no wrapStatus.
  session.sphere = (bodyName, featName, radius) => {
    run('sphere', emit.sphere(bodyName, featName, radius));
    return featName;
  };
  session.cone = (bodyName, featName, radius1, radius2, height) => {
    run('cone', emit.cone(bodyName, featName, radius1, radius2, height));
    return featName;
  };
  session.torus = (bodyName, featName, ringRadius, tubeRadius) => {
    run('torus', emit.torus(bodyName, featName, ringRadius, tubeRadius));
    return featName;
  };
  session.prism = (bodyName, featName, radius, height) => {
    run('prism', emit.prism(bodyName, featName, radius, height));
    return featName;
  };
  session.wedge = (bodyName, featName, width, height) => {
    run('wedge', emit.wedge(bodyName, featName, width, height));
    return featName;
  };
  session.revolve = (bodyName, sketchName, revName, angle = 360) => {
    const res = session.read(emit.revolve(bodyName, sketchName, revName, angle));
    if (!res.ok) throw new Error(res.error || 'revolve failed');
    return revName;
  };
  // editable history
  session.featureInfo = (objName) => session.read(emit.featureInfo(objName));
  session.editFeature = (objName, value) => {
    const res = session.read(emit.editFeature(objName, value));
    if (!res.ok) throw new Error(res.error || 'edit failed');
    return objName;
  };
  session.deleteFeature = (objName) => {
    const res = session.read(emit.deleteFeature(objName));
    if (!res.ok) throw new Error(res.error || 'delete failed');
    return objName;
  };

  return session;
}