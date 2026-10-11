# sk-circle-arc-tangent__circle-circle-internal: circle r5 inside circle r8, touching: internal tangency, centres level
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.Circle(V(0,0,0),V(0,0,1),8),False)
    sk.addGeometry(Part.Circle(V(3,0,0),V(0,0,1),5),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -1, 1))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 8))
    sk.addConstraint(Sketcher.Constraint('Radius', 1, 5))
    sk.addConstraint(Sketcher.Constraint('Tangent', 0, 1))
    sk.addConstraint(Sketcher.Constraint('DistanceY', 0, 3, 1, 3, 0))
    sk_emit("sk-circle-arc-tangent__circle-circle-internal", sk)
    finish("sk-circle-arc-tangent__circle-circle-internal")
except Exception:
    fail("sk-circle-arc-tangent__circle-circle-internal", traceback.format_exc())
