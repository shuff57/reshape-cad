# sk-conflict__horizontal-and-vertical: one line held both horizontal and vertical
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(20,5,0)),False)
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Vertical', 0))
    sk_emit("sk-conflict__horizontal-and-vertical", sk)
    finish("sk-conflict__horizontal-and-vertical")
except Exception:
    fail("sk-conflict__horizontal-and-vertical", traceback.format_exc())
