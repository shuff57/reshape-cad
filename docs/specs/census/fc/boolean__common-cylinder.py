# boolean__common-cylinder: common of the block and a 20 across cylinder
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Cylinder', at=(15,10,-2), Radius=10, Height=14)
    boolean_x(body, b2, 'Common')
    emit("boolean__common-cylinder", body)
    finish("boolean__common-cylinder")
except Exception:
    fail("boolean__common-cylinder", traceback.format_exc())
