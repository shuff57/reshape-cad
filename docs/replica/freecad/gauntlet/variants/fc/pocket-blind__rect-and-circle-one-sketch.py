# pocket-blind__rect-and-circle-one-sketch: a square pocket and a round pocket on one sketch, 3 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 6, 11, 14, 19)
    circle(s2, 30, 15, 4)
    pocket(body, s2, 3)
    emit("pocket-blind__rect-and-circle-one-sketch", body)
    finish("pocket-blind__rect-and-circle-one-sketch")
except Exception:
    fail("pocket-blind__rect-and-circle-one-sketch", traceback.format_exc())
