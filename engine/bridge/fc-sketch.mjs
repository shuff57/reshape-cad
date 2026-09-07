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
  session.sketchAddLine = (sk, x1, y1, x2, y2) =>
    session.read(emit.addLine(sk, x1, y1, x2, y2)).geoId;
  session.sketchAddCircle = (sk, cx, cy, r) =>
    session.read(emit.addCircle(sk, cx, cy, r)).geoId;
  session.sketchAddArc = (sk, cx, cy, r, a0, a1) =>
    session.read(emit.addArc(sk, cx, cy, r, a0, a1)).geoId;
  session.sketchAddRectangle = (sk, x1, y1, x2, y2) =>
    session.read(emit.addRectangle(sk, x1, y1, x2, y2)).geoIds;
  session.sketchDelGeometry = (sk, g) => {
    runExec('sketchDelGeometry', emit.delGeometry(sk, g));
    return g;
  };

  session.constrainCoincident = (sk, g1, p1, g2, p2) =>
    session.read(emit.coincident(sk, g1, p1, g2, p2)).index;
  session.constrainHorizontal = (sk, g) => session.read(emit.unary(sk, 'Horizontal', g)).index;
  session.constrainVertical   = (sk, g) => session.read(emit.unary(sk, 'Vertical', g)).index;
  session.constrainParallel      = (sk, g1, g2) => session.read(emit.binary(sk, 'Parallel', g1, g2)).index;
  session.constrainPerpendicular = (sk, g1, g2) => session.read(emit.binary(sk, 'Perpendicular', g1, g2)).index;
  session.constrainEqual         = (sk, g1, g2) => session.read(emit.binary(sk, 'Equal', g1, g2)).index;

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
