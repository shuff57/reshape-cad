# sk-rect-underconstrained__pinned-corner-only: corner pinned, no dimensions: width and height free
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(2,3,0),V(32,3,0)),False)
    sk.addGeometry(Part.LineSegment(V(32,3,0),V(32,18,0)),False)
    sk.addGeometry(Part.LineSegment(V(32,18,0),V(2,18,0)),False)
    sk.addGeometry(Part.LineSegment(V(2,18,0),V(2,3,0)),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 2, 2, 3, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 3, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 2))
    sk.addConstraint(Sketcher.Constraint('Vertical', 1))
    sk.addConstraint(Sketcher.Constraint('Vertical', 3))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 1, 2))
    sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, 0, 1, 3))
    sk_emit("sk-rect-underconstrained__pinned-corner-only", sk)
    finish("sk-rect-underconstrained__pinned-corner-only")
except Exception:
    fail("sk-rect-underconstrained__pinned-corner-only", traceback.format_exc())
