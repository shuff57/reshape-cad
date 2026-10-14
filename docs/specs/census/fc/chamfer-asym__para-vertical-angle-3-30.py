# chamfer-asym__para-vertical-angle-3-30: parallelogram prism, vertical front/right edge (116.57 degrees), 3 at 30: the second leg is 2.722373, not 3 tan 30
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,20),(10,20)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,0], [30,0,10])], 3, ChamferType='Distance and Angle', Angle=30)
    emit("chamfer-asym__para-vertical-angle-3-30", body)
    finish("chamfer-asym__para-vertical-angle-3-30")
except Exception:
    fail("chamfer-asym__para-vertical-angle-3-30", traceback.format_exc())
