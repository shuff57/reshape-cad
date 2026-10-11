# polar-pattern__count-2-opposite: two holes 180 apart on a disc
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 18, 0, 4)
    pk = pocket(body, p1, None, through=True)
    polar_pattern(body, pk, 'Z_Axis', 360, 2)
    emit("polar-pattern__count-2-opposite", body)
    finish("polar-pattern__count-2-opposite")
except Exception:
    fail("polar-pattern__count-2-opposite", traceback.format_exc())
