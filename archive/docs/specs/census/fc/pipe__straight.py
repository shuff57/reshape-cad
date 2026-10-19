# pipe__straight: a 10 across circle swept along a 30 mm straight path
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    prof = sketch(body, 'top', 0)
    circle(prof, 0, 0, 5)
    path = sketch(body, 'front', 0)
    path.addGeometry(Part.LineSegment(V(0,0,0), V(0,30,0)), False)
    doc.recompute()
    p = body.newObject('PartDesign::AdditivePipe', 'Pipe')
    p.Profile = prof
    p.Spine = (path, ['Edge1'])
    doc.recompute()
    emit("pipe__straight", body)
    finish("pipe__straight")
except Exception:
    fail("pipe__straight", traceback.format_exc())
