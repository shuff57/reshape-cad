# linear-pattern__boss-x3: three round bosses (pad) 8 across, 6 tall, on a plate
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
    linear_pattern(body, bp, 'X_Axis', 40, 3)
    emit("linear-pattern__boss-x3", body)
    finish("linear-pattern__boss-x3")
except Exception:
    fail("linear-pattern__boss-x3", traceback.format_exc())
