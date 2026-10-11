# revolution__arc-top-round-90: a ring r10..20, 30 tall with its top-outer corner rounded 3, a quarter turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 90, 'V_Axis', False)
    emit("revolution__arc-top-round-90", body)
    finish("revolution__arc-top-round-90")
except Exception:
    fail("revolution__arc-top-round-90", traceback.format_exc())
