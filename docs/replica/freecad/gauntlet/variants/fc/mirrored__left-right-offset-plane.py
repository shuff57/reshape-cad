# mirrored__left-right-offset-plane: rect pocket mirrored across x=17 (not the middle), 4 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    rect(s2, 4, 5, 10, 12)
    pk = pocket(body, s2, 4)
    mirrored(body, pk, 'side', 17)
    emit("mirrored__left-right-offset-plane", body)
    finish("mirrored__left-right-offset-plane")
except Exception:
    fail("mirrored__left-right-offset-plane", traceback.format_exc())
