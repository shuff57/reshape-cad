# sk-rect-underconstrained__triangle-joined: three joined lines and nothing else
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(30,0,0)),False)
    sk.addGeometry(Part.LineSegment(V(30,0,0),V(10,20,0)),False)
    sk.addGeometry(Part.LineSegment(V(10,20,0),V(0,0,0)),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 2, 2, 0, 1))
    sk_emit("sk-rect-underconstrained__triangle-joined", sk)
    finish("sk-rect-underconstrained__triangle-joined")
except Exception:
    fail("sk-rect-underconstrained__triangle-joined", traceback.format_exc())
