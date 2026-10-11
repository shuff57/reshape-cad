# pocket-through__long-slot: extreme aspect: 36 x 4 slot through
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 2, 13, 38, 17)
    pocket(body, s2, None, through=True)
    emit("pocket-through__long-slot", body)
    finish("pocket-through__long-slot")
except Exception:
    fail("pocket-through__long-slot", traceback.format_exc())
