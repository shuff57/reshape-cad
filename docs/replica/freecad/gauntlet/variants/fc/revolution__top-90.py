# revolution__top-90: quarter turn about Z
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 90, 'V_Axis')
    emit("revolution__top-90", body)
    finish("revolution__top-90")
except Exception:
    fail("revolution__top-90", traceback.format_exc())
