# pocket-blind__tiny: tiny: circle 1 across, 0.5 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 0.5)
    pocket(body, s2, 0.5)
    emit("pocket-blind__tiny", body)
    finish("pocket-blind__tiny")
except Exception:
    fail("pocket-blind__tiny", traceback.format_exc())
