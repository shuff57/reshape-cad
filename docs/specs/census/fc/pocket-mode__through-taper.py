# pocket-mode__through-taper: through all with a 5 degree taper
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
    pocket_x(body, s2, None, Type=1, TaperAngle=5)
    emit("pocket-mode__through-taper", body)
    finish("pocket-mode__through-taper")
except Exception:
    fail("pocket-mode__through-taper", traceback.format_exc())
