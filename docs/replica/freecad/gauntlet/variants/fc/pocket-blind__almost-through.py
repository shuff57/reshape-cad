# pocket-blind__almost-through: circle 8 across, 9.5 of 10 deep (0.5 floor)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 12, 20, 4)
    pocket(body, s2, 9.5)
    emit("pocket-blind__almost-through", body)
    finish("pocket-blind__almost-through")
except Exception:
    fail("pocket-blind__almost-through", traceback.format_exc())
