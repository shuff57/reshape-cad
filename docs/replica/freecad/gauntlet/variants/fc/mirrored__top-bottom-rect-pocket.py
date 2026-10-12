# mirrored__top-bottom-rect-pocket: rect pocket 4 deep mirrored through the middle plane z=5 to the bottom face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 5, 5, 20, 12)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'top', 5)
    emit("mirrored__top-bottom-rect-pocket", body)
    finish("mirrored__top-bottom-rect-pocket")
except Exception:
    fail("mirrored__top-bottom-rect-pocket", traceback.format_exc())
