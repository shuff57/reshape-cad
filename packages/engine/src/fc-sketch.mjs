// engine/bridge/fc-sketch.mjs
//
// Constraint-sketcher command layer on top of the bridge core (fc-session.mjs),
// a sibling to fc-commands.mjs. Where fc-commands emits whole auto-shapes
// (a finished rect/circle wire, no constraints), this layer exposes the real
// FreeCAD Sketcher workflow one primitive at a time: add a line, attach a
// constraint, type a dimension, read back the SOLVED geometry plus how locked
// the sketch is (degrees of freedom). It drives FreeCAD's GCS solver, which is
// already compiled into the kernel.
//
// Every API name + convention below was verified against the shipping wasm
// kernel (engine/bridge/sketch-probe, since removed): a deliberately crooked,
// wrong-size 4-line loop with Coincident/Horizontal/Vertical + DistanceX/Y
// solved to an exact 40x30, DoF 4 -> 2 -> 0 as dimensions and an origin pin
// were added. PointPos convention: 1=start, 2=end, 3=center; geoId -1 = the
// sketch root point (origin), used to pin a corner.
//
//   emit.*                -- pure Python emitters (args in, snippet out).
//   attachSketchCommands  -- binds session methods; geometry/constraint adds
//                            return the new geoId / constraint index (read back
//                            via OUT_PATH), so the UI can reference them later.

const pyStr = (s) => JSON.stringify(String(s));
const pyNum = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${what}: expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
};
const pyInt = (v, what) => {
  if (!Number.isInteger(v)) throw new TypeError(`${what}: expected an integer, got ${JSON.stringify(v)}`);
  return v;
};
const vec = (x, y, z = 0) => `App.Vector(${pyNum(x, 'x')},${pyNum(y, 'y')},${pyNum(z, 'z')})`;

const HEAD =
  'import json\n' +
  'import FreeCAD as App\n' +
  'import Part\n' +
  'import Sketcher\n' +
  'doc = App.ActiveDocument\n';

const OUT = '/tmp/reshape_out.json';
const writeOut = (expr) => `open(${pyStr(OUT)}, 'w').write(json.dumps(${expr}))\n`;
const SK = (name) => `sk = doc.getObject(${pyStr(name)})\n`;

// A Sketcher.Constraint(...) argument list, built from validated pieces.
const cons = (kind, ...args) => `Sketcher.Constraint(${pyStr(kind)}, ${args.join(', ')})`;

export const emit = {
  // Empty sketch on a Body (XY plane). Nothing drawn yet; the workflow adds
  // geometry and constraints incrementally.
  sketchNew(bodyName, sketchName) {
    return (
      HEAD +
      `doc.getObject(${pyStr(bodyName)}).newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n`
    );
  },

  // Empty sketch ATTACHED to a picked planar face (for Pocket). baseName is the
  // solid that owns the face, faceName its sub-element ("Face{n}"). MapMode
  // 'FlatFace' lays the sketch flat on that face; the sketch then draws in the
  // face's local plane and Pocket cuts perpendicular to it. Verified: attaching
  // to a box's top face + a 10x10 window pockets a valid 500 mm^3 recess.
  sketchNewOnFace(bodyName, sketchName, baseName, faceName) {
    return (
      HEAD +
      `_sk = doc.getObject(${pyStr(bodyName)}).newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `_sk.AttachmentSupport = [(doc.getObject(${pyStr(baseName)}), ${pyStr(faceName)})]\n` +
      `_sk.MapMode = "FlatFace"\n` +
      `doc.recompute()\n`
    );
  },

  // Empty sketch ATTACHED to one of a Body's own Origin planes (XY_Plane/
  // XZ_Plane/YZ_Plane) -- revolve/groove need their profile drawn in a plane
  // CONTAINING the spin axis, unlike sketchNew()'s bare flat-XY sketch.
  // Resolved by .Role, not .Name: a second Body's own origin planes are
  // auto-suffixed by FreeCAD on name collision (the same reasoning already
  // applied to linearPattern/polarPattern's Origin-axis lookup), so a
  // literal-name lookup silently fails for every body after the first.
  sketchNewOnOrigin(bodyName, sketchName, planeRole = 'XZ_Plane') {
    return (
      HEAD +
      `body = doc.getObject(${pyStr(bodyName)})\n` +
      `origin = getattr(body, 'Origin', None)\n` +
      `planeObj = None\n` +
      `if origin is not None:\n` +
      `    for _f in origin.OriginFeatures:\n` +
      `        if getattr(_f, 'Role', None) == ${pyStr(planeRole)}:\n` +
      `            planeObj = _f\n` +
      `            break\n` +
      `if planeObj is None:\n` +
      `    raise ValueError('could not find %s on the Body Origin' % ${pyStr(planeRole)})\n` +
      `sk = body.newObject("Sketcher::SketchObject", ${pyStr(sketchName)})\n` +
      `sk.AttachmentSupport = [(planeObj, '')]\n` +
      `sk.MapMode = 'FlatFace'\n` +
      `doc.recompute()\n`
    );
  },

  // Add one line segment; returns {geoId}.
  addLine(sketchName, x1, y1, x2, y2) {
    return (
      HEAD + SK(sketchName) +
      `gid = sk.addGeometry(Part.LineSegment(${vec(x1, y1)}, ${vec(x2, y2)}), False)\n` +
      `sk.solve()\n` +
      writeOut(`{'geoId': gid}`)
    );
  },

  // Add a full circle (center + radius) on the XY plane; returns {geoId}.
  addCircle(sketchName, cx, cy, r) {
    return (
      HEAD + SK(sketchName) +
      `gid = sk.addGeometry(Part.Circle(${vec(cx, cy)}, App.Vector(0,0,1), ${pyNum(r, 'r')}), False)\n` +
      `sk.solve()\n` +
      writeOut(`{'geoId': gid}`)
    );
  },

  // Add an arc from center + radius + start/end angle (radians, CCW). The UI
  // computes the angles from clicked points; ArcOfCircle(Circle, a0, a1) is the
  // constructor the kernel accepts (verified via probe). Returns {geoId}.
  addArc(sketchName, cx, cy, r, a0, a1) {
    return (
      HEAD + SK(sketchName) +
      `gid = sk.addGeometry(Part.ArcOfCircle(` +
      `Part.Circle(${vec(cx, cy)}, App.Vector(0,0,1), ${pyNum(r, 'r')}), ` +
      `${pyNum(a0, 'a0')}, ${pyNum(a1, 'a1')}), False)\n` +
      `sk.solve()\n` +
      writeOut(`{'geoId': gid}`)
    );
  },

  // Rectangle convenience: 4 lines from (x1,y1)-(x2,y2) as a constrained wire
  // (coincident corners + 2 Horizontal + 2 Vertical). Returns {geoIds:[...]}.
  // The UI's rectangle tool calls this on a corner-to-corner drag.
  addRectangle(sketchName, x1, y1, x2, y2) {
    const X1 = pyNum(x1, 'x1'), Y1 = pyNum(y1, 'y1'), X2 = pyNum(x2, 'x2'), Y2 = pyNum(y2, 'y2');
    return (
      HEAD + SK(sketchName) +
      `g0 = sk.addGeometry(Part.LineSegment(${vec(X1, Y1)}, ${vec(X2, Y1)}), False)\n` +
      `g1 = sk.addGeometry(Part.LineSegment(${vec(X2, Y1)}, ${vec(X2, Y2)}), False)\n` +
      `g2 = sk.addGeometry(Part.LineSegment(${vec(X2, Y2)}, ${vec(X1, Y2)}), False)\n` +
      `g3 = sk.addGeometry(Part.LineSegment(${vec(X1, Y2)}, ${vec(X1, Y1)}), False)\n` +
      `sk.addConstraint(Sketcher.Constraint('Coincident', g0,2, g1,1))\n` +
      `sk.addConstraint(Sketcher.Constraint('Coincident', g1,2, g2,1))\n` +
      `sk.addConstraint(Sketcher.Constraint('Coincident', g2,2, g3,1))\n` +
      `sk.addConstraint(Sketcher.Constraint('Coincident', g3,2, g0,1))\n` +
      `sk.addConstraint(Sketcher.Constraint('Horizontal', g0))\n` +
      `sk.addConstraint(Sketcher.Constraint('Horizontal', g2))\n` +
      `sk.addConstraint(Sketcher.Constraint('Vertical', g1))\n` +
      `sk.addConstraint(Sketcher.Constraint('Vertical', g3))\n` +
      `sk.solve()\n` +
      writeOut(`{'geoIds': [g0, g1, g2, g3]}`)
    );
  },

  // Radius constraint on a circle or arc; drives its radius. Returns {index}.
  radius(sketchName, g, value) {
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons('Radius', pyInt(g, 'g'), pyNum(value, 'value'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },

  // Delete one geometry element. FreeCAD cascades: constraints that referenced
  // it are removed too, and remaining geoIds renumber -- callers MUST re-read
  // sketchState() afterward rather than reuse any prior geoId/constraint index.
  delGeometry(sketchName, g) {
    return HEAD + SK(sketchName) +
      `sk.delGeometry(${pyInt(g, 'g')})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Flag geometry as CONSTRUCTION: it stays in the sketch, keeps its
  // constraints, and is ignored when the sketch is padded into a solid --
  // which is the whole point (a centreline you dimension from but do not
  // extrude). Mode must be a real Python bool: the parser is "iO!" against
  // PyBool_Type (SketchObjectPyImp.cpp:337), so a 1 is a TypeError.
  setConstruction(sketchName, g, on) {
    return HEAD + SK(sketchName) +
      `sk.setConstruction(${pyInt(g, 'g')}, ${on ? 'True' : 'False'})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Trim the curve `g` at the picked point: FreeCAD removes the piece of it
  // that contains that point, up to the nearest intersections. The point is
  // Base::VectorPy ("iO!", SketchObjectPyImp.cpp:1587), not a tuple, so it
  // goes through vec() like every other point on this bridge.
  //
  // NOTE for the caller: trim can DELETE a geometry outright (a segment with
  // no intersections on either side), which shifts every id above it. Callers
  // must re-read sketchState() rather than reuse ids across a trim -- the same
  // rule delGeometry/delConstraint already carry.
  trim(sketchName, g, x, y) {
    return HEAD + SK(sketchName) +
      `sk.trim(${pyInt(g, 'g')}, ${vec(x, y)})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Attach a constraint. `kind` selects the FreeCAD constraint; the emitter
  // shapes the right argument list and returns {index} (the new constraint's
  // position in sk.Constraints), which setDatum() and delete will reference.
  coincident(sketchName, g1, p1, g2, p2) {
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons('Coincident', pyInt(g1, 'g1'), pyInt(p1, 'p1'), pyInt(g2, 'g2'), pyInt(p2, 'p2'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  unary(sketchName, kind, g) {
    // Horizontal | Vertical  (one geometry element)
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons(kind, pyInt(g, 'g'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  binary(sketchName, kind, g1, g2) {
    // Parallel | Perpendicular | Equal  (two geometry elements)
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons(kind, pyInt(g1, 'g1'), pyInt(g2, 'g2'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  distance(sketchName, kind, g1, p1, g2, p2, value) {
    // DistanceX | DistanceY | Distance, point-to-point, driving `value`.
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons(kind, pyInt(g1, 'g1'), pyInt(p1, 'p1'), pyInt(g2, 'g2'), pyInt(p2, 'p2'), pyNum(value, 'value'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  pinOrigin(sketchName, g, p) {
    // Coincident a vertex to the sketch root point (geoId -1, PointPos 1):
    // removes the last translational freedom so a sized sketch reaches DoF 0.
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons('Coincident', pyInt(g, 'g'), pyInt(p, 'p'), -1, 1)})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  symmetric(sketchName, g1, p1, g2, p2, g3, p3) {
    // Symmetric: point p1 on g1 and point p2 on g2 are symmetric about
    // point p3 on g3 (usually the root point, geoId -1 PointPos 1).
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons('Symmetric', pyInt(g1, 'g1'), pyInt(p1, 'p1'), pyInt(g2, 'g2'), pyInt(p2, 'p2'), pyInt(g3, 'g3'), pyInt(p3, 'p3'))})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  angleBetween(sketchName, g1, g2, degrees) {
    // Angle between two lines. FreeCAD's Angle constraint with two geoIds
    // names the LINES (not their endpoints), which is the student-facing
    // meaning: "these two edges meet at N degrees".
    //
    // The argument is in DEGREES and FreeCAD wants RADIANS. This was measured,
    // not assumed: p1d-test.mjs asked for 45 and the solver produced 58.310076
    // degrees, which is exactly 45 RADIANS wrapped -- 45 - 7*(2*pi) = 1.017700
    // rad = 58.3104 deg, matching to four decimals. Passing the number through
    // unconverted does not error and does not conflict; it silently builds the
    // wrong angle, so nothing but a measured gate catches it. Every other
    // datum on this bridge (DistanceX/Y, Radius) is a LENGTH and needs no
    // conversion, which is why the one angular datum is the one that slipped.
    return HEAD + SK(sketchName) +
      `idx = sk.addConstraint(${cons('Angle', pyInt(g1, 'g1'), pyInt(g2, 'g2'), (pyNum(degrees, 'degrees') * Math.PI) / 180)})\n` +
      `sk.solve()\n` + writeOut(`{'index': idx}`);
  },
  addEllipse(sketchName, cx, cy, rx, ry) {
    // Part.Ellipse(S1, S2, Center): S1 on the MAJOR axis, S2 on the minor.
    // OCCT's GC_MakeEllipse refuses major < minor, and the Center/major/minor
    // form pins the major axis to +X -- so a tall ellipse (ry > rx) has to be
    // handed over with its AXES swapped rather than its radii. Measured
    // against EllipsePyImp.cpp in the vendored FreeCAD source, which lists
    // the four accepted forms in its own TypeError -- a 4-argument call (the
    // form this used to emit) is not one of them and raises TypeError.
    // These two look like dead calls and are not: DELETING THEM REOPENS A HOLE.
    // Every other emitter hands its numbers straight to vec(), which validates
    // via pyNum. Here rx/ry go through ARITHMETIC first (cy + ry below), and a
    // string "5" would concatenate rather than add -- 0 + "5" is "05", which
    // pyNum then accepts as a number and writes a silently wrong coordinate.
    // Validating the raw inputs before any arithmetic touches them is the
    // whole point; the return values are deliberately discarded.
    pyNum(rx, 'rx');
    pyNum(ry, 'ry');
    const tall = ry > rx;
    const s1 = tall ? [cx, cy + ry] : [cx + rx, cy];
    const s2 = tall ? [cx + rx, cy] : [cx, cy + ry];
    return HEAD + SK(sketchName) +
      `gid = sk.addGeometry(Part.Ellipse(${vec(s1[0], s1[1])}, ${vec(s2[0], s2[1])}, ${vec(cx, cy)}), False)\n` +
      `doc.recompute()\n` + writeOut(`{'geoId': gid}`);
  },
  addPoint(sketchName, x, y) {
    // Part.Point: construction geometry only — it never bounds a face, it
    // is a snap/attachment marker a student places.
    return HEAD + SK(sketchName) +
      `gid = sk.addGeometry(Part.Point(${vec(x, y)}), False)\n` +
      `doc.recompute()\n` + writeOut(`{'geoId': gid}`);
  },

  // Remove a constraint by index. Used as the auto-constraint safety valve
  // (roll back an inferred constraint that would over-constrain) and by the
  // future delete/trim slice. NOTE: constraint indices shift down after a
  // delete, so callers must re-read sketchState() rather than reuse old ids.
  delConstraint(sketchName, cIndex) {
    return HEAD + SK(sketchName) +
      `sk.delConstraint(${pyInt(cIndex, 'cIndex')})\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Change a driving dimension's value; the solver moves the geometry to match.
  setDatum(sketchName, cIndex, value) {
    return HEAD + SK(sketchName) +
      `sk.setDatum(${pyInt(cIndex, 'cIndex')}, App.Units.Quantity(${pyNum(value, 'value')}))\n` +
      `sk.solve()\n` + `doc.recompute()\n`;
  },

  // Full solved state for the UI: every geometry element (solved coords), every
  // constraint, remaining DoF, fully-constrained flag, and the solver's
  // conflicting / redundant / malformed lists so the UI can flag bad sketches.
  state(sketchName) {
    return (
      HEAD + SK(sketchName) +
      `sk.solve()\n` +
      `geo = []\n` +
      `for i, g in enumerate(sk.Geometry):\n` +
      `    row = {'id': i, 'type': g.TypeId.split('::')[-1].replace('Geom','')}\n` +
      `    try:\n` +
      `        row['x1']=round(g.StartPoint.x,6); row['y1']=round(g.StartPoint.y,6)\n` +
      `        row['x2']=round(g.EndPoint.x,6);   row['y2']=round(g.EndPoint.y,6)\n` +
      `    except Exception:\n` +
      `        pass\n` +
      `    try:\n` +
      `        row['cx']=round(g.Center.x,6); row['cy']=round(g.Center.y,6); row['r']=round(g.Radius,6)\n` +
      `    except Exception:\n` +
      `        pass\n` +
      `    try:\n` +
      // Ellipse has MajorRadius/MinorRadius, not Radius, so the block above
      // sets cx/cy and then throws on g.Radius -- r is silently absent.
      // AngleXU is left in RADIANS on purpose: the renderer is the only
      // consumer and it needs to flip the sign to match SVG's flipped Y
      // axis, so converting here would just make it flip back there.
      `        row['rx']=round(g.MajorRadius,6); row['ry']=round(g.MinorRadius,6); row['ang']=round(g.AngleXU,6)\n` +
      `    except Exception:\n` +
      `        pass\n` +
      `    try:\n` +
      // Point has none of StartPoint/EndPoint/Center -- only bare X/Y/Z.
      `        row['px']=round(g.X,6); row['py']=round(g.Y,6)\n` +
      `    except Exception:\n` +
      `        pass\n` +
      `    try:\n` +
      `        row['constr'] = bool(sk.getConstruction(i))\n` +
      `    except Exception:\n` +
      `        pass\n` +
      `    if row['type'] == 'ArcOfCircle':\n` +
      `        try:\n` +
      `            a0=g.FirstParameter; a1=g.LastParameter\n` +
      `            m=g.value((a0+a1)/2.0)\n` +
      `            row['mx']=round(m.x,6); row['my']=round(m.y,6); row['a0']=round(a0,6); row['a1']=round(a1,6)\n` +
      `        except Exception:\n` +
      `            pass\n` +
      `    geo.append(row)\n` +
      `def _ctype(c):\n` +
      `    t = c.Type\n` +
      `    return t if isinstance(t, str) else str(t)\n` +
      `conx = [{'id': i, 'type': _ctype(c)} for i, c in enumerate(sk.Constraints)]\n` +
      writeOut(
        `{'geometry': geo, 'constraints': conx, 'dof': sk.DoF, ` +
        `'fully': bool(sk.FullyConstrained), ` +
        `'conflicting': list(sk.ConflictingConstraints), ` +
        `'redundant': list(sk.RedundantConstraints), ` +
        `'malformed': list(sk.MalformedConstraints)}`
      )
    );
  },
};

// ---------------------------------------------------------------------------
// Session wrappers. attachSketchCommands(session) adds the sketcher methods to
// a createFcSession() session (chainable). Reads that must return an id use
// session.read(); pure mutations that need no id use session.exec().
// ---------------------------------------------------------------------------
export function attachSketchCommands(session) {
  if (!session || typeof session.exec !== 'function' || typeof session.read !== 'function') {
    throw new Error('attachSketchCommands: need a session with exec()+read() (fc-session.mjs)');
  }
  const runExec = (what, py) => {
    const { rc, out } = session.exec(py);
    if (rc !== 0) throw new Error(`${what} failed (rc=${rc}):\n${out}`);
  };

  session.sketchNew = (bodyName, sketchName) => {
    runExec('sketchNew', emit.sketchNew(bodyName, sketchName));
    return sketchName;
  };
  session.sketchNewOnFace = (bodyName, sketchName, baseName, faceName) => {
    runExec('sketchNewOnFace', emit.sketchNewOnFace(bodyName, sketchName, baseName, faceName));
    return sketchName;
  };
  session.sketchNewOnOrigin = (bodyName, sketchName, planeRole = 'XZ_Plane') => {
    runExec('sketchNewOnOrigin', emit.sketchNewOnOrigin(bodyName, sketchName, planeRole));
    return sketchName;
  };
  session.sketchAddLine = (sk, x1, y1, x2, y2) =>
    session.read(emit.addLine(sk, x1, y1, x2, y2)).geoId;
  session.sketchAddCircle = (sk, cx, cy, r) =>
    session.read(emit.addCircle(sk, cx, cy, r)).geoId;
  session.sketchAddArc = (sk, cx, cy, r, a0, a1) =>
    session.read(emit.addArc(sk, cx, cy, r, a0, a1)).geoId;
  session.sketchAddRectangle = (sk, x1, y1, x2, y2) =>
    session.read(emit.addRectangle(sk, x1, y1, x2, y2)).geoIds;
  session.sketchAddEllipse = (sk, cx, cy, rx, ry) => session.read(emit.addEllipse(sk, cx, cy, rx, ry)).geoId;
  session.sketchAddPoint   = (sk, x, y)          => session.read(emit.addPoint(sk, x, y)).geoId;
  session.sketchDelGeometry = (sk, g) => {
    runExec('sketchDelGeometry', emit.delGeometry(sk, g));
    return g;
  };
  session.sketchSetConstruction = (sk, g, on) => {
    runExec('sketchSetConstruction', emit.setConstruction(sk, g, on));
    return g;
  };
  session.sketchTrim = (sk, g, x, y) => {
    runExec('sketchTrim', emit.trim(sk, g, x, y));
    return g;
  };

  session.constrainCoincident = (sk, g1, p1, g2, p2) =>
    session.read(emit.coincident(sk, g1, p1, g2, p2)).index;
  session.constrainHorizontal = (sk, g) => session.read(emit.unary(sk, 'Horizontal', g)).index;
  session.constrainVertical   = (sk, g) => session.read(emit.unary(sk, 'Vertical', g)).index;
  session.constrainParallel      = (sk, g1, g2) => session.read(emit.binary(sk, 'Parallel', g1, g2)).index;
  session.constrainPerpendicular = (sk, g1, g2) => session.read(emit.binary(sk, 'Perpendicular', g1, g2)).index;
  session.constrainEqual         = (sk, g1, g2) => session.read(emit.binary(sk, 'Equal', g1, g2)).index;
  session.constrainSymmetric = (sk, g1, p1, g2, p2, g3, p3) => session.read(emit.symmetric(sk, g1, p1, g2, p2, g3, p3)).index;
  session.constrainAngle     = (sk, g1, g2, deg)            => session.read(emit.angleBetween(sk, g1, g2, deg)).index;

  session.constrainDistanceX = (sk, g1, p1, g2, p2, v) => session.read(emit.distance(sk, 'DistanceX', g1, p1, g2, p2, v)).index;
  session.constrainDistanceY = (sk, g1, p1, g2, p2, v) => session.read(emit.distance(sk, 'DistanceY', g1, p1, g2, p2, v)).index;
  session.constrainDistance  = (sk, g1, p1, g2, p2, v) => session.read(emit.distance(sk, 'Distance',  g1, p1, g2, p2, v)).index;
  session.constrainPinOrigin = (sk, g, p = 1) => session.read(emit.pinOrigin(sk, g, p)).index;
  session.constrainRadius = (sk, g, value) => session.read(emit.radius(sk, g, value)).index;

  session.sketchSetDatum = (sk, cIndex, value) => {
    runExec('sketchSetDatum', emit.setDatum(sk, cIndex, value));
    return cIndex;
  };
  session.delConstraint = (sk, cIndex) => {
    runExec('delConstraint', emit.delConstraint(sk, cIndex));
    return cIndex;
  };
  session.sketchState = (sk) => session.read(emit.state(sk));

  return session;
}
