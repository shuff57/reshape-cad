# boolean__fuse-cylinder-standing: fuse a 12 across cylinder standing on the face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Cylinder', at=(15,10,10), Radius=6, Height=15)
    boolean_x(body, b2, 'Fuse')
    emit("boolean__fuse-cylinder-standing", body)
    finish("boolean__fuse-cylinder-standing")
except Exception:
    fail("boolean__fuse-cylinder-standing", traceback.format_exc())
