# thickness__box-open-top-intersection: the same with Join = Intersection
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    thick(body, base, [planar_face(base.Shape, (0,0,1))], 2, Join='Intersection')
    emit("thickness__box-open-top-intersection", body)
    finish("thickness__box-open-top-intersection")
except Exception:
    fail("thickness__box-open-top-intersection", traceback.format_exc())
