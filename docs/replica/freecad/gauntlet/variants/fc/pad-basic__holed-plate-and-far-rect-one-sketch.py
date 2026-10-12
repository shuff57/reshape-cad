# pad-basic__holed-plate-and-far-rect-one-sketch: a plate with a hole and a separate square beside it
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -20, -15, 20, 15)
    circle(sk, 0, 0, 5)
    rect(sk, 35, -5, 45, 5)
    pad(body, sk, 15)
    emit_multi("pad-basic__holed-plate-and-far-rect-one-sketch", body)
    finish("pad-basic__holed-plate-and-far-rect-one-sketch")
except Exception:
    fail("pad-basic__holed-plate-and-far-rect-one-sketch", traceback.format_exc())
