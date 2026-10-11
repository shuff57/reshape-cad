# pad-basic__top-offset-negative-reversed: top sketch offset -4, reversed pad 9 (z from -13 to -4)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', -4)
    circle(sk, 5, 5, 7)
    pad(body, sk, 9, 'reversed')
    emit("pad-basic__top-offset-negative-reversed", body)
    finish("pad-basic__top-offset-negative-reversed")
except Exception:
    fail("pad-basic__top-offset-negative-reversed", traceback.format_exc())
