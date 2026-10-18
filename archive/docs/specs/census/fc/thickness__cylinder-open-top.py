# thickness__cylinder-open-top: a cylinder 30 across, 20 tall, shelled to 2, top open
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    circle(s, 0, 0, 15)
    base = pad(body, s, 20)
    thick(body, base, [planar_face(base.Shape, (0,0,1))], 2)
    emit("thickness__cylinder-open-top", body)
    finish("thickness__cylinder-open-top")
except Exception:
    fail("thickness__cylinder-open-top", traceback.format_exc())
