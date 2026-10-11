# hole-simple__along-x: through hole along x, offset (5,2) in (y,z), 4 across
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'side', 40)
    circle(hs, 20, 7, 2)
    hole(body, hs, 4, None)
    emit("hole-simple__along-x", body)
    finish("hole-simple__along-x")
except Exception:
    fail("hole-simple__along-x", traceback.format_exc())
