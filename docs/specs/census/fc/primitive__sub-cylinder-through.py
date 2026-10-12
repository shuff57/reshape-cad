# primitive__sub-cylinder-through: a subtractive 8 across cylinder through the block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Cylinder', at=(15,10,-2), subtractive=True, Radius=4, Height=14)
    emit("primitive__sub-cylinder-through", body)
    finish("primitive__sub-cylinder-through")
except Exception:
    fail("primitive__sub-cylinder-through", traceback.format_exc())
