# polar-pattern__holes-x3-disc: three holes on a disc, hole centre at (0,22)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 0, 22, 4)
    pk = pocket(body, p1, None, through=True)
    polar_pattern(body, pk, 'Z_Axis', 360, 3)
    emit("polar-pattern__holes-x3-disc", body)
    finish("polar-pattern__holes-x3-disc")
except Exception:
    fail("polar-pattern__holes-x3-disc", traceback.format_exc())
