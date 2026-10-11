# revolution__arc-top-round-270: the same rounded ring, three quarters of a turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 270, 'V_Axis', False)
    emit("revolution__arc-top-round-270", body)
    finish("revolution__arc-top-round-270")
except Exception:
    fail("revolution__arc-top-round-270", traceback.format_exc())
