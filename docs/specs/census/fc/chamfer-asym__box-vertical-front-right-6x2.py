# chamfer-asym__box-vertical-front-right-6x2: box, vertical front/right edge, 6 on the front and 2 on the right
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    chamfer_x(body, base, [edge_between(base.Shape, [30,0,0], [30,0,10])], 6, ChamferType='Two distances', Size2=2)
    emit("chamfer-asym__box-vertical-front-right-6x2", body)
    finish("chamfer-asym__box-vertical-front-right-6x2")
except Exception:
    fail("chamfer-asym__box-vertical-front-right-6x2", traceback.format_exc())
