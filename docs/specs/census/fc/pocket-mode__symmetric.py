# pocket-mode__symmetric: symmetric: 6 total about the top face (3 into the plate)
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
    pocket_x(body, s2, 6, SideType='Symmetric')
    emit("pocket-mode__symmetric", body)
    finish("pocket-mode__symmetric")
except Exception:
    fail("pocket-mode__symmetric", traceback.format_exc())
