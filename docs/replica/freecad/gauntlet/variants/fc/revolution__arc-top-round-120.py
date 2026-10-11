# revolution__arc-top-round-120: the same rounded ring, 120 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 120, 'V_Axis', False)
    emit("revolution__arc-top-round-120", body)
    finish("revolution__arc-top-round-120")
except Exception:
    fail("revolution__arc-top-round-120", traceback.format_exc())
