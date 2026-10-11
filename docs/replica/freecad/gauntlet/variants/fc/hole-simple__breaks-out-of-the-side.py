# hole-simple__breaks-out-of-the-side: a 10 hole centred 3 mm from the x=40 edge: it opens through the side wall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 37, 15, 5)
    hole(body, hs, 10, None)
    emit("hole-simple__breaks-out-of-the-side", body)
    finish("hole-simple__breaks-out-of-the-side")
except Exception:
    fail("hole-simple__breaks-out-of-the-side", traceback.format_exc())
