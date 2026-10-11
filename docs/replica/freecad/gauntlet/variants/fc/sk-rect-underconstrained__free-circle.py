# sk-rect-underconstrained__free-circle: one circle, no rules: 3 free
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.Circle(V(5,5,0),V(0,0,1),4),False)
    sk_emit("sk-rect-underconstrained__free-circle", sk)
    finish("sk-rect-underconstrained__free-circle")
except Exception:
    fail("sk-rect-underconstrained__free-circle", traceback.format_exc())
