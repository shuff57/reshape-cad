# linear-pattern__copies-run-off-the-part: four holes step 20 from x=10 in a 60 plate: the 4th is at x=70, off the plate
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
    linear_pattern(body, pk, 'X_Axis', 60, 4)
    emit("linear-pattern__copies-run-off-the-part", body)
    finish("linear-pattern__copies-run-off-the-part")
except Exception:
    fail("linear-pattern__copies-run-off-the-part", traceback.format_exc())
