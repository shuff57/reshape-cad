# boolean__cut-torus: cut a ring groove (torus) from the top face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Torus', at=(15,10,10), Radius1=10, Radius2=3)
    boolean_x(body, b2, 'Cut')
    emit("boolean__cut-torus", body)
    finish("boolean__cut-torus")
except Exception:
    fail("boolean__cut-torus", traceback.format_exc())
