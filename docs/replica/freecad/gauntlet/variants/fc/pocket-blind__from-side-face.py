# pocket-blind__from-side-face: pocket from the x=40 face (sketch side, offset 40), rect, 6 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'side', 40)
    rect(s2, 8, 2, 20, 8)
    pocket(body, s2, 6)
    emit("pocket-blind__from-side-face", body)
    finish("pocket-blind__from-side-face")
except Exception:
    fail("pocket-blind__from-side-face", traceback.format_exc())
