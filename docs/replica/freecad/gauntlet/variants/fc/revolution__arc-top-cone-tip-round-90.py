# revolution__arc-top-cone-tip-round-90: a cone to a point on the axis (triangle) with the base corner rounded 4, a quarter turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(0,0),(20,0),(0,30)], {1:4})
    revolve(body, sk, 90, 'V_Axis', False)
    emit("revolution__arc-top-cone-tip-round-90", body)
    finish("revolution__arc-top-cone-tip-round-90")
except Exception:
    fail("revolution__arc-top-cone-tip-round-90", traceback.format_exc())
