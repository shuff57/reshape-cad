# pad-basic__polygon-with-rect-hole-one-sketch: a triangle with a square hole, polygon() then rect() on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    poly(sk, [(-20,-20),(20,-20),(0,20)])
    rect(sk, -2, -10, 2, -6)
    pad(body, sk, 15)
    emit("pad-basic__polygon-with-rect-hole-one-sketch", body)
    finish("pad-basic__polygon-with-rect-hole-one-sketch")
except Exception:
    fail("pad-basic__polygon-with-rect-hole-one-sketch", traceback.format_exc())
