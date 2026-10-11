# pad-symmetric__front-plane: symmetric on the front plane, 16
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front', 0)
    rect(sk, 0, 0, 20, 10)
    pad(body, sk, 16, 'sym')
    emit("pad-symmetric__front-plane", body)
    finish("pad-symmetric__front-plane")
except Exception:
    fail("pad-symmetric__front-plane", traceback.format_exc())
