# mirrored__reflection-runs-off: a pocket whose reflection (x 34..42) leaves the 40 wide plate
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
    mirrored(body, pk, 'side', 36)
    emit("mirrored__reflection-runs-off", body)
    finish("mirrored__reflection-runs-off")
except Exception:
    fail("mirrored__reflection-runs-off", traceback.format_exc())
