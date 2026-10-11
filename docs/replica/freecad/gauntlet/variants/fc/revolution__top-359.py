# revolution__top-359: a turn one degree short of full
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 359, 'V_Axis', False)
    emit("revolution__top-359", body)
    finish("revolution__top-359")
except Exception:
    fail("revolution__top-359", traceback.format_exc())
