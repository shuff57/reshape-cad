# primitive__add-ellipsoid: an additive ellipsoid
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Ellipsoid', at=(15,10,10), Radius1=5, Radius2=8)
    emit("primitive__add-ellipsoid", body)
    finish("primitive__add-ellipsoid")
except Exception:
    fail("primitive__add-ellipsoid", traceback.format_exc())
