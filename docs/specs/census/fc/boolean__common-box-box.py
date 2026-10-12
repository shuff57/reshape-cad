# boolean__common-box-box: common of two overlapping boxes
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    b2 = new_body(doc, 'Body2')
    prim(b2, 'Box', at=(23,10,0), Length=10, Width=10, Height=10)
    boolean_x(body, b2, 'Common')
    emit("boolean__common-box-box", body)
    finish("boolean__common-box-box")
except Exception:
    fail("boolean__common-box-box", traceback.format_exc())
