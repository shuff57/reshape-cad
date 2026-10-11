# hole-simple__offcentre-through: through hole 6 across, offset (8,-5) from the centre
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 28, 10, 3)
    hole(body, hs, 6, None)
    emit("hole-simple__offcentre-through", body)
    finish("hole-simple__offcentre-through")
except Exception:
    fail("hole-simple__offcentre-through", traceback.format_exc())
