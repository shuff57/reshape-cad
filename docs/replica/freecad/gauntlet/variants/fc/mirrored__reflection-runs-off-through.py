# mirrored__reflection-runs-off-through: the runs-off pocket cut all the way through the plate (10 deep)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 30, 11, 38, 19)
    pk = pocket(body, s2, 10)
    mirrored(body, pk, 'side', 36)
    emit("mirrored__reflection-runs-off-through", body)
    finish("mirrored__reflection-runs-off-through")
except Exception:
    fail("mirrored__reflection-runs-off-through", traceback.format_exc())
