# pad-basic__rect-and-circle-apart-one-sketch: a square and a disc side by side
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -30, -10, -10, 10)
    circle(sk, 20, 0, 8)
    pad(body, sk, 10)
    emit_multi("pad-basic__rect-and-circle-apart-one-sketch", body)
    finish("pad-basic__rect-and-circle-apart-one-sketch")
except Exception:
    fail("pad-basic__rect-and-circle-apart-one-sketch", traceback.format_exc())
