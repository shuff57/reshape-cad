# sk-conflict__radius-vs-diameter: a circle with radius 5 and diameter 12
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.Circle(V(0,0,0),V(0,0,1),5),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -1, 1))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 5))
    sk.addConstraint(Sketcher.Constraint('Diameter', 0, 12))
    sk_emit("sk-conflict__radius-vs-diameter", sk)
    finish("sk-conflict__radius-vs-diameter")
except Exception:
    fail("sk-conflict__radius-vs-diameter", traceback.format_exc())
