# pad-basic__ring-with-hole: a profile with an island written as geom rows: circle r20 with a circle r10 inside it, 15 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 20)
    circle(sk, 0, 0, 10)
    pad(body, sk, 15)
    emit("pad-basic__ring-with-hole", body)
    finish("pad-basic__ring-with-hole")
except Exception:
    fail("pad-basic__ring-with-hole", traceback.format_exc())
