# hole-counterbore__wide-thin: counterbore 24 x 2 over a 5 hole in a 6 thick plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 60, 40)
    base = pad(body, s1, 6)
    hs = sketch(body, 'top', 6)
    circle(hs, 30, 20, 2.5)
    hole(body, hs, 5, None, cut='Counterbore', cut_dia=24, cut_depth=2)
    emit("hole-counterbore__wide-thin", body)
    finish("hole-counterbore__wide-thin")
except Exception:
    fail("hole-counterbore__wide-thin", traceback.format_exc())
