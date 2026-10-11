# linear-pattern__holes-x3: three through holes, 20 apart along x
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
    linear_pattern(body, pk, 'X_Axis', 40, 3)
    emit("linear-pattern__holes-x3", body)
    finish("linear-pattern__holes-x3")
except Exception:
    fail("linear-pattern__holes-x3", traceback.format_exc())
