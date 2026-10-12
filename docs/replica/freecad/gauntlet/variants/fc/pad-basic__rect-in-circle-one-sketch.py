# pad-basic__rect-in-circle-one-sketch: sk.circle(40); sk.rect(10, 10): a disc with a square hole
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 20)
    rect(sk, -5, -5, 5, 5)
    pad(body, sk, 15)
    emit("pad-basic__rect-in-circle-one-sketch", body)
    finish("pad-basic__rect-in-circle-one-sketch")
except Exception:
    fail("pad-basic__rect-in-circle-one-sketch", traceback.format_exc())
