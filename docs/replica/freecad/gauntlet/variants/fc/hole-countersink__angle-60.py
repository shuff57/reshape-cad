# hole-countersink__angle-60: countersink 10 / 60 over a 4 hole
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 20, 15, 2)
    hole(body, hs, 4, None, cut='Countersink', cut_dia=10, cs_angle=60)
    emit("hole-countersink__angle-60", body)
    finish("hole-countersink__angle-60")
except Exception:
    fail("hole-countersink__angle-60", traceback.format_exc())
