# sk-conflict__equal-vs-two-radii: two circles held equal, radius 5 on one and radius 6 on the other
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.Circle(V(0,0,0),V(0,0,1),5),False)
    sk.addGeometry(Part.Circle(V(20,0,0),V(0,0,1),5),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -1, 1))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 1, 3, 20))
    sk.addConstraint(Sketcher.Constraint('PointOnObject', 1, 3, -1))
    sk.addConstraint(Sketcher.Constraint('Equal', 0, 1))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 5))
    sk.addConstraint(Sketcher.Constraint('Radius', 1, 6))
    sk_emit("sk-conflict__equal-vs-two-radii", sk)
    finish("sk-conflict__equal-vs-two-radii")
except Exception:
    fail("sk-conflict__equal-vs-two-radii", traceback.format_exc())
