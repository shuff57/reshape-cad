# revolution__top-400: an angle past a full turn (400); FreeCAD: a full turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 360, 'V_Axis', False)
    emit("revolution__top-400", body)
    finish("revolution__top-400")
except Exception:
    fail("revolution__top-400", traceback.format_exc())
