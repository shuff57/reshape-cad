# revolution__arc-top-four-rounds: all four corners rounded (1, 2, 3, 1.5), 100 degrees
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {0:1,1:2,2:3,3:1.5})
    revolve(body, sk, 100, 'V_Axis', False)
    emit("revolution__arc-top-four-rounds", body)
    finish("revolution__arc-top-four-rounds")
except Exception:
    fail("revolution__arc-top-four-rounds", traceback.format_exc())
