# loft__rect-to-rect-ruled: a 30 x 20 rectangle lofted to a 16 x 10 one 12 above (ruled)
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
    l.Ruled = True
    doc.recompute()
    emit("loft__rect-to-rect-ruled", body)
    finish("loft__rect-to-rect-ruled")
except Exception:
    fail("loft__rect-to-rect-ruled", traceback.format_exc())
