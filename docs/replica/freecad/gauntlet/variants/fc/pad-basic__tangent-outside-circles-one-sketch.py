# pad-basic__tangent-outside-circles-one-sketch: two circles touching at one point, side by side
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, -10, 0, 10)
    circle(sk, 10, 0, 10)
    pad(body, sk, 15)
    emit_multi("pad-basic__tangent-outside-circles-one-sketch", body)
    finish("pad-basic__tangent-outside-circles-one-sketch")
except Exception:
    fail("pad-basic__tangent-outside-circles-one-sketch", traceback.format_exc())
