# draft__right-face-5: the right face of a 30 x 20 x 10 block drafted 5 degrees about the bottom
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    draft_x(body, base, [planar_face(base.Shape, (1,0,0))], 5)
    emit("draft__right-face-5", body)
    finish("draft__right-face-5")
except Exception:
    fail("draft__right-face-5", traceback.format_exc())
