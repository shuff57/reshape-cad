# boolean__cut-cone: cut a cone (apex down, base flush with the top face) from the block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Cone', at=(15,10,10), Radius1=6, Radius2=0, Height=8)
    b2.Tip.Placement = App.Placement(V(15,10,10), App.Rotation(V(1,0,0), 180))
    doc.recompute()
    boolean_x(body, b2, 'Cut')
    emit("boolean__cut-cone", body)
    finish("boolean__cut-cone")
except Exception:
    fail("boolean__cut-cone", traceback.format_exc())
