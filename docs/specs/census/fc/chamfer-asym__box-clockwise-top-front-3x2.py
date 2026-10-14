# chamfer-asym__box-clockwise-top-front-3x2: box drawn clockwise, top/front edge, 3 x 2; INTENDED REFUSAL (face numbering of a clockwise outline not probed)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(0,20),(30,20),(30,0)])
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Two distances', Size2=2)
    emit("chamfer-asym__box-clockwise-top-front-3x2", body)
    finish("chamfer-asym__box-clockwise-top-front-3x2")
except Exception:
    fail("chamfer-asym__box-clockwise-top-front-3x2", traceback.format_exc())
