# chamfer-asym__para-vertical-angle-2-60-flip: the same corner, 2 at 60 with FlipDirection (the 2 is on the right wall, the angle is taken from it)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,20),(10,20)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,0], [30,0,10])], 2, ChamferType='Distance and Angle', Angle=60, FlipDirection=True)
    emit("chamfer-asym__para-vertical-angle-2-60-flip", body)
    finish("chamfer-asym__para-vertical-angle-2-60-flip")
except Exception:
    fail("chamfer-asym__para-vertical-angle-2-60-flip", traceback.format_exc())
