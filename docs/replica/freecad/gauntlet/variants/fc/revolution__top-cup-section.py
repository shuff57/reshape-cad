# revolution__top-cup-section: a full turn of an L-shaped section: a cup with a base, 16 across the rim
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    poly(sk, [(6,0),(16,0),(16,4),(8,4),(8,20),(6,20)])
    revolve(body, sk, 360, 'V_Axis')
    emit("revolution__top-cup-section", body)
    finish("revolution__top-cup-section")
except Exception:
    fail("revolution__top-cup-section", traceback.format_exc())
