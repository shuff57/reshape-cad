# pocket-through__deeper-than-part: depth 50 into a 10 thick plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 5)
    pocket(body, s2, None, through=True)
    emit("pocket-through__deeper-than-part", body)
    finish("pocket-through__deeper-than-part")
except Exception:
    fail("pocket-through__deeper-than-part", traceback.format_exc())
