# pad-basic__crossing-circles-one-sketch: two overlapping circles on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, -5, 0, 10)
    circle(sk, 5, 0, 10)
    pad(body, sk, 15)
    emit("pad-basic__crossing-circles-one-sketch", body)
    finish("pad-basic__crossing-circles-one-sketch")
except Exception:
    fail("pad-basic__crossing-circles-one-sketch", traceback.format_exc())
