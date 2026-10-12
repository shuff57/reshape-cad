# pad-basic__shared-edge-rects-one-sketch: two rectangles sharing one side
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -20, -10, 0, 10)
    rect(sk, 0, -10, 20, 10)
    pad(body, sk, 15)
    emit("pad-basic__shared-edge-rects-one-sketch", body)
    finish("pad-basic__shared-edge-rects-one-sketch")
except Exception:
    fail("pad-basic__shared-edge-rects-one-sketch", traceback.format_exc())
