# pocket-blind__depth-negative: a pocket of depth -3: the reference and the script should both refuse
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 4)
    pocket(body, s2, -3)
    emit("pocket-blind__depth-negative", body)
    finish("pocket-blind__depth-negative")
except Exception:
    fail("pocket-blind__depth-negative", traceback.format_exc())
