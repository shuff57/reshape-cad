# boolean__cut-cylinder-off-axis-edge: cut a 12 across cylinder biting a side face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Cylinder', at=(28,10,-2), Radius=6, Height=14)
    boolean_x(body, b2, 'Cut')
    emit("boolean__cut-cylinder-off-axis-edge", body)
    finish("boolean__cut-cylinder-off-axis-edge")
except Exception:
    fail("boolean__cut-cylinder-off-axis-edge", traceback.format_exc())
