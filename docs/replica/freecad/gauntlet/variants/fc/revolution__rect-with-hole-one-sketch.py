# revolution__rect-with-hole-one-sketch: a 10 x 30 profile at radius 10..20 with a 4 across hole in it, a full turn: a torus-shaped void inside the ring
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    circle(sk, 15, 15, 2)
    revolve(body, sk, 360, 'V_Axis')
    emit("revolution__rect-with-hole-one-sketch", body)
    finish("revolution__rect-with-hole-one-sketch")
except Exception:
    fail("revolution__rect-with-hole-one-sketch", traceback.format_exc())
