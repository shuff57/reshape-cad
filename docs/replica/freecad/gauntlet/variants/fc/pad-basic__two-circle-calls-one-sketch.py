# pad-basic__two-circle-calls-one-sketch: the same ring written as sk.circle(40); sk.circle(20) on one sketch (the second call used to replace the first silently)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 20)
    circle(sk, 0, 0, 10)
    pad(body, sk, 15)
    emit("pad-basic__two-circle-calls-one-sketch", body)
    finish("pad-basic__two-circle-calls-one-sketch")
except Exception:
    fail("pad-basic__two-circle-calls-one-sketch", traceback.format_exc())
