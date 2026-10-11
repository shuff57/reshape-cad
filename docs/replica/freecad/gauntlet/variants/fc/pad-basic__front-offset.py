# pad-basic__front-offset: front sketch with offset 5 (the front plane offsets toward +Y, pulls toward -Y)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front', 5)
    rect(sk, 0, 0, 40, 30)
    pad(body, sk, 10, 'normal')
    emit("pad-basic__front-offset", body)
    finish("pad-basic__front-offset")
except Exception:
    fail("pad-basic__front-offset", traceback.format_exc())
