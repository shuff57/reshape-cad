# pocket-blind__rect-offcentre: rectangle 8 x 6 near a corner, 4 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 26, 5, 34, 11)
    pocket(body, s2, 4)
    emit("pocket-blind__rect-offcentre", body)
    finish("pocket-blind__rect-offcentre")
except Exception:
    fail("pocket-blind__rect-offcentre", traceback.format_exc())
