# pad-basic__rect-with-round-hole-geom: a 40 x 30 plate profile written as geom rows with a r5 circle hole in it, 12 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    rect(sk, 0, 0, 40, 30)
    circle(sk, 12, 15, 5)
    pad(body, sk, 12)
    emit("pad-basic__rect-with-round-hole-geom", body)
    finish("pad-basic__rect-with-round-hole-geom")
except Exception:
    fail("pad-basic__rect-with-round-hole-geom", traceback.format_exc())
