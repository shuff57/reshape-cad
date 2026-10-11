# pad-basic__sketch-offset-top: top sketch lifted to z=7, pad 6
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 7)
    rect(sk, 0, 0, 25, 15)
    pad(body, sk, 6, 'normal')
    emit("pad-basic__sketch-offset-top", body)
    finish("pad-basic__sketch-offset-top")
except Exception:
    fail("pad-basic__sketch-offset-top", traceback.format_exc())
