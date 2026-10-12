# pocket-through__two-holes-one-sketch: two round through pockets on one sketch
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 4)
    circle(s2, 30, 15, 4)
    pocket(body, s2, None, through=True)
    emit("pocket-through__two-holes-one-sketch", body)
    finish("pocket-through__two-holes-one-sketch")
except Exception:
    fail("pocket-through__two-holes-one-sketch", traceback.format_exc())
