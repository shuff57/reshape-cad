# chamfer-asym__pent-oblique-8x1: pentagon prism, oblique top edge (30,0)-(40,15), 8 on the wall and 1 on the top
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,10], [40,15,10])], 8, ChamferType='Two distances', Size2=1)
    emit("chamfer-asym__pent-oblique-8x1", body)
    finish("chamfer-asym__pent-oblique-8x1")
except Exception:
    fail("chamfer-asym__pent-oblique-8x1", traceback.format_exc())
