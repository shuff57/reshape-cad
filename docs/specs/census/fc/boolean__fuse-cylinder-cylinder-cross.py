# boolean__fuse-cylinder-cylinder-cross: two 10 across cylinders crossing at right angles (a cross-shaped fuse)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    circle(s, 0, 0, 5)
    pad_x(body, s, 40, Midplane=True)
    b2 = new_body(doc, 'Body2')
    c = prim(b2, 'Cylinder', at=(0,0,0), Radius=5, Height=40)
    c.Placement = App.Placement(V(0,-20,0), App.Rotation(V(1,0,0), -90))
    doc.recompute()
    boolean_x(body, b2, 'Fuse')
    emit("boolean__fuse-cylinder-cylinder-cross", body)
    finish("boolean__fuse-cylinder-cylinder-cross")
except Exception:
    fail("boolean__fuse-cylinder-cylinder-cross", traceback.format_exc())
