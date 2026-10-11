# pad-symmetric__rect-offcentre: symmetric 10 about z=0, rectangle off the origin
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, -15, 7, 25, 37)
    pad(body, sk, 10, 'sym')
    emit("pad-symmetric__rect-offcentre", body)
    finish("pad-symmetric__rect-offcentre")
except Exception:
    fail("pad-symmetric__rect-offcentre", traceback.format_exc())
