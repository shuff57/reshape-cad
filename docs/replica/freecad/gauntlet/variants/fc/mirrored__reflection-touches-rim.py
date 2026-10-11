# mirrored__reflection-touches-rim: a rect pocket x 30..38 mirrored across x=38: the reflection (38..46) only touches the original and runs off the plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 30, 11, 38, 19)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'side', 38)
    emit("mirrored__reflection-touches-rim", body)
    finish("mirrored__reflection-touches-rim")
except Exception:
    fail("mirrored__reflection-touches-rim", traceback.format_exc())
