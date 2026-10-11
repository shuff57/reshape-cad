# hole-simple__blind-4: blind hole 6 across, 4 deep, centred
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 20, 15, 3)
    hole(body, hs, 6, 4)
    emit("hole-simple__blind-4", body)
    finish("hole-simple__blind-4")
except Exception:
    fail("hole-simple__blind-4", traceback.format_exc())
