# hole-countersink__thick-block: countersink 16 / 90 over an 8 hole in a 30 thick block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 30)
    hs = sketch(body, 'top', 30)
    circle(hs, 20, 15, 4)
    hole(body, hs, 8, None, cut='Countersink', cut_dia=16, cs_angle=90)
    emit("hole-countersink__thick-block", body)
    finish("hole-countersink__thick-block")
except Exception:
    fail("hole-countersink__thick-block", traceback.format_exc())
