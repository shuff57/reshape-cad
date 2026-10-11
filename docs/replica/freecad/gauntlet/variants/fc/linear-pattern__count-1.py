# linear-pattern__count-1: a pattern of count 1 is the single hole
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 60, 20)
    base = pad(body, s1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 10, 10, 3)
    pk = pocket(body, p1, None, through=True)
    linear_pattern(body, pk, 'X_Axis', 0, 1)
    emit("linear-pattern__count-1", body)
    finish("linear-pattern__count-1")
except Exception:
    fail("linear-pattern__count-1", traceback.format_exc())
