# revolution__front-neg-90: front plane, a quarter turn the other way (angle -90); FreeCAD: 90 reversed
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 90, 'V_Axis', True)
    emit("revolution__front-neg-90", body)
    finish("revolution__front-neg-90")
except Exception:
    fail("revolution__front-neg-90", traceback.format_exc())
