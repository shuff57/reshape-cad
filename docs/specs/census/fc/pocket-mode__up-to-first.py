# pocket-mode__up-to-first: a cut up to the first face it meets (a plate over a plate)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top', 0)
    rect(s1, 0, 0, 40, 30)
    b1 = pad(body, s1, 20)
    s2 = sketch(body, 'top', 20)
    circle(s2, 20, 15, 4)
    pocket_x(body, s2, None, Type='UpToFirst')
    emit("pocket-mode__up-to-first", body)
    finish("pocket-mode__up-to-first")
except Exception:
    fail("pocket-mode__up-to-first", traceback.format_exc())
