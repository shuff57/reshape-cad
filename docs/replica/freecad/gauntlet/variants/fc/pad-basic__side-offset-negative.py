# pad-basic__side-offset-negative: side sketch offset -6, pad 10 (x from -6 to 4)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'side', -6)
    rect(sk, 0, 0, 25, 18)
    pad(body, sk, 10, 'normal')
    emit("pad-basic__side-offset-negative", body)
    finish("pad-basic__side-offset-negative")
except Exception:
    fail("pad-basic__side-offset-negative", traceback.format_exc())
