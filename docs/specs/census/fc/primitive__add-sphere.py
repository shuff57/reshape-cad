# primitive__add-sphere: an additive 14 across sphere half sunk in the top
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Sphere', at=(15,10,10), Radius=7)
    emit("primitive__add-sphere", body)
    finish("primitive__add-sphere")
except Exception:
    fail("primitive__add-sphere", traceback.format_exc())
