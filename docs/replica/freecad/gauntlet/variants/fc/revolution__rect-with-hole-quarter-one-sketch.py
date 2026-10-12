# revolution__rect-with-hole-quarter-one-sketch: the same profile with a hole, a quarter turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    circle(sk, 15, 15, 2)
    revolve(body, sk, 90, 'V_Axis')
    emit("revolution__rect-with-hole-quarter-one-sketch", body)
    finish("revolution__rect-with-hole-quarter-one-sketch")
except Exception:
    fail("revolution__rect-with-hole-quarter-one-sketch", traceback.format_exc())
