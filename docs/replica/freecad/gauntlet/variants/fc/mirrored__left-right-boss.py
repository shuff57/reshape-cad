# mirrored__left-right-boss: a round boss mirrored across x=30
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 60, 30)
    base = pad(body, s1, 5)
    s2 = sketch(body, 'top', 5)
    circle(s2, 10, 15, 4)
    bp = pad(body, s2, 6)
    mirrored(body, bp, 'side', 30)
    emit("mirrored__left-right-boss", body)
    finish("mirrored__left-right-boss")
except Exception:
    fail("mirrored__left-right-boss", traceback.format_exc())
