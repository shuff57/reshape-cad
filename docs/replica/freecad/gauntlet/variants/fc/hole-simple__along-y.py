# hole-simple__along-y: through hole along y, offset (-7,1) in (x,z), 3 across
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'front', 0)
    circle(hs, 13, 6, 1.5)
    hole(body, hs, 3, None)
    emit("hole-simple__along-y", body)
    finish("hole-simple__along-y")
except Exception:
    fail("hole-simple__along-y", traceback.format_exc())
