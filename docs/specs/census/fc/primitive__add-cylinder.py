# primitive__add-cylinder: an additive 12 across, 15 tall cylinder standing on the block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Cylinder', at=(15,10,10), Radius=6, Height=15)
    emit("primitive__add-cylinder", body)
    finish("primitive__add-cylinder")
except Exception:
    fail("primitive__add-cylinder", traceback.format_exc())
