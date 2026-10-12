# pad-basic__two-disjoint-rects-one-sketch: two squares side by side on one sketch: two pieces of one pad
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -30, -10, -10, 10)
    rect(sk, 10, -10, 30, 10)
    pad(body, sk, 15)
    emit_multi("pad-basic__two-disjoint-rects-one-sketch", body)
    finish("pad-basic__two-disjoint-rects-one-sketch")
except Exception:
    fail("pad-basic__two-disjoint-rects-one-sketch", traceback.format_exc())
