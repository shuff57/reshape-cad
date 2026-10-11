# revolution__side-270: three quarter turn about X (side plane)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 0, 10, 30, 20)
    revolve(body, sk, 270, 'H_Axis')
    emit("revolution__side-270", body)
    finish("revolution__side-270")
except Exception:
    fail("revolution__side-270", traceback.format_exc())
