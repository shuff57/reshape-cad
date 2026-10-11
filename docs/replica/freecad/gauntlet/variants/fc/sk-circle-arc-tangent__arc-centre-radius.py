# sk-circle-arc-tangent__arc-centre-radius: a quarter arc r10 with centre pinned at the origin and radius fixed: its two end angles are free
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(0,0,0),V(0,0,1),10),0,1.570796327),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -1, 1))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 10))
    sk_emit("sk-circle-arc-tangent__arc-centre-radius", sk)
    finish("sk-circle-arc-tangent__arc-centre-radius")
except Exception:
    fail("sk-circle-arc-tangent__arc-centre-radius", traceback.format_exc())
