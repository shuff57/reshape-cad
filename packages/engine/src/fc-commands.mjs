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

  // Linear pattern: repeat the named feature along a world axis. PartDesign's
  // LinearPattern takes Originals (features to repeat) + a Direction link.
  // The world axis is the Body's own Origin datum axis (every PartDesign Body
  // carries an .Origin with X_Axis/Y_Axis/Z_Axis children). Resolved via the
  // BODY's Origin property — the dogfood-measured bug (msgbox #97) was a
  // doc.Objects scan for 'App::Origin' whose InList check matched nothing,
  // handing (None, ['']) to Direction and throwing "type of first element
  // in tuple must be 'DocumentObject', not NoneType".
  linearPattern(bodyName, featureName, count, step, axis = 'z') {
    const c = pyNum(count, 'count');
    const s = pyNum(step, 'step');
    const AXIS_DATUM = { x: 'X_Axis', y: 'Y_Axis', z: 'Z_Axis' };
    const datum = AXIS_DATUM[axis] ?? 'Z_Axis';
    return wrapStatus(
      `lp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::LinearPattern", "LinearPattern")\n` +
      `lp.Originals = [doc.getObject(${pyStr(featureName)})]\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `origin = getattr(body, 'Origin', None)\n` +
      `axisObj = origin.getObject(${JSON.stringify(datum)}) if origin is not None else None\n` +
      `lp.Direction = (axisObj, [''])\n` +
      `lp.Length = ${s}\n` +
      `lp.Occurrences = ${c}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in lp.State) or lp.Shape.isNull():\n` +
      `    doc.removeObject(lp.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('pattern failed — the feature to repeat must exist')`
    );
  },

  // Polar pattern: repeat the named feature around a world axis. Same Body-
  // Origin datum resolution as linearPattern; Angle is the total sweep the
  // occurrences span (360 = the full ring).
  polarPattern(bodyName, featureName, count, angle = 360, axis = 'z') {
    const c = pyNum(count, 'count');
    const a = pyNum(angle, 'angle');
    const AXIS_DATUM = { x: 'X_Axis', y: 'Y_Axis', z: 'Z_Axis' };
    const datum = AXIS_DATUM[axis] ?? 'Z_Axis';
    return wrapStatus(
      `pp = doc.getObject(${pyStr(bodyName)}).newObject("PartDesign::PolarPattern", "PolarPattern")\n` +
      `pp.Originals = [doc.getObject(${pyStr(featureName)})]\n` +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `origin = getattr(body, 'Origin', None)\n` +
      `axisObj = origin.getObject(${JSON.stringify(datum)}) if origin is not None else None\n` +
      `pp.Axis = (axisObj, [''])\n` +
      `pp.Angle = ${a}\n` +
      `pp.Occurrences = ${c}\n` +
      `doc.recompute()\n` +
      `if ('Invalid' in pp.State) or pp.Shape.isNull():\n` +
      `    doc.removeObject(pp.Name)\n` +
      `    doc.recompute()\n` +
      `    raise ValueError('pattern failed — the feature to repeat must exist')`
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
  session.linearPattern = (bodyName, featureName, count, step, axis = 'z') => {
    const res = session.read(emit.linearPattern(bodyName, featureName, count, step, axis));
    if (!res.ok) throw new Error(res.error || 'linear pattern failed');
    return 'LinearPattern';
  };
  session.polarPattern = (bodyName, featureName, count, angle = 360, axis = 'z') => {
    const res = session.read(emit.polarPattern(bodyName, featureName, count, angle, axis));
    if (!res.ok) throw new Error(res.error || 'polar pattern failed');
    return 'PolarPattern';
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