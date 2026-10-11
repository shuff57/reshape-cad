# hole-counterbore__in-cylinder: a 6 hole with a 12 x 4 counterbore down the axis of a cylinder 30 across, 20 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 15)
    base = pad(body, sk, 20)
    hs = sketch(body, 'top', 20)
    circle(hs, 0, 0, 3)
    hole(body, hs, 6, None, cut='Counterbore', cut_dia=12, cut_depth=4)
    emit("hole-counterbore__in-cylinder", body)
    finish("hole-counterbore__in-cylinder")
except Exception:
    fail("hole-counterbore__in-cylinder", traceback.format_exc())
