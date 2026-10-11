# hole-counterbore__through-offset: counterbore 12 x 3 over a 6 hole, offset (-9,6)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 11, 21, 3)
    hole(body, hs, 6, None, cut='Counterbore', cut_dia=12, cut_depth=3)
    emit("hole-counterbore__through-offset", body)
    finish("hole-counterbore__through-offset")
except Exception:
    fail("hole-counterbore__through-offset", traceback.format_exc())
