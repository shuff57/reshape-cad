# primitive__sub-cone: a subtractive cone (a countersink-like pit), base flush with the top face, apex down
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Cone', at=(15,10,10), subtractive=True, Radius1=6, Radius2=0, Height=8)
    body.Tip.Placement = App.Placement(V(15,10,10), App.Rotation(V(1,0,0), 180))
    doc.recompute()
    emit("primitive__sub-cone", body)
    finish("primitive__sub-cone")
except Exception:
    fail("primitive__sub-cone", traceback.format_exc())
