# sk-circle-arc-tangent__slot-r6-L30-floating: the same slot without the pin: free to slide
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(30,0,0)),False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(30,6,0),V(0,0,1),6),-1.570796327,1.570796327),False)
    sk.addGeometry(Part.LineSegment(V(30,12,0),V(0,12,0)),False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(0,6,0),V(0,0,1),6),1.570796327,4.71238898),False)
    sk.addConstraint(Sketcher.Constraint('Tangent', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 2, 2, 3, 1))
    sk.addConstraint(Sketcher.Constraint('Tangent', 3, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Radius', 1, 6))
    sk.addConstraint(Sketcher.Constraint('Equal', 1, 3))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 30))
    sk_emit("sk-circle-arc-tangent__slot-r6-L30-floating", sk)
    finish("sk-circle-arc-tangent__slot-r6-L30-floating")
except Exception:
    fail("sk-circle-arc-tangent__slot-r6-L30-floating", traceback.format_exc())
