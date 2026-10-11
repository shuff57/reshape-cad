# pocket-blind__from-bottom-face: pocket from the bottom face, 4 deep (ours: a frame with normal -Z; FreeCAD: reversed pocket)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 0)
    circle(s2, 10, 12, 6)
    pocket(body, s2, 4, reversed_=True)
    emit("pocket-blind__from-bottom-face", body)
    finish("pocket-blind__from-bottom-face")
except Exception:
    fail("pocket-blind__from-bottom-face", traceback.format_exc())
