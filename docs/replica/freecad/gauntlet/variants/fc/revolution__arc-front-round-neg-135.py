# revolution__arc-front-round-neg-135: front plane, the rounded ring 135 degrees the other way
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rpoly(sk, [(10,0),(20,0),(20,30),(10,30)], {1:3,2:3})
    revolve(body, sk, 135, 'V_Axis', True)
    emit("revolution__arc-front-round-neg-135", body)
    finish("revolution__arc-front-round-neg-135")
except Exception:
    fail("revolution__arc-front-round-neg-135", traceback.format_exc())
