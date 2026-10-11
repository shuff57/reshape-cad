# revolution__top-frustum: full turn of a trapezoid: a hollow cone frustum
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    poly(sk, [(5,0),(15,0),(10,25),(5,25)])
    revolve(body, sk, 360, 'V_Axis')
    emit("revolution__top-frustum", body)
    finish("revolution__top-frustum")
except Exception:
    fail("revolution__top-frustum", traceback.format_exc())
