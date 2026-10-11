# pocket-blind__runs-off-the-side: a rectangle 20 x 10 centred on the x=40 edge, 3 deep: half of it is outside the plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 30, 10, 50, 20)
    pocket(body, s2, 3)
    emit("pocket-blind__runs-off-the-side", body)
    finish("pocket-blind__runs-off-the-side")
except Exception:
    fail("pocket-blind__runs-off-the-side", traceback.format_exc())
