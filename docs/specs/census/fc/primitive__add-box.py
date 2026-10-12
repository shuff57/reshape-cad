# primitive__add-box: an additive 10 x 10 x 10 box overlapping a 30 x 20 x 10 block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Box', at=(25,5,5), Length=10, Width=10, Height=10)
    emit("primitive__add-box", body)
    finish("primitive__add-box")
except Exception:
    fail("primitive__add-box", traceback.format_exc())
