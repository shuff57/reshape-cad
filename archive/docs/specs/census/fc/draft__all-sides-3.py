# draft__all-sides-3: all four side faces drafted 3 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    draft_x(body, base, [planar_face(base.Shape, (1,0,0)), planar_face(base.Shape, (-1,0,0)), planar_face(base.Shape, (0,1,0)), planar_face(base.Shape, (0,-1,0))], 3)
    emit("draft__all-sides-3", body)
    finish("draft__all-sides-3")
except Exception:
    fail("draft__all-sides-3", traceback.format_exc())
