# hole-countersink__cone-deeper-than-plate-roomy: the same 30 / 90 countersink over a 5 hole in a 40 x 40 x 10 plate: the cone passes through the bottom face, with 5 mm of top face left on every side
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 40)
    base = pad(body, s1, 10)
    hs = sketch(body, 'top', 10)
    circle(hs, 20, 20, 2.5)
    hole(body, hs, 5, None, cut='Countersink', cut_dia=30, cs_angle=90)
    emit("hole-countersink__cone-deeper-than-plate-roomy", body)
    finish("hole-countersink__cone-deeper-than-plate-roomy")
except Exception:
    fail("hole-countersink__cone-deeper-than-plate-roomy", traceback.format_exc())
