# pad-symmetric__thin-disc: symmetric 3 mm disc 24 across
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    circle(sk, 0, 0, 12)
    pad(body, sk, 3, 'sym')
    emit("pad-symmetric__thin-disc", body)
    finish("pad-symmetric__thin-disc")
except Exception:
    fail("pad-symmetric__thin-disc", traceback.format_exc())
