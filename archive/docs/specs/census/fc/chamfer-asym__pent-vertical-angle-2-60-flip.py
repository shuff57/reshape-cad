# chamfer-asym__pent-vertical-angle-2-60-flip: pentagon prism, vertical front/right edge, 2 at 60 flipped: 123.69 + 60 > 180, FreeCAD marks the feature invalid; INTENDED REFUSAL
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,0], [30,0,10])], 2, ChamferType='Distance and Angle', Angle=60, FlipDirection=True)
    emit("chamfer-asym__pent-vertical-angle-2-60-flip", body)
    finish("chamfer-asym__pent-vertical-angle-2-60-flip")
except Exception:
    fail("chamfer-asym__pent-vertical-angle-2-60-flip", traceback.format_exc())
