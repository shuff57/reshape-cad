# hole-counterbore__blind: blind 6 hole, 7 deep, counterbore 10 x 3
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 20, 15, 3)
    hole(body, hs, 6, 7, cut='Counterbore', cut_dia=10, cut_depth=3)
    emit("hole-counterbore__blind", body)
    finish("hole-counterbore__blind")
except Exception:
    fail("hole-counterbore__blind", traceback.format_exc())
