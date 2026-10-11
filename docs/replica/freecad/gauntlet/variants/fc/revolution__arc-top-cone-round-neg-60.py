# revolution__arc-top-cone-round-neg-60: the same frustum ring 60 degrees the other way
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(22,0),(16,30),(10,30)], {1:4,2:3})
    revolve(body, sk, 60, 'V_Axis', True)
    emit("revolution__arc-top-cone-round-neg-60", body)
    finish("revolution__arc-top-cone-round-neg-60")
except Exception:
    fail("revolution__arc-top-cone-round-neg-60", traceback.format_exc())
