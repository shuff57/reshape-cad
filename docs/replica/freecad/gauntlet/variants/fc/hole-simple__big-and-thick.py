# hole-simple__big-and-thick: big hole 20 across through a 50 x 40 x 25 block, offset (3,0)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 50, 40)
    base = pad(body, s1, 25)
    hs = sketch(body, 'top', 25)
    circle(hs, 28, 20, 10)
    hole(body, hs, 20, None)
    emit("hole-simple__big-and-thick", body)
    finish("hole-simple__big-and-thick")
except Exception:
    fail("hole-simple__big-and-thick", traceback.format_exc())
