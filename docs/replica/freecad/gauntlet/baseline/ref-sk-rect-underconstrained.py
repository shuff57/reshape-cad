import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body", "Body")
sk = body.newObject("Sketcher::SketchObject", "Sketch")
sk.AttachmentSupport = (body.Origin.OriginFeatures[3], [""])
sk.MapMode = "FlatFace"
W, H = 40.0, 20.0
pts = [V(0,0,0), V(W,0,0), V(W,H,0), V(0,H,0)]
for i in range(4):
    sk.addGeometry(Part.LineSegment(pts[i], pts[(i+1)%4]), False)
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident", i, 2, (i+1)%4, 1))
sk.addConstraint(Sketcher.Constraint("Horizontal", 0))
sk.addConstraint(Sketcher.Constraint("Horizontal", 2))
sk.addConstraint(Sketcher.Constraint("Vertical", 1))
sk.addConstraint(Sketcher.Constraint("Vertical", 3))
doc.recompute()
st0=list(sk.State)
r = sk.solve()
res = {"id":"sk-rect-underconstrained","solve_return":r,"state_after_recompute":st0,"state_after_solve":list(sk.State),
 "constraints":sk.ConstraintCount,"geometry":sk.GeometryCount}
attrs = {}
for a in ["ConflictingConstraints","RedundantConstraints","MalformedConstraints","PartiallyRedundantConstraints","DoF","DegreesOfFreedom"]:
    if hasattr(sk,a):
        try: attrs[a]=getattr(sk,a)
        except Exception as e: attrs[a]="err "+str(e)
res["attrs"]=attrs
for m in ["getGeometryWithDependentParameters","getLastDoF","getLastConflicting","getLastRedundant","getLastMalformedConstraints","getLastPartiallyRedundant"]:
    if hasattr(sk,m):
        try: res[m]=getattr(sk,m)()
        except Exception as e: res[m]="err "+str(e)
print("REFOUT "+json.dumps(res, default=str))
