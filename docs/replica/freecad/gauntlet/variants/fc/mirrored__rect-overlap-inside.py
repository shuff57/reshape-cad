# mirrored__rect-overlap-inside: a rect pocket x 10..18 mirrored across x=16: the reflection (14..22) overlaps it and stays inside the plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 10, 11, 18, 19)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'side', 16)
    emit("mirrored__rect-overlap-inside", body)
    finish("mirrored__rect-overlap-inside")
except Exception:
    fail("mirrored__rect-overlap-inside", traceback.format_exc())
