# pad-basic__front-plane: a different sketch plane: front (XZ), 40 x 30 x 10
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front', 0)
    rect(sk, 0, 0, 40, 30)
    pad(body, sk, 10, 'normal')
    emit("pad-basic__front-plane", body)
    finish("pad-basic__front-plane")
except Exception:
    fail("pad-basic__front-plane", traceback.format_exc())
