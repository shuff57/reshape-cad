# mirrored__rect-on-its-own-plane: a rect pocket x 16..24 mirrored across x=20 through its own middle: the reflection is the pocket itself
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 16, 11, 24, 19)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'side', 20)
    emit("mirrored__rect-on-its-own-plane", body)
    finish("mirrored__rect-on-its-own-plane")
except Exception:
    fail("mirrored__rect-on-its-own-plane", traceback.format_exc())
