# polar-pattern__holes-x12-ring: twelve holes 10 across on a ring of radius 20 (neighbours 0.35 apart)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 20, 0, 5)
    pk = pocket(body, p1, None, through=True)
    polar_pattern(body, pk, 'Z_Axis', 360, 12)
    emit("polar-pattern__holes-x12-ring", body)
    finish("polar-pattern__holes-x12-ring")
except Exception:
    fail("polar-pattern__holes-x12-ring", traceback.format_exc())
