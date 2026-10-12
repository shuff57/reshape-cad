# mirrored__top-bottom-breaks-bottom: circle pocket 3 deep mirrored through z=4: the copy starts below the part and opens the bottom face 1 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pk = pocket(body, s2, 3)
    mirrored(body, pk, 'top', 4)
    emit("mirrored__top-bottom-breaks-bottom", body)
    finish("mirrored__top-bottom-breaks-bottom")
except Exception:
    fail("mirrored__top-bottom-breaks-bottom", traceback.format_exc())
