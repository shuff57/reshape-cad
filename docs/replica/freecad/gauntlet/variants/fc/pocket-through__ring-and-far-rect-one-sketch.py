# pocket-through__ring-and-far-rect-one-sketch: a ring-shaped through pocket (leaves a disc standing apart, two solids) and a separate square one on one sketch
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
    pocket(body, s2, None, through=True)
    emit_multi("pocket-through__ring-and-far-rect-one-sketch", body)
    finish("pocket-through__ring-and-far-rect-one-sketch")
except Exception:
    fail("pocket-through__ring-and-far-rect-one-sketch", traceback.format_exc())
