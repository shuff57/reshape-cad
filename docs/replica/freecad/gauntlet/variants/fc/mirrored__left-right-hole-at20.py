# mirrored__left-right-hole-at20: hole at (10,15) mirrored across x=20
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pk = pocket(body, s2, 10)
    mirrored(body, pk, 'side', 20)
    emit("mirrored__left-right-hole-at20", body)
    finish("mirrored__left-right-hole-at20")
except Exception:
    fail("mirrored__left-right-hole-at20", traceback.format_exc())
