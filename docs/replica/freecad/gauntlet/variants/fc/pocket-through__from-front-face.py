# pocket-through__from-front-face: through the plate from the front face, depth 30
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'front', 0)
    circle(s2, 20, 5, 3)
    pocket(body, s2, None, through=True)
    emit("pocket-through__from-front-face", body)
    finish("pocket-through__from-front-face")
except Exception:
    fail("pocket-through__from-front-face", traceback.format_exc())
