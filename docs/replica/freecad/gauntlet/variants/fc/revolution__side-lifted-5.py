# revolution__side-lifted-5: the side sketch lifted 5 along its normal (the revolve axis), turned 120
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 5, 10, 35, 20)
    revolve(body, sk, 120, 'H_Axis')
    emit("revolution__side-lifted-5", body)
    finish("revolution__side-lifted-5")
except Exception:
    fail("revolution__side-lifted-5", traceback.format_exc())
