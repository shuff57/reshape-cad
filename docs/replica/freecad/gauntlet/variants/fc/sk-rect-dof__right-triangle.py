# sk-rect-dof__right-triangle: right triangle 30 x 20 from three joined lines, corner on the origin
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.LineSegment(V(0,0,0),V(30,0,0)),False)
    sk.addGeometry(Part.LineSegment(V(30,0,0),V(0,20,0)),False)
    sk.addGeometry(Part.LineSegment(V(0,20,0),V(0,0,0)),False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 2, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Vertical', 2))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -1, 1))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 30))
    sk.addConstraint(Sketcher.Constraint('Distance', 2, 20))
    sk_emit("sk-rect-dof__right-triangle", sk)
    finish("sk-rect-dof__right-triangle")
except Exception:
    fail("sk-rect-dof__right-triangle", traceback.format_exc())
