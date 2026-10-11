# mirrored__front-back-hole-at15: hole at (10,8) mirrored across y=15
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 8, 3)
    pk = pocket(body, s2, 10)
    mirrored(body, pk, 'front', -15)
    emit("mirrored__front-back-hole-at15", body)
    finish("mirrored__front-back-hole-at15")
except Exception:
    fail("mirrored__front-back-hole-at15", traceback.format_exc())
