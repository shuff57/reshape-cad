# sk-circle-arc-tangent__line-circle-tangent: a 40 line along the x axis and a circle r5 tangent to it, centre 20 along
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(40,0,0)),False)
    sk.addGeometry(Part.Circle(V(20,5,0),V(0,0,1),5),False)
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -1, 1))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 40))
    sk.addConstraint(Sketcher.Constraint('Radius', 1, 5))
    sk.addConstraint(Sketcher.Constraint('Tangent', 0, 1))
    sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 1, 3, 20))
    sk_emit("sk-circle-arc-tangent__line-circle-tangent", sk)
    finish("sk-circle-arc-tangent__line-circle-tangent")
except Exception:
    fail("sk-circle-arc-tangent__line-circle-tangent", traceback.format_exc())
