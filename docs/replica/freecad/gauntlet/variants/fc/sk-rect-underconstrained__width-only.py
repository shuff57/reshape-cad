# sk-rect-underconstrained__width-only: plus the width: 3 free
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(30,0,0)),False)
    sk.addGeometry(Part.LineSegment(V(30,0,0),V(30,15,0)),False)
    sk.addGeometry(Part.LineSegment(V(30,15,0),V(0,15,0)),False)
    sk.addGeometry(Part.LineSegment(V(0,15,0),V(0,0,0)),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 2, 2, 3, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 3, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 2))
    sk.addConstraint(Sketcher.Constraint('Vertical', 1))
    sk.addConstraint(Sketcher.Constraint('Vertical', 3))
    sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 30))
    sk_emit("sk-rect-underconstrained__width-only", sk)
    finish("sk-rect-underconstrained__width-only")
except Exception:
    fail("sk-rect-underconstrained__width-only", traceback.format_exc())
