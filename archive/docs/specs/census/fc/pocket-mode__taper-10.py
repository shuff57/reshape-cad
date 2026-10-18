# pocket-mode__taper-10: blind 6 with a 10 degree taper
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
    pocket_x(body, s2, 6, TaperAngle=10)
    emit("pocket-mode__taper-10", body)
    finish("pocket-mode__taper-10")
except Exception:
    fail("pocket-mode__taper-10", traceback.format_exc())
