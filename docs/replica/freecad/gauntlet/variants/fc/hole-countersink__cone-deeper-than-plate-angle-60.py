# hole-countersink__cone-deeper-than-plate-angle-60: a 24 / 60 countersink over a 5 hole in a 40 x 40 x 6 plate: the cone (16.5 deep) exits the bottom as a 13.9 wide circle
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 40)
    base = pad(body, s1, 6)
    hs = sketch(body, 'top', 6)
    circle(hs, 20, 20, 2.5)
    hole(body, hs, 5, None, cut='Countersink', cut_dia=24, cs_angle=60)
    emit("hole-countersink__cone-deeper-than-plate-angle-60", body)
    finish("hole-countersink__cone-deeper-than-plate-angle-60")
except Exception:
    fail("hole-countersink__cone-deeper-than-plate-angle-60", traceback.format_exc())
