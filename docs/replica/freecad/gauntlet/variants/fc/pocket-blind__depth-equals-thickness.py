# pocket-blind__depth-equals-thickness: a blind pocket exactly as deep as the plate (10 of 10)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 4)
    pocket(body, s2, 10)
    emit("pocket-blind__depth-equals-thickness", body)
    finish("pocket-blind__depth-equals-thickness")
except Exception:
    fail("pocket-blind__depth-equals-thickness", traceback.format_exc())
