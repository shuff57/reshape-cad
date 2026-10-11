# revolution__front-lifted-5: the front sketch lifted 5 along its normal (the revolve axis), turned 120
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 10, 5, 20, 35)
    revolve(body, sk, 120, 'V_Axis')
    emit("revolution__front-lifted-5", body)
    finish("revolution__front-lifted-5")
except Exception:
    fail("revolution__front-lifted-5", traceback.format_exc())
