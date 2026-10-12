# pad-basic__crossing-rects-one-sketch: two overlapping rectangles on one sketch (FreeCAD pads their union; ours refuses a crossing in a sentence)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -20, -10, 10, 10)
    rect(sk, -10, -20, 20, 0)
    pad(body, sk, 15)
    emit("pad-basic__crossing-rects-one-sketch", body)
    finish("pad-basic__crossing-rects-one-sketch")
except Exception:
    fail("pad-basic__crossing-rects-one-sketch", traceback.format_exc())
