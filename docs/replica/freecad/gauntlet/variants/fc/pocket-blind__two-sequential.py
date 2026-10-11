# pocket-blind__two-sequential: two pockets one after the other: a round one 4 deep and a square one 3 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pocket(body, s2, 4)
    s3 = sketch(body, 'top', 10)
    rect(s3, 24, 11, 32, 19)
    pocket(body, s3, 3)
    emit("pocket-blind__two-sequential", body)
    finish("pocket-blind__two-sequential")
except Exception:
    fail("pocket-blind__two-sequential", traceback.format_exc())
