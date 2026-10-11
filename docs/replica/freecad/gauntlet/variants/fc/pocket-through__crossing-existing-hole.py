# pocket-through__crossing-existing-hole: a rectangular through pocket that overlaps an existing through hole
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 14, 15, 4)
    hole(body, hs, 8)
    s2 = sketch(body, 'top', 10)
    rect(s2, 17, 12, 27, 18)
    pocket(body, s2, None, through=True)
    emit("pocket-through__crossing-existing-hole", body)
    finish("pocket-through__crossing-existing-hole")
except Exception:
    fail("pocket-through__crossing-existing-hole", traceback.format_exc())
