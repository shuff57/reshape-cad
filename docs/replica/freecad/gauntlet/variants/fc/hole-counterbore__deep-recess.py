# hole-counterbore__deep-recess: counterbore 14 x 7 over a 6 hole in a 20 thick block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 20)
    hs = sketch(body, 'top', 20)
    circle(hs, 20, 15, 3)
    hole(body, hs, 6, None, cut='Counterbore', cut_dia=14, cut_depth=7)
    emit("hole-counterbore__deep-recess", body)
    finish("hole-counterbore__deep-recess")
except Exception:
    fail("hole-counterbore__deep-recess", traceback.format_exc())
