# revolution__top-45-thin: extreme: 45 degrees of a thin ring 0.5 wide, 40 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 30, 0, 30.5, 40)
    revolve(body, sk, 45, 'V_Axis')
    emit("revolution__top-45-thin", body)
    finish("revolution__top-45-thin")
except Exception:
    fail("revolution__top-45-thin", traceback.format_exc())
