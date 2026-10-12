# dress-mode__chamfer-two-distances: chamfer 3 x 2 on the top/front edge
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Two distances', Size2=2)
    emit("dress-mode__chamfer-two-distances", body)
    finish("dress-mode__chamfer-two-distances")
except Exception:
    fail("dress-mode__chamfer-two-distances", traceback.format_exc())
