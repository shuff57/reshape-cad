# revolution__arc-top-two-rounds: both outer corners rounded (4 and 2.5), 200 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {1:4,2:2.5})
    revolve(body, sk, 200, 'V_Axis', False)
    emit("revolution__arc-top-two-rounds", body)
    finish("revolution__arc-top-two-rounds")
except Exception:
    fail("revolution__arc-top-two-rounds", traceback.format_exc())
