# dress-mode__chamfer-distance-angle: chamfer 3 at 30 degrees on the top/front edge
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Distance and Angle', Angle=30)
    emit("dress-mode__chamfer-distance-angle", body)
    finish("dress-mode__chamfer-distance-angle")
except Exception:
    fail("dress-mode__chamfer-distance-angle", traceback.format_exc())
