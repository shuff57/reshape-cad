# revolution__arc-top-round-30: the same rounded ring, 30 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 30, 'V_Axis', False)
    emit("revolution__arc-top-round-30", body)
    finish("revolution__arc-top-round-30")
except Exception:
    fail("revolution__arc-top-round-30", traceback.format_exc())
