# revolution__top-solid-rod: full turn of a profile that touches the axis: a solid rod
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 0, 0, 12, 30)
    revolve(body, sk, 360, 'V_Axis')
    emit("revolution__top-solid-rod", body)
    finish("revolution__top-solid-rod")
except Exception:
    fail("revolution__top-solid-rod", traceback.format_exc())
