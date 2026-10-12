# pad-basic__two-disjoint-circles-one-sketch: two discs side by side on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, -20, 0, 8)
    circle(sk, 20, 0, 8)
    pad(body, sk, 15)
    emit_multi("pad-basic__two-disjoint-circles-one-sketch", body)
    finish("pad-basic__two-disjoint-circles-one-sketch")
except Exception:
    fail("pad-basic__two-disjoint-circles-one-sketch", traceback.format_exc())
