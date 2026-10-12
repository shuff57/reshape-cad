# primitive__add-torus: an additive torus (ring 10, tube 3) lying across the top face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Torus', at=(15,10,10), Radius1=10, Radius2=3)
    emit("primitive__add-torus", body)
    finish("primitive__add-torus")
except Exception:
    fail("primitive__add-torus", traceback.format_exc())
