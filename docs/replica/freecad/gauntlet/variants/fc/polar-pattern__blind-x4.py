# polar-pattern__blind-x4: four blind pockets, depth 4, disc 80 across
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 40)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 28, 0, 4)
    pk = pocket(body, p1, 4)
    polar_pattern(body, pk, 'Z_Axis', 360, 4)
    emit("polar-pattern__blind-x4", body)
    finish("polar-pattern__blind-x4")
except Exception:
    fail("polar-pattern__blind-x4", traceback.format_exc())
