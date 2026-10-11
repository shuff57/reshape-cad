# hole-countersink__blind: blind 6 hole 6 deep with a 12 / 90 countersink
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 20, 15, 3)
    hole(body, hs, 6, 6, cut='Countersink', cut_dia=12, cs_angle=90)
    emit("hole-countersink__blind", body)
    finish("hole-countersink__blind")
except Exception:
    fail("hole-countersink__blind", traceback.format_exc())
