# boolean__common-sphere: common of the block and a 24 across sphere
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Sphere', at=(15,10,5), Radius=12)
    boolean_x(body, b2, 'Common')
    emit("boolean__common-sphere", body)
    finish("boolean__common-sphere")
except Exception:
    fail("boolean__common-sphere", traceback.format_exc())
