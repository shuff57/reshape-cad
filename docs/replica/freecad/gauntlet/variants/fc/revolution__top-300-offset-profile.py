# revolution__top-300-offset-profile: 300 degrees of an off-axis L profile
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    poly(sk, [(6,2),(16,2),(16,8),(10,8),(10,20),(6,20)])
    revolve(body, sk, 300, 'V_Axis')
    emit("revolution__top-300-offset-profile", body)
    finish("revolution__top-300-offset-profile")
except Exception:
    fail("revolution__top-300-offset-profile", traceback.format_exc())
