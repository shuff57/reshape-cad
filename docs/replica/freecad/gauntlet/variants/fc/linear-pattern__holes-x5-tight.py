# linear-pattern__holes-x5-tight: five holes with only 1 mm of web between them (step 8, d 7)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 60, 20)
    base = pad(body, s1, 8)
    p1 = sketch(body, 'top', 8)
    circle(p1, 6, 10, 3.5)
    pk = pocket(body, p1, None, through=True)
    linear_pattern(body, pk, 'X_Axis', 32, 5)
    emit("linear-pattern__holes-x5-tight", body)
    finish("linear-pattern__holes-x5-tight")
except Exception:
    fail("linear-pattern__holes-x5-tight", traceback.format_exc())
