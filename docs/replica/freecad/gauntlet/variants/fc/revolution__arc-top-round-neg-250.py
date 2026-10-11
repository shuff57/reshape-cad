# revolution__arc-top-round-neg-250: the rounded ring 250 degrees the other way
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {2:3})
    revolve(body, sk, 250, 'V_Axis', True)
    emit("revolution__arc-top-round-neg-250", body)
    finish("revolution__arc-top-round-neg-250")
except Exception:
    fail("revolution__arc-top-round-neg-250", traceback.format_exc())
