# pad-basic__reversed: reversed pad: pulled DOWN 10 from the plane
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 5, 5, 45, 35)
    pad(body, sk, 10, 'reversed')
    emit("pad-basic__reversed", body)
    finish("pad-basic__reversed")
except Exception:
    fail("pad-basic__reversed", traceback.format_exc())
