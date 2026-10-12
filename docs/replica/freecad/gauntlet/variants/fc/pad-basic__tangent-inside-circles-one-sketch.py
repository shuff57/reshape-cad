# pad-basic__tangent-inside-circles-one-sketch: a circle inside another touching it at one point
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 20)
    circle(sk, 10, 0, 10)
    pad(body, sk, 15)
    emit("pad-basic__tangent-inside-circles-one-sketch", body)
    finish("pad-basic__tangent-inside-circles-one-sketch")
except Exception:
    fail("pad-basic__tangent-inside-circles-one-sketch", traceback.format_exc())
