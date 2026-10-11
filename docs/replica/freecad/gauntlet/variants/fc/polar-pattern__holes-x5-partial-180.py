# polar-pattern__holes-x5-partial-180: five holes over 180 degrees (FreeCAD spaces angle/(n-1))
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 20, 0, 2.5)
    pk = pocket(body, p1, None, through=True)
    polar_pattern(body, pk, 'Z_Axis', 180, 5)
    emit("polar-pattern__holes-x5-partial-180", body)
    finish("polar-pattern__holes-x5-partial-180")
except Exception:
    fail("polar-pattern__holes-x5-partial-180", traceback.format_exc())
