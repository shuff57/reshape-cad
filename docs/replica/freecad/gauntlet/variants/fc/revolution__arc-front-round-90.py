# revolution__arc-front-round-90: front plane (axis Y): the rounded ring, a quarter turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 90, 'V_Axis', False)
    emit("revolution__arc-front-round-90", body)
    finish("revolution__arc-front-round-90")
except Exception:
    fail("revolution__arc-front-round-90", traceback.format_exc())
