# pocket-blind__depth-zero: a pocket of depth 0 (nothing to cut): the reference and the script should both refuse
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 4)
    pocket(body, s2, 0)
    emit("pocket-blind__depth-zero", body)
    finish("pocket-blind__depth-zero")
except Exception:
    fail("pocket-blind__depth-zero", traceback.format_exc())
