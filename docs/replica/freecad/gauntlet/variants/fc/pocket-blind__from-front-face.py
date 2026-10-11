# pocket-blind__from-front-face: pocket from the front face (sketch front, offset 0), 8 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'front', 0)
    circle(s2, 20, 5, 6)
    pocket(body, s2, 8)
    emit("pocket-blind__from-front-face", body)
    finish("pocket-blind__from-front-face")
except Exception:
    fail("pocket-blind__from-front-face", traceback.format_exc())
