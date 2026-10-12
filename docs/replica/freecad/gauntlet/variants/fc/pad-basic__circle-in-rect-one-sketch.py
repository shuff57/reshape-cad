# pad-basic__circle-in-rect-one-sketch: sk.rect(40, 30); sk.circle(10): a plate with a round hole, both called on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -20, -15, 20, 15)
    circle(sk, 0, 0, 5)
    pad(body, sk, 15)
    emit("pad-basic__circle-in-rect-one-sketch", body)
    finish("pad-basic__circle-in-rect-one-sketch")
except Exception:
    fail("pad-basic__circle-in-rect-one-sketch", traceback.format_exc())
