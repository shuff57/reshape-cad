# boolean__cut-sphere-top: cut a 14 across sphere centred in the top face (a dish)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Sphere', at=(15,10,10), Radius=7)
    boolean_x(body, b2, 'Cut')
    emit("boolean__cut-sphere-top", body)
    finish("boolean__cut-sphere-top")
except Exception:
    fail("boolean__cut-sphere-top", traceback.format_exc())
