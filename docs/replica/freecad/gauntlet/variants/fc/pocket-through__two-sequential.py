# pocket-through__two-sequential: two through pockets one after the other (a circle and a slot)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pocket(body, s2, None, through=True)
    s3 = sketch(body, 'top', 10)
    rect(s3, 24, 13, 32, 17)
    pocket(body, s3, None, through=True)
    emit("pocket-through__two-sequential", body)
    finish("pocket-through__two-sequential")
except Exception:
    fail("pocket-through__two-sequential", traceback.format_exc())
