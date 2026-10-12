# pocket-mode__direction-slanted: a slanted cut, direction (1,0,-1) of a 10 x 8 rect, 6 along the normal
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 15, 11, 25, 19)
    pocket_x(body, s2, 6, UseCustomVector=True, Direction=V(1,0,-1))
    emit("pocket-mode__direction-slanted", body)
    finish("pocket-mode__direction-slanted")
except Exception:
    fail("pocket-mode__direction-slanted", traceback.format_exc())
