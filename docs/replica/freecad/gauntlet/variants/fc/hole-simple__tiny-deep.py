# hole-simple__tiny-deep: extreme aspect: hole 1 across through 30 thick
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 20, 20)
    base = pad(body, s1, 30)
    hs = sketch(body, 'top', 30)
    circle(hs, 10, 10, 0.5)
    hole(body, hs, 1, None)
    emit("hole-simple__tiny-deep", body)
    finish("hole-simple__tiny-deep")
except Exception:
    fail("hole-simple__tiny-deep", traceback.format_exc())
