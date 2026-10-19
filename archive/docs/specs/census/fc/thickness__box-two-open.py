# thickness__box-two-open: top and bottom both open, wall 2
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    thick(body, base, [planar_face(base.Shape, (0,0,1)), planar_face(base.Shape, (0,0,-1))], 2)
    emit("thickness__box-two-open", body)
    finish("thickness__box-two-open")
except Exception:
    fail("thickness__box-two-open", traceback.format_exc())
