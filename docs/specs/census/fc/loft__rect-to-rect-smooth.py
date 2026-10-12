# loft__rect-to-rect-smooth: the same loft, not ruled (FreeCAD smooths between sections; two sections are identical)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    a = sketch(body, 'top', 0)
    rect(a, 0, 0, 30, 20)
    b = sketch(body, 'top', 12)
    rect(b, 7, 5, 23, 15)
    l = body.newObject('PartDesign::AdditiveLoft', 'Loft')
    l.Profile = a
    l.Sections = [b]
    l.Ruled = False
    doc.recompute()
    emit("loft__rect-to-rect-smooth", body)
    finish("loft__rect-to-rect-smooth")
except Exception:
    fail("loft__rect-to-rect-smooth", traceback.format_exc())
