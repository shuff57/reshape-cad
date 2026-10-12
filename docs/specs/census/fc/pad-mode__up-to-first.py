# pad-mode__up-to-first: a 6 across post under a plate, padded up to the first face it meets
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top', 0)
    rect(s1, -20, -20, 20, 20)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', -8)
    circle(s2, 0, 0, 3)
    pad_x(body, s2, 5, Type='UpToFirst')
    emit("pad-mode__up-to-first", body)
    finish("pad-mode__up-to-first")
except Exception:
    fail("pad-mode__up-to-first", traceback.format_exc())
