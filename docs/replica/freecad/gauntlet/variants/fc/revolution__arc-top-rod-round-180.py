# revolution__arc-top-rod-round-180: a solid rod (touches the axis) with its top corner rounded 5, a half turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(0,0),(12,0),(12,30),(0,30)], {2:5})
    revolve(body, sk, 180, 'V_Axis', False)
    emit("revolution__arc-top-rod-round-180", body)
    finish("revolution__arc-top-rod-round-180")
except Exception:
    fail("revolution__arc-top-rod-round-180", traceback.format_exc())
