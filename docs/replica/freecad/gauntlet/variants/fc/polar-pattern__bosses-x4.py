# polar-pattern__bosses-x4: four round bosses 6 across, 5 tall, on a disc
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 22, 0, 3)
    bp = pad(body, s2, 5)
    polar_pattern(body, bp, 'Z_Axis', 360, 4)
    emit("polar-pattern__bosses-x4", body)
    finish("polar-pattern__bosses-x4")
except Exception:
    fail("polar-pattern__bosses-x4", traceback.format_exc())
