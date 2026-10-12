# pad-basic__two-holes-one-sketch: a plate with two round holes, three calls on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -30, -20, 30, 20)
    circle(sk, -15, 0, 6)
    circle(sk, 15, 0, 6)
    pad(body, sk, 15)
    emit("pad-basic__two-holes-one-sketch", body)
    finish("pad-basic__two-holes-one-sketch")
except Exception:
    fail("pad-basic__two-holes-one-sketch", traceback.format_exc())
