# pad-basic__circle-offcentre: a circle 18 across, centre (10,-20), 25 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    circle(sk, 10, -20, 9)
    pad(body, sk, 25, 'normal')
    emit("pad-basic__circle-offcentre", body)
    finish("pad-basic__circle-offcentre")
except Exception:
    fail("pad-basic__circle-offcentre", traceback.format_exc())
