# sk-circle-arc-tangent__slot-r12-L18-anchored: a fat short slot: r12, 18 between the cap centres lines
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(18,0,0)),False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(18,12,0),V(0,0,1),12),-1.570796327,1.570796327),False)
    sk.addGeometry(Part.LineSegment(V(18,24,0),V(0,24,0)),False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(0,12,0),V(0,0,1),12),1.570796327,4.71238898),False)
    sk.addConstraint(Sketcher.Constraint('Tangent', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 2, 2, 3, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 3, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Radius', 1, 12))
    sk.addConstraint(Sketcher.Constraint('Equal', 1, 3))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 18))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -1, 1))
    sk_emit("sk-circle-arc-tangent__slot-r12-L18-anchored", sk)
    finish("sk-circle-arc-tangent__slot-r12-L18-anchored")
except Exception:
    fail("sk-circle-arc-tangent__slot-r12-L18-anchored", traceback.format_exc())
