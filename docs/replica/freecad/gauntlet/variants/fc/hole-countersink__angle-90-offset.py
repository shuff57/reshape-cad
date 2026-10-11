# hole-countersink__angle-90-offset: countersink 12 / 90 over a 6 hole, offset (6,-4)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 26, 11, 3)
    hole(body, hs, 6, None, cut='Countersink', cut_dia=12, cs_angle=90)
    emit("hole-countersink__angle-90-offset", body)
    finish("hole-countersink__angle-90-offset")
except Exception:
    fail("hole-countersink__angle-90-offset", traceback.format_exc())
