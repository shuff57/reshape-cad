# revolution__top-3-sliver: a 3 degree sliver of a ring 10 wide, 30 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 3, 'V_Axis', False)
    emit("revolution__top-3-sliver", body)
    finish("revolution__top-3-sliver")
except Exception:
    fail("revolution__top-3-sliver", traceback.format_exc())
