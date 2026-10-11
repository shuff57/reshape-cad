# pocket-through__triangle-thick: triangle through a 25 thick block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 25)
    s2 = sketch(body, 'top', 25)
    poly(s2, [(5,5),(30,5),(5,25)])
    pocket(body, s2, None, through=True)
    emit("pocket-through__triangle-thick", body)
    finish("pocket-through__triangle-thick")
except Exception:
    fail("pocket-through__triangle-thick", traceback.format_exc())
