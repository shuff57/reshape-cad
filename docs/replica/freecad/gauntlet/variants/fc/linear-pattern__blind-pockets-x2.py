# linear-pattern__blind-pockets-x2: two blind rectangular pockets, 25 apart, depth 4
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 70, 30)
    base = pad(body, s1, 10)
    p1 = sketch(body, 'top', 10)
    rect(p1, 5, 8, 15, 22)
    pk = pocket(body, p1, 4)
    linear_pattern(body, pk, 'X_Axis', 25, 2)
    emit("linear-pattern__blind-pockets-x2", body)
    finish("linear-pattern__blind-pockets-x2")
except Exception:
    fail("linear-pattern__blind-pockets-x2", traceback.format_exc())
