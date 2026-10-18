# chamfer-asym__pent-oblique-8x1-flip: the same with FlipDirection: the volume itself differs on an oblique edge
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,10], [40,15,10])], 8, ChamferType='Two distances', Size2=1, FlipDirection=True)
    emit("chamfer-asym__pent-oblique-8x1-flip", body)
    finish("chamfer-asym__pent-oblique-8x1-flip")
except Exception:
    fail("chamfer-asym__pent-oblique-8x1-flip", traceback.format_exc())
