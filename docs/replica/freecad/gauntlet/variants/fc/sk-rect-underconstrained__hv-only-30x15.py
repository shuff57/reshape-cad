# sk-rect-underconstrained__hv-only-30x15: rectangle with joins, horizontals and verticals only: 4 free
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
    sk_emit("sk-rect-underconstrained__hv-only-30x15", sk)
    finish("sk-rect-underconstrained__hv-only-30x15")
except Exception:
    fail("sk-rect-underconstrained__hv-only-30x15", traceback.format_exc())
