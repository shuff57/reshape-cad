# pocket-blind__triangle: triangular polygon pocket 3 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    poly(s2, [(5,5),(20,5),(5,22)])
    pocket(body, s2, 3)
    emit("pocket-blind__triangle", body)
    finish("pocket-blind__triangle")
except Exception:
    fail("pocket-blind__triangle", traceback.format_exc())
