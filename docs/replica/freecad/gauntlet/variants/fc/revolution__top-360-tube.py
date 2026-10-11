# revolution__top-360-tube: full turn about Z, tube radius 8..14, 20 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 8, 0, 14, 20)
    revolve(body, sk, 360, 'V_Axis')
    emit("revolution__top-360-tube", body)
    finish("revolution__top-360-tube")
except Exception:
    fail("revolution__top-360-tube", traceback.format_exc())
