# loft__rect-to-circle: a 20 x 20 square lofted to a 12 across circle, 15 above (ruled)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    a = sketch(body, 'top', 0)
    rect(a, -10, -10, 10, 10)
    b = sketch(body, 'top', 15)
    circle(b, 0, 0, 6)
    l = body.newObject('PartDesign::AdditiveLoft', 'Loft')
    l.Profile = a
    l.Sections = [b]
    l.Ruled = True
    doc.recompute()
    emit("loft__rect-to-circle", body)
    finish("loft__rect-to-circle")
except Exception:
    fail("loft__rect-to-circle", traceback.format_exc())
