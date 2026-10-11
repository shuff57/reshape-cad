# mirrored__reflection-runs-off-front: a rect pocket y 22..28 mirrored across y=28 (front-back): the reflection (28..34) leaves the 30 deep plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 14, 22, 26, 28)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'front', -28)
    emit("mirrored__reflection-runs-off-front", body)
    finish("mirrored__reflection-runs-off-front")
except Exception:
    fail("mirrored__reflection-runs-off-front", traceback.format_exc())
