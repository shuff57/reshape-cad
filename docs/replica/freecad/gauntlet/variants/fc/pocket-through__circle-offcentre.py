# pocket-through__circle-offcentre: circle 12 across at (30,10)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 30, 10, 6)
    pocket(body, s2, None, through=True)
    emit("pocket-through__circle-offcentre", body)
    finish("pocket-through__circle-offcentre")
except Exception:
    fail("pocket-through__circle-offcentre", traceback.format_exc())
