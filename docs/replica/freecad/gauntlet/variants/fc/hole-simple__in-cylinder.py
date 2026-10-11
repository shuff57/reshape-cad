# hole-simple__in-cylinder: a 6 hole down the axis of a cylinder 30 across, 20 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 15)
    base = pad(body, sk, 20)
    hs = sketch(body, 'top', 20)
    circle(hs, 0, 0, 3)
    hole(body, hs, 6)
    emit("hole-simple__in-cylinder", body)
    finish("hole-simple__in-cylinder")
except Exception:
    fail("hole-simple__in-cylinder", traceback.format_exc())
