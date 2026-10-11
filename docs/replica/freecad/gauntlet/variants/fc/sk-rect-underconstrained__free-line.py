# sk-rect-underconstrained__free-line: one line, no rules: 4 free
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(20,5,0)),False)
    sk_emit("sk-rect-underconstrained__free-line", sk)
    finish("sk-rect-underconstrained__free-line")
except Exception:
    fail("sk-rect-underconstrained__free-line", traceback.format_exc())
