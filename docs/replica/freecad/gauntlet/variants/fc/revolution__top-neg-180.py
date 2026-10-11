# revolution__top-neg-180: a half turn the other way (angle -180); FreeCAD: 180 reversed
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 180, 'V_Axis', True)
    emit("revolution__top-neg-180", body)
    finish("revolution__top-neg-180")
except Exception:
    fail("revolution__top-neg-180", traceback.format_exc())
