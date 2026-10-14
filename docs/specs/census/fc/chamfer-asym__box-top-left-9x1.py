# chamfer-asym__box-top-left-9x1: box, top/left edge: the left wall is face 4, the top is face 6, so 9 goes on the left
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [0,20,10], [0,0,10])], 9, ChamferType='Two distances', Size2=1)
    emit("chamfer-asym__box-top-left-9x1", body)
    finish("chamfer-asym__box-top-left-9x1")
except Exception:
    fail("chamfer-asym__box-top-left-9x1", traceback.format_exc())
