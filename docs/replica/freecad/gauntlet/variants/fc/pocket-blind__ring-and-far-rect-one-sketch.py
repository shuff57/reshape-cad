# pocket-blind__ring-and-far-rect-one-sketch: a ring-shaped pocket and a separate square pocket on one sketch, 4 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 60, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 15, 15, 12)
    circle(s2, 15, 15, 8)
    rect(s2, 41, 11, 49, 19)
    pocket(body, s2, 4)
    emit("pocket-blind__ring-and-far-rect-one-sketch", body)
    finish("pocket-blind__ring-and-far-rect-one-sketch")
except Exception:
    fail("pocket-blind__ring-and-far-rect-one-sketch", traceback.format_exc())
