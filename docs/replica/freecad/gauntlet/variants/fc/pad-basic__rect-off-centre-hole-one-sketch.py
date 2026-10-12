# pad-basic__rect-off-centre-hole-one-sketch: a plate with an off-centre round hole near a corner
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 0, 0, 50, 30)
    circle(sk, 10, 10, 4)
    pad(body, sk, 12)
    emit("pad-basic__rect-off-centre-hole-one-sketch", body)
    finish("pad-basic__rect-off-centre-hole-one-sketch")
except Exception:
    fail("pad-basic__rect-off-centre-hole-one-sketch", traceback.format_exc())
