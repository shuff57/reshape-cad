# boolean__fuse-cone: fuse a cone standing on the top face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Cone', at=(15,10,10), Radius1=6, Radius2=0, Height=14)
    boolean_x(body, b2, 'Fuse')
    emit("boolean__fuse-cone", body)
    finish("boolean__fuse-cone")
except Exception:
    fail("boolean__fuse-cone", traceback.format_exc())
