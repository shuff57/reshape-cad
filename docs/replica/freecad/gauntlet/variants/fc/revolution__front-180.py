# revolution__front-180: half turn about Y (front plane)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 10, 0, 20, 30)
    revolve(body, sk, 180, 'V_Axis')
    emit("revolution__front-180", body)
    finish("revolution__front-180")
except Exception:
    fail("revolution__front-180", traceback.format_exc())
