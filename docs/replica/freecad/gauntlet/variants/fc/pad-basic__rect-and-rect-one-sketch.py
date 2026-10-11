# pad-basic__rect-and-rect-one-sketch: a rectangle then a second rectangle called on the same sketch: FreeCAD, given both loops, makes a frame
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, -20, -15, 20, 15)
    rect(sk, -5, -5, 5, 5)
    pad(body, sk, 15)
    emit("pad-basic__rect-and-rect-one-sketch", body)
    finish("pad-basic__rect-and-rect-one-sketch")
except Exception:
    fail("pad-basic__rect-and-rect-one-sketch", traceback.format_exc())
