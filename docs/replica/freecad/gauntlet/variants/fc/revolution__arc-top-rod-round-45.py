# revolution__arc-top-rod-round-45: the rounded rod, 45 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(0,0),(12,0),(12,30),(0,30)], {2:5})
    revolve(body, sk, 45, 'V_Axis', False)
    emit("revolution__arc-top-rod-round-45", body)
    finish("revolution__arc-top-rod-round-45")
except Exception:
    fail("revolution__arc-top-rod-round-45", traceback.format_exc())
