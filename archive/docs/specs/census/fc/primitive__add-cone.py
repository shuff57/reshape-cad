# primitive__add-cone: an additive cone, base 12 across, 14 tall, on the block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Cone', at=(15,10,10), Radius1=6, Radius2=0, Height=14)
    emit("primitive__add-cone", body)
    finish("primitive__add-cone")
except Exception:
    fail("primitive__add-cone", traceback.format_exc())
