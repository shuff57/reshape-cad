# primitive__add-prism: an additive hexagonal prism, 12 across corners, 8 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Prism', at=(15,10,10), Polygon=6, Circumradius=6, Height=8)
    emit("primitive__add-prism", body)
    finish("primitive__add-prism")
except Exception:
    fail("primitive__add-prism", traceback.format_exc())
