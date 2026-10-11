# pocket-through__from-side-face: through the x direction (sketch side at the x=40 face)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'side', 40)
    circle(s2, 15, 5, 3)
    pocket(body, s2, None, through=True)
    emit("pocket-through__from-side-face", body)
    finish("pocket-through__from-side-face")
except Exception:
    fail("pocket-through__from-side-face", traceback.format_exc())
