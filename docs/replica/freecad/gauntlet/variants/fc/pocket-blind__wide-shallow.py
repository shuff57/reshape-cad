# pocket-blind__wide-shallow: extreme aspect: 36 x 4 slot, 1 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 2, 13, 38, 17)
    pocket(body, s2, 1)
    emit("pocket-blind__wide-shallow", body)
    finish("pocket-blind__wide-shallow")
except Exception:
    fail("pocket-blind__wide-shallow", traceback.format_exc())
