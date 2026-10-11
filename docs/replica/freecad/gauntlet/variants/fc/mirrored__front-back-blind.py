# mirrored__front-back-blind: blind pocket 3 deep mirrored across y=12
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 25, 5, 3.5)
    pk = pocket(body, s2, 3)
    mirrored(body, pk, 'front', -12)
    emit("mirrored__front-back-blind", body)
    finish("mirrored__front-back-blind")
except Exception:
    fail("mirrored__front-back-blind", traceback.format_exc())
