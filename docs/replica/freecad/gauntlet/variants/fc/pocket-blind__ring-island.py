# pocket-blind__ring-island: a ring-shaped pocket (circle 20 across with an island of 8 across written as geom rows), 4 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 10)
    circle(s2, 20, 15, 4)
    pocket(body, s2, 4)
    emit("pocket-blind__ring-island", body)
    finish("pocket-blind__ring-island")
except Exception:
    fail("pocket-blind__ring-island", traceback.format_exc())
