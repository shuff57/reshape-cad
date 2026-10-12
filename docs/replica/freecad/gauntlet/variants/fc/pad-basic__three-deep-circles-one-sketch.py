# pad-basic__three-deep-circles-one-sketch: circles of 60, 40 and 20 across, concentric: a ring and a disc inside its hole (two solids)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 30)
    circle(sk, 0, 0, 20)
    circle(sk, 0, 0, 10)
    pad(body, sk, 15)
    emit_multi("pad-basic__three-deep-circles-one-sketch", body)
    finish("pad-basic__three-deep-circles-one-sketch")
except Exception:
    fail("pad-basic__three-deep-circles-one-sketch", traceback.format_exc())
