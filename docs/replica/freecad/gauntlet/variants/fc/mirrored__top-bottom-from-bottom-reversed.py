# mirrored__top-bottom-from-bottom-reversed: a pocket sketched on the bottom face and cut up (reversed), mirrored through z=5 onto the top face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 0)
    circle(s2, 10, 15, 3)
    pk = pocket(body, s2, 3, reversed_=True)
    mirrored(body, pk, 'top', 5)
    emit("mirrored__top-bottom-from-bottom-reversed", body)
    finish("mirrored__top-bottom-from-bottom-reversed")
except Exception:
    fail("mirrored__top-bottom-from-bottom-reversed", traceback.format_exc())
