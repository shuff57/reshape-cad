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

// ---------------------------------------------------------------------------
// The "it succeeded and did nothing" guard, for the sweep family.
//
// Every sweep emitter below already rolls back on `'Invalid' in State` or a
// null Shape. That catches a sweep the kernel REFUSES. It cannot catch the
// far quieter case, measured 2026-09-09 by the P1c-3 kernel gate:
//
//   additivePipe    two XY sketches  ->  volume 0.000,     no error
//   subtractivePipe two XY sketches  ->  32000 -> 32000,   no error
//   subtractiveLoft two XY sketches  ->  32000 -> 32000,   no error
//
// All three recomputed clean, reported no Invalid state and a non-null Shape,
// and changed nothing. The user gets a feature in the tree, an unchanged
// model, and silence.
//
// This is the DEFAULT outcome, not an edge case: a loft or a pipe needs its
// two sketches on DIFFERENT planes, and `Rect Sketch` / `Circle Sketch` only
// ever make XY sketches. Two of them land on top of each other, so there is no
// distance to loft across and no path to sweep along. The only way to a second
// plane in the studio today is picking a face and using New Sketch.
//
// So: measure the body's volume before and after, and if the feature moved it
// by nothing, roll back and say which mistake it was. volGuardHead binds
// `_body` and `_v0`; volGuardTail re-reads and compares.
const volGuardHead = (bodyName) =>
  `_body = doc.getObject(${pyStr(bodyName)})\n` +
  `_v0 = _body.Shape.Volume if (_body.Shape is not None and not _body.Shape.isNull()) else 0.0\n`;

// 1e-6 mm^3, not 0: OCCT volumes are floating point and a genuine no-op
// returns bit-identical values, so any epsilon this small only guards against
// a formatting artefact -- it will never mask a real cut.
const volGuardTail = (varName, why) =>
  `_v1 = _body.Shape.Volume if (_body.Shape is not None and not _body.Shape.isNull()) else 0.0\n` +
  `if abs(_v1 - _v0) < 1e-6:\n` +
  `    doc.removeObject(${varName}.Name)\n` +
  `    doc.recompute()\n` +
  `    raise ValueError(${pyStr(why)})\n`;

const SAME_PLANE_HINT =
  ' — the two sketches are on the same plane, so there is nothing to sweep across.' +
  ' Pick a face on the solid, then New Sketch, to draw the second one on another plane.';

// The helix pitch rule, enforced instead of merely documented.
//
// transpile-integration.mjs has carried it as a comment since msgbox #73:
// "Helix pitch (Height/Turns) must be >= profile diameter or consecutive turns
// overlap and the swept solid self-intersects". Unenforced, violating it does
// not raise -- OCCT goes away and grinds. Measured 2026-09-09:
//
//   container, offset circle r=2, pitch 6.67   -> 14 MINUTES, 3.4GB, killed
//   browser,   40x40 rect profile, pitch 6.67  -> tab frozen past 90s
//
// The browser case is the ordinary one: `Rect Sketch` makes a 40x40 profile
// and the Helix inputs default to H20/T3, so the FIRST thing a student clicks
// violates the rule by a factor of six and the tab stops responding. A hang is
// the worst possible refusal, so refuse first and say the number.
const helixPitchGuard = (sketchName, height, turns) =>
  `_hp = doc.getObject(${pyStr(sketchName)}).Shape.BoundBox\n` +
  `_dia = max(_hp.XLength, _hp.YLength)\n` +
  `_pitch = (${height}) / (${turns}) if (${turns}) else 0.0\n` +
  `if _pitch < _dia:\n` +
  `    raise ValueError('helix pitch %.3g mm is smaller than the profile (%.3g mm across), so the turns would overlap and the sweep can hang. Raise Height, lower Turns, or draw a smaller profile.' % (_pitch, _dia))\n`;

// Editable-history: each feature type's single driving parameter. Editing any
// other property, or a Sketch, is out of scope (a Sketch is re-entered in the
// 2D editor instead).
const FEATURE_PARAM =
  "_PARAM = {'PartDesign::Pad':'Length', 'PartDesign::Pocket':'Length', " +
  "'PartDesign::Revolution':'Angle', 'PartDesign::Fillet':'Radius', " +
  "'PartDesign::Chamfer':'Size'}\n";

// Emits the body of the world-frame axis proxy sketch used by emit.patternAxis
// and by linearPattern/polarPattern's own worldAxis branch below -- see
// emit.patternAxis's own header comment for the full explanation and the
// real-kernel verification this formula rests on.
const axisSketchPy = (bodyVar, sketchName, origin, direction) => {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  return (
    `${sketchName}_obj = ${bodyVar}.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
    `worldPos = App.Vector(${pyNum(ox, 'origin.x')}, ${pyNum(oy, 'origin.y')}, ${pyNum(oz, 'origin.z')})\n` +
    `worldDir = App.Vector(${pyNum(dx, 'direction.x')}, ${pyNum(dy, 'direction.y')}, ${pyNum(dz, 'direction.z')})\n` +
    `worldRot = App.Rotation(App.Vector(0,1,0), worldDir)\n` +
    `${sketchName}_obj.Placement = ${bodyVar}.Placement.inverse().multiply(App.Placement(worldPos, worldRot))\n`
  );
};

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

  // Hollow (shell) a solid to a wall thickness via PartDesign::Thickness --
  // the third DressUp sibling of Fillet/Chamfer (PROPERTY_SOURCE(PartDesign::
  // Thickness, PartDesign::DressUp) in FeatureThickness.cpp), so it takes the
  // exact same Base = (base, subElementNames) tuple shape and the same
  // Invalid/null-shape rollback as fillet()/chamfer() above. faceNames is the
  // list of faces to REMOVE (open) -- MUST be non-empty, enforced by
  // pyStrList()'s own guard, not merely documented: FeatureThickness.cpp's
  // own execute() early-returns the UNCHANGED base shape (no exception) the
  // instant Base's sub-element list is empty, and the underlying
  // TopoShape::makeElementThickSolid (TopoShapeExpansion.cpp) throws "Null
  // input shape" if it is ever reached with zero faces at all -- this
  // kernel's OWN restriction, not vanilla FreeCAD/OCCT's MakeThickSolidByJoin
  // (which accepts an empty closing list). There is therefore no way to
  // build a fully-closed hollow (no opening) via this command; callers must
  // always name at least one face.
  // Value is POSITIVE for an inward hollow -- do NOT negate it the way
  // occt-build.ts negates its own OCCT call. Measured directly:
  // PartDesign::Thickness.Reversed defaults to true (Thickness::Thickness(),
  // FeatureThickness.cpp) and its execute() computes
  // `thickness = (reversed ? -1. : 1.) * Value`, so Reversed=true already
  // supplies the negation -- passing a positive Value with Reversed left at
  // its default (set explicitly below anyway, not left to chance) reproduces
  // occt-build.ts's own `-f.thickness` inward offset exactly. A positive
  // Value with Reversed=True measured as a correct inward hollow (box
  // 40x40x20, one face open, thickness 2 -> volume 10112, well under the
  // 32000 solid); the same Value negative left the shape volume UNCHANGED at
  // 32000 instead of erroring, so a wrong sign fails silently, not loudly --
  // pass f.thickness through unmodified.
  thickness(bodyName, baseName, faceNames, value) {
    const v = pyNum(value, 'thickness value');
    return wrapStatus(
      `th = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Thickness", "Thickness")\n` +
      `th.Base = (doc.getObject(${pyStr(baseName)}), ${pyStrList(faceNames)})\n` +
      `th.Value = ${v}\n` +
      `th.Reversed = True\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in th.State) or th.Shape.isNull():\n` +
      `    doc.removeObject(th.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('hollowing failed for this face — try a smaller thickness')`
    );
  },

  // Pocket: cut a closed profile (a sketch, usually attached to a face) inward
  // by `length`. Subtractive counterpart to Pad. Same clean-status wrapper: an
  // open/invalid profile leaves a null shape — detect it, delete, report a
  // clear message instead of a phantom feature.
  // Reversed = True (kernel-measured, msgbox #91/#92): a bare XY sketch under
  // a Pad cuts -Z by default — empty space below the solid — so the pocket
  // removed NOTHING (vol came back the base solid's, 32000). Midplane was the
  // wrong first fix (it splits the depth symmetrically, so only half falls
  // in material, 31800). Reversed aims the whole depth the other way: +Z,
  // straight into the material. (holeThrough keeps Midplane because a
  // THROUGH-all cut has no depth to halve — symmetric is free there.)
  pocket(bodyName, sketchName, pocketName, length) {
    return wrapStatus(
      `pk = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Pocket", ${pyStr(pocketName)})\n` +
      `pk.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `pk.Length = ${pyNum(length, 'length')}\n` +
      `pk.Reversed = True\n` +
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

  // Cut N circular bores along an arbitrary WORLD axis, each spanning
  // +-depth/2 about the profile plane -- the geometry occt-build.ts builds
  // with MakeCylinder + moved(-depth/2) + Cut.
  //
  // The profile sketch is UNATTACHED -- no face, no datum -- positioned only
  // by body.Placement.inverse() * App.Placement(worldPos, worldRot), the same
  // proxy formula axisSketchPy()/neutralPlane() already use, here as a PROFILE
  // rather than a REFERENCE for the first time. MEASURED to hold through body
  // rotation: a box rotated rz=90 bored along world X at world y=+12 removed
  // exactly 20 of material, and Shape.isInside() put the void at world y=+12,
  // not where a body-frame leak would.
  //
  // N circles in ONE sketch = N bores in ONE Pocket -- measured
  // 29738.053289415348 for the 4-corner case on BOTH engines. More correct
  // than N chained cuts, for the reason occt-build.ts:1035-1039 fuses its
  // bores into one tool first: sequential cuts of overlapping bores can refill
  // material.
  //
  // Midplane=True, Reversed NEVER set -- Midplane makes the cut symmetric so
  // pocket()'s direction trap (msgbox #91/#92) cannot recur. Measured on a
  // top-face plane: Midplane 31858.628, Reversed=False 31717.257,
  // Reversed=True 32000 (no cut at all).
  //
  // World centres are projected into the sketch plane by FreeCAD itself
  // (inv.multVec), never by hand-derived per-axis 2D algebra -- the local
  // X/Y basis App.Rotation(Z, axis) yields differs per axis, and that is
  // exactly what passes the 'z' fixture and breaks on 'x'.
  //
  // multVec, NOT multiply -- FOUND live-kernel (this pass, not SPEC-hole.md's
  // own measurement, which had this line as `inv.multiply(App.Vector(*_w))`):
  // Base.Placement.multiply() only ever composes two Placements together and
  // raises "argument 1 must be Base.Placement, not Base.Vector" the instant
  // it is handed a bare Vector -- it does NOT transform a point. The FreeCAD
  // API for "apply this placement to a point" is Placement.multVec(vector),
  // a different method entirely. Every real-kernel case in this file's own
  // manual test caught this identically (every hole refused with that exact
  // AttributeError-shaped message) until this was fixed.
  //
  // NO volGuard (fc-commands.mjs:99-111): a bore that misses the solid is a
  // silent no-op here AND on OCCT, whose Cut with a non-intersecting tool
  // returns the base shape. Parity, not a defect -- it must not raise.
  bore(bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth) {
    const r = pyNum(radius, 'radius');
    const centersPy = '[' + worldCenters.map((c, i) =>
      `(${pyNum(c[0], `c${i}.x`)},${pyNum(c[1], `c${i}.y`)},${pyNum(c[2], `c${i}.z`)})`).join(',') + ']';
    return wrapStatus(
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `frame = App.Placement(${vec(worldOrigin[0], worldOrigin[1], worldOrigin[2])}, ` +
        `App.Rotation(App.Vector(0,0,1), ${vec(worldAxis[0], worldAxis[1], worldAxis[2])}))\n` +
      `s = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `s.Placement = body.Placement.inverse().multiply(frame)\n` +
      `inv = frame.inverse()\n` +
      `for _w in ${centersPy}:\n` +
      `    _p = inv.multVec(App.Vector(*_w))\n` +
      `    s.addGeometry(Part.Circle(App.Vector(_p.x, _p.y, 0), App.Vector(0,0,1), ${r}), False)\n` +
      `doc.recompute()\n` +
      `_tip = body.Tip\n` +
      `pk = body.newObject("PartDesign::Pocket", ${pyStr(pocketName)})\n` +
      `pk.Profile = s\n` +
      `pk.Length = ${pyNum(depth, 'depth')}\n` +
      `pk.Midplane = True\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in pk.State) or pk.Shape.isNull():\n` +
      `    body.Tip = _tip\n` +
      `    doc.removeObject(pk.Name)\n` +
      `    doc.removeObject(${pyStr(sketchName)})\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('hole failed — the bore could not be cut here')`
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

  // `sides` defaults to 6 (the original hardcoded value) so every existing
  // caller/test that does not pass it keeps building a hexagon unchanged.
  prism(bodyName, featName, radius, height, sides = 6) {
    return (
      HEAD +
      `pr = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Prism", ${pyStr(featName)})\n` +
      `pr.Polygon = ${pyNum(sides, 'sides')}\n` +
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

  // Groove: the subtractive counterpart of Revolve — spin a closed profile
  // around the sketch's vertical axis (V_Axis) and REMOVE the swept material.
  // Same clean-status guard as revolve.
  groove(bodyName, sketchName, featName, angle = 360) {
    return wrapStatus(
      `gr = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Groove", ${pyStr(featName)})\n` +
      `gr.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `gr.ReferenceAxis = (doc.getObject(${pyStr(sketchName)}), ['V_Axis'])\n` +
      `gr.Angle = ${pyNum(angle, 'angle')}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in gr.State) or gr.Shape.isNull():\n` +
      `    doc.removeObject(gr.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('groove failed — the profile must be a closed loop that does not cross the vertical axis')`
    );
  },

  // Subtractive loft: remove the shape lofted between two closed profile
  // sketches. Sections carries the second profile (a one-element Python list,
  // matching PartDesign's AddSubShape semantics). Thickness only when a gap
  // is asked for — a 0 gap is the plain loft.
  subtractiveLoft(bodyName, sketchNameA, sketchNameB, featName, gap = 0) {
    const g = pyNum(gap, 'gap');
    const thick = gap > 0 ? `ls.Thickness = ${g}\n` : '';
    return wrapStatus(
      volGuardHead(bodyName) +
      `ls = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::SubtractiveLoft", ${pyStr(featName)})\n` +
      `ls.Profile = doc.getObject(${pyStr(sketchNameA)})\n` +
      `ls.Sections = [doc.getObject(${pyStr(sketchNameB)})]\n` +
      thick +
      `doc.recompute()\n` +
      `if ('Invalid' in ls.State) or ls.Shape.isNull():\n` +
      `    doc.removeObject(ls.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('subtractive loft failed — the two profiles must be closed loops of the same shape')\n` +
      volGuardTail('ls', 'subtractive loft removed nothing' + SAME_PLANE_HINT).trimEnd()
    );
  },

  // Additive loft: add the shape lofted between two closed profile sketches.
  additiveLoft(bodyName, sketchNameA, sketchNameB, featName) {
    return wrapStatus(
      volGuardHead(bodyName) +
      `lo = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::AdditiveLoft", ${pyStr(featName)})\n` +
      `lo.Profile = doc.getObject(${pyStr(sketchNameA)})\n` +
      `lo.Sections = [doc.getObject(${pyStr(sketchNameB)})]\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in lo.State) or lo.Shape.isNull():\n` +
      `    doc.removeObject(lo.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('additive loft failed — the two profiles must be closed loops of the same shape')\n` +
      volGuardTail('lo', 'loft added nothing' + SAME_PLANE_HINT).trimEnd()
    );
  },

  // Additive pipe: sweep a closed profile along an open path sketch (the
  // spine's first edge is the ride; a full path ride is a v2 concern).
  additivePipe(bodyName, sketchNameProfile, sketchNamePath, featName) {
    return wrapStatus(
      volGuardHead(bodyName) +
      `ap = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::AdditivePipe", ${pyStr(featName)})\n` +
      `ap.Profile = doc.getObject(${pyStr(sketchNameProfile)})\n` +
      `ap.Spine = (doc.getObject(${pyStr(sketchNamePath)}), ['Edge1'])\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in ap.State) or ap.Shape.isNull():\n` +
      `    doc.removeObject(ap.Name)\n` +
      `    doc.recompute()\n` +
      // The old message named only the path's shape. Measured in the browser:
      // the usual cause is neither the shape nor the openness -- it is that both
      // sketches are on XY, which is all Rect/Circle Sketch can make. Name that
      // too, or the message sends the student to fix the one thing that is fine.
      `    raise ValueError('pipe failed — the path must be an open line the profile can follow, on a DIFFERENT plane from the profile. Pick a face, then New Sketch, to draw it.')\n` +
      volGuardTail('ap', 'pipe added nothing' + SAME_PLANE_HINT).trimEnd()
    );
  },

  // Subtractive pipe: the same sweep, removing material. SubtractivePipe
  // derives from PartDesign::Pipe (FeaturePipe.h:111) exactly as the additive
  // one does, so Profile + Spine are identical -- this is a type swap, not a
  // different operation.
  subtractivePipe(bodyName, sketchNameProfile, sketchNamePath, featName) {
    return wrapStatus(
      volGuardHead(bodyName) +
      `sp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::SubtractivePipe", ${pyStr(featName)})\n` +
      `sp.Profile = doc.getObject(${pyStr(sketchNameProfile)})\n` +
      `sp.Spine = (doc.getObject(${pyStr(sketchNamePath)}), ['Edge1'])\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in sp.State) or sp.Shape.isNull():\n` +
      `    doc.removeObject(sp.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('subtractive pipe failed — the path must be an open line on a DIFFERENT plane from the profile, and there must be material to cut. Pick a face, then New Sketch, to draw the path.')\n` +
      volGuardTail('sp', 'subtractive pipe removed nothing' + SAME_PLANE_HINT).trimEnd()
    );
  },

  // Additive helix: sweep a closed profile along a helical ride (Height +
  // Turns drive the helix; Angle is the full revolution per turn).
  // ReferenceAxis is REQUIRED and PERPENDICULAR to the profile (kernel-
  // measured, msgbox #72/#74): the sketch's own normal ('N_Axis') — a helix
  // rides ALONG the axis like Pad's extrude direction, unlike revolve/groove
  // which spin AROUND an in-plane axis. V_Axis (in-plane) makes the helical
  // path run through the profile's own plane and self-intersect at any pitch.
  additiveHelix(bodyName, sketchName, featName, height, turns) {
    return wrapStatus(
      helixPitchGuard(sketchName, pyNum(height, 'height'), pyNum(turns, 'turns')) +
      `ah = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::AdditiveHelix", ${pyStr(featName)})\n` +
      `ah.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `ah.ReferenceAxis = (doc.getObject(${pyStr(sketchName)}), ['N_Axis'])\n` +
      `ah.Height = ${pyNum(height, 'height')}\n` +
      `ah.Turns = ${pyNum(turns, 'turns')}\n` +
      `ah.Angle = 360\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in ah.State) or ah.Shape.isNull():\n` +
      `    doc.removeObject(ah.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('helix failed — the profile must be a closed loop')`
    );
  },

  // Subtractive helix: the same helical ride, removing material.
  subtractiveHelix(bodyName, sketchName, featName, height, turns) {
    return wrapStatus(
      helixPitchGuard(sketchName, pyNum(height, 'height'), pyNum(turns, 'turns')) +
      `sh = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::SubtractiveHelix", ${pyStr(featName)})\n` +
      `sh.Profile = doc.getObject(${pyStr(sketchName)})\n` +
      `sh.ReferenceAxis = (doc.getObject(${pyStr(sketchName)}), ['N_Axis'])\n` +
      `sh.Height = ${pyNum(height, 'height')}\n` +
      `sh.Turns = ${pyNum(turns, 'turns')}\n` +
      `sh.Angle = 360\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in sh.State) or sh.Shape.isNull():\n` +
      `    doc.removeObject(sh.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('subtractive helix failed — the profile must be a closed loop')`
    );
  },

  // A WORLD-FRAME axis proxy for LinearPattern.Direction / PolarPattern.Axis.
  // Needed because those properties resolve through a DocumentObject in the
  // TARGET BODY'S OWN local frame (the Body.Origin X/Y/Z_Axis datum the
  // existing fallback below uses) -- which co-rotates with Body.Placement
  // (wrong once the body is rotated) and sits pinned at body-local (0,0,0)
  // (wrong for a circular pattern axis that must pass through the WORLD
  // origin regardless of body placement). Both gaps, one fix.
  //
  // Built as a plain, UNattached Sketcher::SketchObject inside the target
  // Body (so it lives in body-local space like every PartDesign feature),
  // with its own .Placement set directly to
  //   body.Placement.inverse() * worldPlacement
  // where worldPlacement puts local Y (== the sketch's own V_Axis, the same
  // reference form revolve()/groove() already use) along world `direction`
  // and the local origin at world `origin`. Re-applying body.Placement on
  // the way back to world space cancels the inverse exactly.
  //
  // Verified against the real kernel (fc-kernel-pd-final, coord-fix-probe.mjs
  // pre-checks A/B): App.Rotation(vecA, vecB)'s two-vector constructor
  // rotates vecA onto vecB as assumed, and
  // body.Placement.inverse().multiply(worldPlacement) round-trips back to
  // worldPlacement via body.Placement.multiply(...) -- the composition this
  // formula relies on. Degenerate case (direction anti-parallel to local Y)
  // picks an arbitrary perpendicular axis -- still the correct LINE, which is
  // all a pattern axis needs (sign doesn't matter), and unreachable today
  // since occt-build.ts only ever offers 'x'|'y'|'z', never negative.
  patternAxis(bodyName, sketchName, origin, direction) {
    return wrapStatus(
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      axisSketchPy('body', sketchName, origin, direction) +
      `doc.recompute()\n`
    );
  },

  // Linear pattern: repeat the named feature along a world axis. PartDesign's
  // LinearPattern takes Originals (features to repeat) + a Direction link.
  // The world axis is the Body's own Origin datum axis (every PartDesign Body
  // carries an .Origin with X_Axis/Y_Axis/Z_Axis children). Resolved via the
  // BODY's Origin property — the dogfood-measured bug (msgbox #97) was a
  // doc.Objects scan for 'App::Origin' whose InList check matched nothing,
  // handing (None, ['']) to Direction and throwing "type of first element
  // in tuple must be 'DocumentObject', not NoneType".
  //
  // A SECOND, different cause of that exact same exception was found and
  // fixed in this pass: `origin.getObject('Z_Axis')` looks the axis up by
  // its own INTERNAL NAME, but that name is only unique DOCUMENT-WIDE, not
  // per-body -- a second PartDesign Body in the same document gets its own
  // axis auto-suffixed by FreeCAD itself (measured: 'Z_Axis' on the first
  // body, 'Z_Axis001' on the second), so a literal-name lookup silently
  // returns None for every body after the first. `origin.OriginFeatures`'s
  // own `.Role` property ('X_Axis'/'Y_Axis'/'Z_Axis'/...) is NOT renamed on
  // collision -- resolving through Role, not Name, is what actually survives
  // more than one Body per document.
  // `patternName` (default 'LinearPattern', matching the original hardcoded
  // literal so every existing caller/test that omits it is unaffected) is
  // the REQUESTED internal object name -- FreeCAD auto-suffixes on a
  // collision (a second pattern in the same document would silently become
  // "LinearPattern001"), so a caller building more than one pattern per
  // document must pass a name unique across that whole document, not just
  // this body, and use session.linearPattern()'s own return value (the name
  // actually requested) rather than assuming the literal 'LinearPattern'.
  // `step` is SIGNED -- a negative value means "the other way along axis".
  // Measured against the real kernel: PartDesign::LinearPattern.Length
  // rejects a negative Quantity outright ("Pattern length too small"), so
  // direction has to go through the separate `Reversed` boolean property
  // instead, with Length always the (positive) magnitude.
  //
  // `worldAxis: { origin: [x,y,z], direction: [x,y,z] } | null` -- optional,
  // trailing, defaults to null. When given, Direction is resolved through a
  // fresh world-frame axis-proxy sketch (axisSketchPy(), see emit.patternAxis's
  // own header) instead of the Body's own Origin datum, closing the
  // rotated-target gap this port's own report names. Every existing
  // caller/test that omits it keeps hitting the untouched Body.Origin
  // Role-lookup branch byte-for-byte -- this is a regression-guarded
  // addition, not a rewrite.
  linearPattern(bodyName, featureName, count, step, axis = 'z', patternName = 'LinearPattern', worldAxis = null) {
    const c = pyNum(count, 'count');
    const s = pyNum(step, 'step');
    const magnitude = Math.abs(s);
    const reversed = s < 0 ? 'True' : 'False';
    const axisSketchName = `${patternName}_axis`;
    let axisSetup, directionExpr, cleanupExtra = '';
    if (worldAxis) {
      axisSetup = axisSketchPy('body', axisSketchName, worldAxis.origin, worldAxis.direction);
      directionExpr = `(${axisSketchName}_obj, ['V_Axis'])`;
      cleanupExtra = `    doc.removeObject(${pyStr(axisSketchName)})\n`;
    } else {
      const AXIS_DATUM = { x: 'X_Axis', y: 'Y_Axis', z: 'Z_Axis' };
      const datum = AXIS_DATUM[axis] ?? 'Z_Axis';
      axisSetup =
        `origin = getattr(body, 'Origin', None)\n` +
        `axisObj = None\n` +
        `if origin is not None:\n` +
        `    for _f in origin.OriginFeatures:\n` +
        // Role, not Name -- see this file's own comment above linearPattern.
        `        if getattr(_f, 'Role', None) == ${JSON.stringify(datum)}:\n` +
        `            axisObj = _f\n` +
        `            break\n`;
      directionExpr = `(axisObj, [''])`;
    }
    return wrapStatus(
      `lp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::LinearPattern", ${pyStr(patternName)})\n` +
      `lp.Originals = [doc.getObject(${pyStr(featureName)})]\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      axisSetup +
      `lp.Direction = ${directionExpr}\n` +
      `lp.Length = ${magnitude}\n` +
      `lp.Reversed = ${reversed}\n` +
      `lp.Occurrences = ${c}\n` +
      // newObject() does NOT itself advance Body.Tip (measured against the
      // real kernel -- Body.Shape kept reflecting the PRE-pattern feature
      // until this was added), unlike the GUI command it stands in for.
      `body.Tip = lp\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in lp.State) or lp.Shape.isNull():\n` +
      `    body.Tip = doc.getObject(${pyStr(featureName)})\n` +
      `    doc.removeObject(lp.Name)\n` +
      cleanupExtra +
      `    doc.recompute()\n` +
      `    raise ValueError('pattern failed — the feature to repeat must exist')`
    );
  },

  // Polar pattern: repeat the named feature around a world axis. Same Body-
  // Origin datum resolution as linearPattern; Angle is the total sweep the
  // occurrences span (360 = the full ring).
  // `patternName` -- same reasoning as linearPattern's own comment above.
  // `worldAxis` -- same shape/default/reasoning as linearPattern's own
  // comment above; closes the non-'z'-axis and circular-pattern-of-a-
  // primitive gaps for circular mode.
  //
  // Angle-spacing correction, WORLDAXIS PATH ONLY: measured against the real
  // kernel (coord-fix-probe.mjs P2) that PartDesign::PolarPattern spaces its
  // Occurrences at Angle/(Occurrences-1) for any Angle strictly under 360 --
  // NOT Angle/Occurrences, which is occt-build.ts's own convention
  // (`(f.totalAngle ?? 360) / f.count) * i`) and what every caller of this
  // adapter actually asked for. At exactly Angle=360 FreeCAD special-cases a
  // full ring and already lands on Angle/Occurrences with no correction
  // needed. Passing `correctedAngle = angle*(count-1)/count` collapses both
  // cases onto the same measured Angle/(Occurrences-1) formula and reproduces
  // occt's exact spacing in every case checked (180/4, 180/3, 90/2, 360/4) --
  // verified against the kernel by re-deriving each instance's angle from its
  // own CenterOfMass, not assumed. Scoped to the worldAxis branch only: the
  // OLD Body.Origin-datum path is a pre-existing, independent bug (present
  // before this fix, not part of it) and pattern-test.mjs's own byte-
  // identical assertions on that path must survive unmodified.
  polarPattern(bodyName, featureName, count, angle = 360, axis = 'z', patternName = 'PolarPattern', worldAxis = null) {
    const c = pyNum(count, 'count');
    const a = pyNum(angle, 'angle');
    const axisSketchName = `${patternName}_axis`;
    let axisSetup, axisExpr, cleanupExtra = '';
    let effectiveAngle = a;
    if (worldAxis) {
      axisSetup = axisSketchPy('body', axisSketchName, worldAxis.origin, worldAxis.direction);
      axisExpr = `(${axisSketchName}_obj, ['V_Axis'])`;
      cleanupExtra = `    doc.removeObject(${pyStr(axisSketchName)})\n`;
      effectiveAngle = c > 1 ? (a * (c - 1)) / c : a;
    } else {
      const AXIS_DATUM = { x: 'X_Axis', y: 'Y_Axis', z: 'Z_Axis' };
      const datum = AXIS_DATUM[axis] ?? 'Z_Axis';
      axisSetup =
        `origin = getattr(body, 'Origin', None)\n` +
        `axisObj = None\n` +
        `if origin is not None:\n` +
        `    for _f in origin.OriginFeatures:\n` +
        // Role, not Name -- see this file's own comment above linearPattern.
        `        if getattr(_f, 'Role', None) == ${JSON.stringify(datum)}:\n` +
        `            axisObj = _f\n` +
        `            break\n`;
      axisExpr = `(axisObj, [''])`;
    }
    return wrapStatus(
      `pp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::PolarPattern", ${pyStr(patternName)})\n` +
      `pp.Originals = [doc.getObject(${pyStr(featureName)})]\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      axisSetup +
      `pp.Axis = ${axisExpr}\n` +
      `pp.Angle = ${effectiveAngle}\n` +
      `pp.Occurrences = ${c}\n` +
      // newObject() does NOT itself advance Body.Tip -- same measured fact
      // as linearPattern's own comment above.
      `body.Tip = pp\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in pp.State) or pp.Shape.isNull():\n` +
      `    body.Tip = doc.getObject(${pyStr(featureName)})\n` +
      `    doc.removeObject(pp.Name)\n` +
      cleanupExtra +
      `    doc.recompute()\n` +
      `    raise ValueError('pattern failed — the feature to repeat must exist')`
    );
  },

  // A WORLD-FRAME neutral-plane proxy for PartDesign::Draft.NeutralPlane.
  // Built exactly like axisSketchPy's own world-frame axis proxy, but for a
  // PLANE instead of a LINE: an empty Sketcher::SketchObject inside the
  // target Body, with its own Placement set to
  //   body.Placement.inverse() * Placement(worldPos, rotation mapping local Z to worldNormal)
  // so the sketch's OWN plane (referenced later as (sketchObj, [''])) sits at
  // the caller's WORLD position/orientation regardless of the body's own
  // Placement. `direction` is the plane's NORMAL -- today's only caller
  // (freecad-engine-adapter.ts's 'draft' branch) always passes world Z
  // ([0,0,1]), since only a 'z' pull is supported on this engine (see that
  // branch's own header for why), but the parameter is kept general the same
  // way axisSketchPy's `direction` is, in case a future pass finds a way to
  // support a non-'z' pull.
  //
  // MEASURED against the real kernel (engine/bridge/draft-probe2/6/7.mjs):
  // NeutralPlane accepts (sketchObj, ['']) directly (NOT ['V_Axis'] --
  // NeutralPlane is not one of the ReferenceAxis/Direction/Axis properties
  // that special-case a sketch's virtual axis names; it wants a real planar
  // reference, and an empty sketch's own plane satisfies that) and genuinely
  // honours the WORLD offset: a box drafted with this proxy at world z=10
  // (a box spanning local z 0..20) pivots EXACTLY at that height (volume
  // unchanged at the symmetric midpoint, bounding-box growth of
  // tan(angle)*10 at the far end, matching the analytic prediction to 6
  // decimal places) -- the same "honours the referenced object's own world
  // position" property PolarPattern.Axis was proven (SPEC-coord-fix.md P1)
  // to have for a line's base point.
  neutralPlane(bodyName, sketchName, origin, direction) {
    return wrapStatus(
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `worldPos = ${vec(origin[0], origin[1], origin[2])}\n` +
      `worldNormal = ${vec(direction[0], direction[1], direction[2])}\n` +
      `worldRot = App.Rotation(App.Vector(0,0,1), worldNormal)\n` +
      `${sketchName}_obj = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `${sketchName}_obj.Placement = body.Placement.inverse().multiply(App.Placement(worldPos, worldRot))\n` +
      `doc.recompute()\n`
    );
  },

  // Draft: tilt one named face of a Body's tip solid by Angle degrees,
  // pivoting about neutralSketchName's own plane. PartDesign::Draft is its
  // own class (not a DressUp subclass like Fillet/Chamfer/Thickness), but
  // shares their Base=(base,[faceName]) tuple shape.
  //
  // SCOPE, measured directly against this kernel (fc-kernel-pd-final, NOT
  // assumed -- engine/bridge/draft-probe*.mjs), not a general Draft port:
  //   - PullDirection is intentionally NEVER set here. Every explicit
  //     PullDirection reference this pass tried -- a raw sketch's V_Axis, a
  //     raw sketch's own drawn Edge, a real edge of the SOLID ITSELF, a
  //     PartDesign::Line datum, even the Body's own Origin Z_Axis datum (an
  //     object that already IS the implicit default direction) -- fails
  //     identically ("TopoShapeExpansion.cpp: Failed to add some face for
  //     drafting, skip" / a blank recompute error) on THIS kernel build,
  //     while leaving PullDirection at its None default builds successfully.
  //     A genuine per-fork kernel limitation, the same class of finding as
  //     Thickness's own "cannot build a fully-closed hollow" gap (this
  //     file's own thickness() comment) -- not a port gap. The caller
  //     (freecad-engine-adapter.ts's 'draft' branch) therefore only ever
  //     calls this for a 'z' pull on an UNROTATED body, where the implicit
  //     default direction (measured: body-local Z) is already correct.
  //   - Angle is passed through UNCHANGED, deliberately re-checked rather
  //     than assumed from DraftFeature's own doc comment ("positive leans
  //     outward from the neutral plane"). MEASURED (draft-probe6/7.mjs,
  //     then cross-checked against occt-build.ts's OWN drafted() -- the same
  //     BRepOffsetAPI_DraftAngle call -- via freecad-draft.manual.mjs): with
  //     NeutralPlane set explicitly and PullDirection left at its implicit
  //     default, this kernel's own Angle, PASSED THROUGH UNNEGATED, produces
  //     the IDENTICAL volume occt-build.ts's own drafted() produces for the
  //     SAME (face, pull='z', angle, neutral) inputs -- verified on a
  //     40x40x20 box (angle=10, neutral=box bottom: both engines land on
  //     30589.3842) and independently again on a cylinder's side face. An
  //     earlier version of this comment negated Angle here, reasoning from
  //     DraftFeature's doc-comment wording alone without cross-checking
  //     occt-build.ts's actual output -- that negation was WRONG (it made
  //     this kernel's own output the MIRROR of OCCT's, not a match) and was
  //     caught only by the cross-engine volume check freecad-draft.manual.mjs
  //     runs; the doc comment's "positive leans outward" phrasing and OCCT's
  //     own actual BRepOffsetAPI_DraftAngle sign convention are evidently NOT
  //     the same axis convention. Trust the measured cross-engine number, not
  //     the doc comment, if the two are ever revisited.
  //   - MEASURED, also directly: an oversized/self-intersecting Angle
  //     (85 degrees on a 40-wide, 20-tall box) fails SAFELY on this kernel
  //     (a plain Invalid state / null Shape) rather than corrupting the wasm
  //     heap the way an oversized fillet radius does -- no pre-check radius-
  //     style cap is needed here, unlike fillet()/chamfer() above.
  draft(bodyName, baseName, faceName, angleDegrees, neutralSketchName) {
    const angle = pyNum(angleDegrees, 'angle');
    return wrapStatus(
      `dr = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Draft", "Draft")\n` +
      `dr.Base = (doc.getObject(${pyStr(baseName)}), [${pyStr(faceName)}])\n` +
      `dr.Angle = ${angle}\n` +
      `dr.NeutralPlane = (doc.getObject(${pyStr(neutralSketchName)}), [''])\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in dr.State) or dr.Shape.isNull():\n` +
      `    doc.removeObject(dr.Name)\n` +
      `    doc.removeObject(${pyStr(neutralSketchName)})\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('draft failed for this face — try a smaller angle')`
    );
  },

  // PartDesign::Mirrored -- reflects `baseName` across `planeSketchName`'s
  // own plane and KEEPS BOTH (original + reflection combined into one
  // Shape), by design: Mirrored is a PartDesign::FeatureTransformedPattern,
  // the SAME family as LinearPattern/PolarPattern (fc-commands.mjs's own
  // linearPattern()/polarPattern() above), not a DressUp like Fillet/Draft.
  // That additive-by-construction behaviour is exactly reshape's own Mirror
  // contract (MirrorFeature's own doc comment in model-types.ts: "the source
  // feature stays visible and the mirrored copy is added alongside it") --
  // MEASURED against the real kernel (engine/bridge/mirror-probe.mjs): a
  // Mirrored feature's own Shape.Volume comes back as exactly 2x the
  // original (no overlap), with no separate boolean Fuse call needed the way
  // occt-build.ts's own mirror branch requires -- PartDesign::Mirrored
  // already does the fuse internally.
  //
  // planeSketchName MUST be a world-frame proxy built via neutralPlane()
  // above (NOT a bare Body.Origin datum plane) -- MEASURED (mirror-probe.mjs):
  // MirrorPlane accepts (sketchObj, ['']) exactly like NeutralPlane does, and
  // genuinely honours the proxy's own WORLD position, not just its
  // orientation -- a proxy built off-origin (world x=0) on a body placed at
  // world x=20 produced a mirror that reflected through world x=0, not
  // through the body's own local origin (verified via the resulting
  // Shape.BoundBox span, converted back to world through Body.Placement).
  // This is the SAME "honours the referenced object's own world position"
  // property PolarPattern.Axis (SPEC-coord-fix.md P1) and NeutralPlane
  // (draft, above) both already have -- MirrorPlane joins that list rather
  // than PullDirection's "rejects every explicit reference" one.
  //
  // Same explicit-Tip-advance discipline as linearPattern/polarPattern
  // (NOT auto-advanced by newObject() for this feature family, unlike the
  // DressUp classes) -- verified in the same probe.
  mirrored(bodyName, baseName, planeSketchName, mirrorName = 'Mirrored') {
    return wrapStatus(
      `mir = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::Mirrored", ${pyStr(mirrorName)})\n` +
      `mir.Originals = [doc.getObject(${pyStr(baseName)})]\n` +
      `mir.MirrorPlane = (doc.getObject(${pyStr(planeSketchName)}), [''])\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `body.Tip = mir\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in mir.State) or mir.Shape.isNull():\n` +
      `    body.Tip = doc.getObject(${pyStr(baseName)})\n` +
      `    doc.removeObject(mir.Name)\n` +
      `    doc.removeObject(${pyStr(planeSketchName)})\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('mirror failed for this plane')`
    );
  },

  // Move: translate a Body's own Placement by a WORLD-frame offset in place.
  // A move never rewrites the feature geometry itself -- Body.Shape is only
  // ever the frame applied at read time -- so any face/edge name written
  // against this body BEFORE the move (a fillet's own Base, say) still
  // resolves correctly afterward with no new naming machinery, unlike the
  // OCCT engine's own move branch (occt-build.ts), which has to record an
  // OpRecord for exactly this reason.
  //
  // LEFT-multiply, not right: offset is a WORLD translation, so it must be
  // applied in world space BEFORE the body's own (possibly rotated)
  // Placement, not along the body's own rotated local axes. MEASURED both
  // ways on a body rotated rz=90: left-multiplying gave world +x as asked;
  // right-multiplying gave world +y instead. The two agree on an unrotated
  // body, so the wrong order passes every unrotated fixture and only breaks
  // on a turned target -- verify against a rotated fixture, not just an
  // axis-aligned one.
  moveBody(bodyName, offset) {
    const dx = pyNum(offset[0], 'offset.x');
    const dy = pyNum(offset[1], 'offset.y');
    const dz = pyNum(offset[2], 'offset.z');
    return wrapStatus(
      `b = doc.getObject(${pyStr(bodyName)})\n` +
      `if b is None:\n    raise ValueError('no such body')\n` +
      `before = b.Placement\n` +
      `b.Placement = App.Placement(App.Vector(${dx},${dy},${dz}), App.Rotation()).multiply(b.Placement)\n` +
      `doc.recompute()\n` +
      `bad = [o.Label for o in doc.Objects if 'Invalid' in o.State]\n` +
      `if bad:\n    b.Placement = before\n    doc.recompute()\n` +
      `    raise ValueError('moving this shape broke %s' % ', '.join(bad))`
    );
  },

  // Move+copy: duplicate a whole Body (doc.copyObject with its own
  // dependencies -- a Body brings its Sketch/Pad/axes/planes/origin along,
  // ~11 objects for one Pad-based body, not just the Body itself) and
  // translate the COPY's own Placement, leaving the source untouched. Every
  // object copyObject() added is tracked so a failed copy can be fully
  // unwound -- removing only the Body would strand the rest (sketch, pad,
  // axes, planes, origin) as orphaned objects in the document.
  copyBodyMoved(bodyName, offset) {
    const dx = pyNum(offset[0], 'offset.x');
    const dy = pyNum(offset[1], 'offset.y');
    const dz = pyNum(offset[2], 'offset.z');
    return wrapStatus(
      `src = doc.getObject(${pyStr(bodyName)})\n` +
      `if src is None:\n    raise ValueError('no such body')\n` +
      `before = set(o.Name for o in doc.Objects)\n` +
      `cp = doc.copyObject(src, True)\n` +
      `obj = cp[0] if isinstance(cp, list) else cp\n` +
      `added = [o.Name for o in doc.Objects if o.Name not in before]\n` +
      `def _undo():\n` +
      `    for n in reversed(added):\n` +
      `        try:\n            doc.removeObject(n)\n        except Exception:\n            pass\n` +
      `    doc.recompute()\n` +
      `if obj is None or obj.TypeId != 'PartDesign::Body':\n` +
      `    _undo()\n    raise ValueError('copying this shape did not produce a body')\n` +
      `obj.Placement = App.Placement(App.Vector(${dx},${dy},${dz}), App.Rotation()).multiply(obj.Placement)\n` +
      `doc.recompute()\n` +
      `if obj.Tip is None or obj.Shape.isNull() or ('Invalid' in obj.State):\n` +
      `    _undo()\n    raise ValueError('copying this shape did not work')\n` +
      `_res['bodyName'] = obj.Name\n` +
      `_res['tipName'] = obj.Tip.Name`
    );
  },

  // Plain readback of a Body's own current Tip object name -- used by the
  // 'move' build branch to refuse moving a body that already has something
  // else built on top of its target feature (moving the body would move
  // that later feature too, silently, which is a different bug than moving
  // in place). Not wrapStatus: nothing here can raise, so there is no
  // status to report, matching featureInfo's own plain-readback convention.
  bodyTip(bodyName) {
    return (
      'import json\n' + HEAD +
      `b = doc.getObject(${pyStr(bodyName)})\n` +
      `_t = None if (b is None or b.Tip is None) else b.Tip.Name\n` +
      `open(${JSON.stringify(OUT_PATH)}, 'w').write(json.dumps({'tip': _t}))\n`
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

  // Combine: a document-level Part::Fuse/Cut/Common across two finished Body
  // shapes. PartDesign::Boolean exists on this kernel but was PROBED and
  // rejected: it places the tool at its own world position but reads the
  // base body-local (measured: two boxes that should fuse to 48000 came back
  // 56000). Part::Fuse/Cut/Common instead read both bodies' WORLD placements
  // directly (Base/Tool point straight at the Body objects, not at a
  // PartDesign feature inside one) and leave both input Bodies completely
  // untouched and reusable -- no coordinate work needed at all. Created via
  // doc.addObject, NOT body.newObject -- a Part:: boolean is document-level,
  // not owned by any Body.
  partBoolean(op, baseName, toolName, resultName) {
    const TYPES = { union: 'Part::Fuse', subtract: 'Part::Cut', intersect: 'Part::Common' };
    const typeId = TYPES[op];
    if (!typeId) throw new Error(`partBoolean: unknown op ${JSON.stringify(op)}`);
    return wrapStatus(
      `_base = doc.getObject(${pyStr(baseName)})\n` +
      `_tool = doc.getObject(${pyStr(toolName)})\n` +
      `if _base is None or _tool is None:\n` +
      `    raise ValueError('one of the two shapes is missing')\n` +
      `bo = doc.addObject(${pyStr(typeId)}, ${pyStr(resultName)})\n` +
      `bo.Base = _base\n` +
      `bo.Tool = _tool\n` +
      `doc.recompute()\n` +
      // MEASURED: a disjoint Part::Common does NOT raise -- State stays
      // 'Up-to-date', isNull() is False, Volume 0, Solids 0. Without this
      // explicit check it reaches the viewport as "built a solid, meshing
      // returned nothing drawable" and errors the WHOLE model, not just this
      // feature.
      `if ('Invalid' in bo.State) or bo.Shape is None or bo.Shape.isNull() or len(bo.Shape.Solids) == 0:\n` +
      `    doc.removeObject(bo.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('the two shapes leave nothing behind')`
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
  session.thickness = (bodyName, baseName, faceNames, value) => {
    const res = session.read(emit.thickness(bodyName, baseName, faceNames, value));
    if (!res.ok) throw new Error(res.error || 'thickness failed');
    return 'Thickness';
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
  session.bore = (bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth) => {
    const res = session.read(emit.bore(bodyName, sketchName, pocketName, radius, worldCenters, worldOrigin, worldAxis, depth));
    if (!res.ok) throw new Error(res.error || 'hole failed');
    return pocketName;
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
  session.prism = (bodyName, featName, radius, height, sides = 6) => {
    run('prism', emit.prism(bodyName, featName, radius, height, sides));
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
  // sweep/groove/loft/pipe/helix — all wrapStatus emitters, so all use the
  // read/status pattern with their own short default message.
  session.groove = (bodyName, sketchName, featName, angle = 360) => {
    const res = session.read(emit.groove(bodyName, sketchName, featName, angle));
    if (!res.ok) throw new Error(res.error || 'groove failed');
    return featName;
  };
  session.subtractiveLoft = (bodyName, sketchA, sketchB, featName, gap = 0) => {
    const res = session.read(emit.subtractiveLoft(bodyName, sketchA, sketchB, featName, gap));
    if (!res.ok) throw new Error(res.error || 'subtractive loft failed');
    return featName;
  };
  session.additiveLoft = (bodyName, sketchA, sketchB, featName) => {
    const res = session.read(emit.additiveLoft(bodyName, sketchA, sketchB, featName));
    if (!res.ok) throw new Error(res.error || 'additive loft failed');
    return featName;
  };
  session.additivePipe = (bodyName, profile, path, featName) => {
    const res = session.read(emit.additivePipe(bodyName, profile, path, featName));
    if (!res.ok) throw new Error(res.error || 'pipe failed');
    return featName;
  };
  session.subtractivePipe = (bodyName, profile, path, featName) => {
    const res = session.read(emit.subtractivePipe(bodyName, profile, path, featName));
    if (!res.ok) throw new Error(res.error || 'subtractive pipe failed');
    return featName;
  };
  session.additiveHelix = (bodyName, sketchName, featName, height, turns) => {
    const res = session.read(emit.additiveHelix(bodyName, sketchName, featName, height, turns));
    if (!res.ok) throw new Error(res.error || 'helix failed');
    return featName;
  };
  session.subtractiveHelix = (bodyName, sketchName, featName, height, turns) => {
    const res = session.read(emit.subtractiveHelix(bodyName, sketchName, featName, height, turns));
    if (!res.ok) throw new Error(res.error || 'subtractive helix failed');
    return featName;
  };
  session.linearPattern = (bodyName, featureName, count, step, axis = 'z', patternName = 'LinearPattern', worldAxis = null) => {
    const res = session.read(emit.linearPattern(bodyName, featureName, count, step, axis, patternName, worldAxis));
    if (!res.ok) throw new Error(res.error || 'linear pattern failed');
    return patternName;
  };
  session.polarPattern = (bodyName, featureName, count, angle = 360, axis = 'z', patternName = 'PolarPattern', worldAxis = null) => {
    const res = session.read(emit.polarPattern(bodyName, featureName, count, angle, axis, patternName, worldAxis));
    if (!res.ok) throw new Error(res.error || 'polar pattern failed');
    return patternName;
  };
  session.patternAxis = (bodyName, sketchName, origin, direction) => {
    const res = session.read(emit.patternAxis(bodyName, sketchName, origin, direction));
    if (!res.ok) throw new Error(res.error || 'pattern axis failed');
    return sketchName;
  };
  session.neutralPlane = (bodyName, sketchName, origin, direction) => {
    const res = session.read(emit.neutralPlane(bodyName, sketchName, origin, direction));
    if (!res.ok) throw new Error(res.error || 'neutral plane failed');
    return sketchName;
  };
  session.draft = (bodyName, baseName, faceName, angleDegrees, neutralSketchName) => {
    const res = session.read(emit.draft(bodyName, baseName, faceName, angleDegrees, neutralSketchName));
    if (!res.ok) throw new Error(res.error || 'draft failed');
    return 'Draft';
  };
  // Same requested-name-not-actual-name caveat as linearPattern/polarPattern
  // above (FreeCAD auto-suffixes on a same-document name collision) -- a
  // caller building more than one mirror per document must pass a unique
  // mirrorName.
  session.mirrored = (bodyName, baseName, planeSketchName, mirrorName = 'Mirrored') => {
    const res = session.read(emit.mirrored(bodyName, baseName, planeSketchName, mirrorName));
    if (!res.ok) throw new Error(res.error || 'mirror failed');
    return mirrorName;
  };
  session.moveBody = (bodyName, offset) => {
    const res = session.read(emit.moveBody(bodyName, offset));
    if (!res.ok) throw new Error(res.error || 'move failed');
    return bodyName;
  };
  // Names come back from the kernel readback (res.bodyName/res.tipName),
  // never derived/guessed as a `NNN` suffix -- FreeCAD's auto-suffix counter
  // is DOCUMENT-global, not per-body (measured: a third copy's pad landed on
  // 'box1_pad003'), so guessing from the request would silently drift.
  session.copyBodyMoved = (bodyName, offset) => {
    const res = session.read(emit.copyBodyMoved(bodyName, offset));
    if (!res.ok) throw new Error(res.error || 'move copy failed');
    return { bodyName: res.bodyName, tipName: res.tipName };
  };
  session.bodyTip = (bodyName) => session.read(emit.bodyTip(bodyName)).tip ?? null;
  session.partBoolean = (op, baseName, toolName, resultName) => {
    const res = session.read(emit.partBoolean(op, baseName, toolName, resultName));
    if (!res.ok) throw new Error(res.error || 'combine failed');
    return resultName;
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