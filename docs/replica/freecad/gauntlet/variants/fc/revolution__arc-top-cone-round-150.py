# revolution__arc-top-cone-round-150: a frustum ring (slanted outer side) with its wide top corner rounded 3: a cone and a torus, 150 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(22,0),(16,30),(10,30)], {2:3})
    revolve(body, sk, 150, 'V_Axis', False)
    emit("revolution__arc-top-cone-round-150", body)
    finish("revolution__arc-top-cone-round-150")
except Exception:
    fail("revolution__arc-top-cone-round-150", traceback.format_exc())
