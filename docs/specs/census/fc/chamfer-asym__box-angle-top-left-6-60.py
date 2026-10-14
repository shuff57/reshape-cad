# chamfer-asym__box-angle-top-left-6-60: box, top/left edge, 6 at 60 degrees (10.392305 on the top)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [0,20,10], [0,0,10])], 6, ChamferType='Distance and Angle', Angle=60)
    emit("chamfer-asym__box-angle-top-left-6-60", body)
    finish("chamfer-asym__box-angle-top-left-6-60")
except Exception:
    fail("chamfer-asym__box-angle-top-left-6-60", traceback.format_exc())
