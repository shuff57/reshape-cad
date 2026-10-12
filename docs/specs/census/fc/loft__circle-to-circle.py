# loft__circle-to-circle: a 20 across circle lofted to a 10 across one 15 above (a frustum)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    a = sketch(body, 'top', 0)
    circle(a, 0, 0, 10)
    b = sketch(body, 'top', 15)
    circle(b, 0, 0, 5)
    l = body.newObject('PartDesign::AdditiveLoft', 'Loft')
    l.Profile = a
    l.Sections = [b]
    l.Ruled = True
    doc.recompute()
    emit("loft__circle-to-circle", body)
    finish("loft__circle-to-circle")
except Exception:
    fail("loft__circle-to-circle", traceback.format_exc())
