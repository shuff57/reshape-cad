# primitive__add-wedge: an additive wedge (right triangle 10 x 8, 6 thick) on the block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Wedge', at=(15,6,10), Xmin=0, Xmax=10, Ymin=0, Ymax=8, Zmin=0, Zmax=6, X2min=0, X2max=0, Z2min=0, Z2max=6)
    emit("primitive__add-wedge", body)
    finish("primitive__add-wedge")
except Exception:
    fail("primitive__add-wedge", traceback.format_exc())
