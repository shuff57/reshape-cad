# pad-basic__three-deep-rects-one-sketch: squares of 60, 40 and 20 nested: a frame and a block inside its hole (two solids)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -30, -30, 30, 30)
    rect(sk, -20, -20, 20, 20)
    rect(sk, -10, -10, 10, 10)
    pad(body, sk, 15)
    emit_multi("pad-basic__three-deep-rects-one-sketch", body)
    finish("pad-basic__three-deep-rects-one-sketch")
except Exception:
    fail("pad-basic__three-deep-rects-one-sketch", traceback.format_exc())
