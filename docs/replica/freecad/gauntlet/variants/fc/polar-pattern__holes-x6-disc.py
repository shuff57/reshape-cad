# polar-pattern__holes-x6-disc: six holes on a 40 across ring (r 20) of a 60 disc
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 20, 0, 3)
    pk = pocket(body, p1, None, through=True)
    polar_pattern(body, pk, 'Z_Axis', 360, 6)
    emit("polar-pattern__holes-x6-disc", body)
    finish("polar-pattern__holes-x6-disc")
except Exception:
    fail("polar-pattern__holes-x6-disc", traceback.format_exc())
