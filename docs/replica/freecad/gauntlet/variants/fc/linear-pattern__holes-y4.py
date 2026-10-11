# linear-pattern__holes-y4: four holes along y, step 12, 50 deep plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 30, 60)
    base = pad(body, s1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 15, 8, 2.5)
    pk = pocket(body, p1, None, through=True)
    linear_pattern(body, pk, 'Y_Axis', 42, 4)
    emit("linear-pattern__holes-y4", body)
    finish("linear-pattern__holes-y4")
except Exception:
    fail("linear-pattern__holes-y4", traceback.format_exc())
