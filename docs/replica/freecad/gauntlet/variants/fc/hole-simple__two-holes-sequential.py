# hole-simple__two-holes-sequential: two separate holes, 6 and 4 across, one after the other
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    h1 = sketch(body, 'top', 10)
    circle(h1, 10, 15, 3)
    hole(body, h1, 6)
    h2 = sketch(body, 'top', 10)
    circle(h2, 30, 20, 2)
    hole(body, h2, 4)
    emit("hole-simple__two-holes-sequential", body)
    finish("hole-simple__two-holes-sequential")
except Exception:
    fail("hole-simple__two-holes-sequential", traceback.format_exc())
