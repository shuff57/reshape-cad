# sk-rect-dof__circle-pinned: a circle of radius 7 with its centre pinned at (4,-6)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    sk.addGeometry(Part.Circle(V(4,-6,0),V(0,0,1),7),False)
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 3, 4))
    sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, 0, 3, -6))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 7))
    sk_emit("sk-rect-dof__circle-pinned", sk)
    finish("sk-rect-dof__circle-pinned")
except Exception:
    fail("sk-rect-dof__circle-pinned", traceback.format_exc())
