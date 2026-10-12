# pad-basic__four-deep-circles-one-sketch: four concentric circles: two rings (even-odd), two solids
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 40)
    circle(sk, 0, 0, 30)
    circle(sk, 0, 0, 20)
    circle(sk, 0, 0, 10)
    pad(body, sk, 10)
    emit_multi("pad-basic__four-deep-circles-one-sketch", body)
    finish("pad-basic__four-deep-circles-one-sketch")
except Exception:
    fail("pad-basic__four-deep-circles-one-sketch", traceback.format_exc())
