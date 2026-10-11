# polar-pattern__overlapping-x6-blind: six blind pockets 24 across (4 deep) on a ring of radius 20 of an 80 disc: neighbours overlap into a ring-shaped recess
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 40)
    base = pad(body, sk1, 10)
    p1 = sketch(body, 'top', 10)
    circle(p1, 20, 0, 12)
    pk = pocket(body, p1, 4)
    polar_pattern(body, pk, 'Z_Axis', 360, 6)
    emit("polar-pattern__overlapping-x6-blind", body)
    finish("polar-pattern__overlapping-x6-blind")
except Exception:
    fail("polar-pattern__overlapping-x6-blind", traceback.format_exc())
