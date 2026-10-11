import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
sk.AttachmentSupport=[(body.Origin.OriginFeatures[3],"")]
sk.MapMode="FlatFace"
pts=[(0,0),(40,0),(40,30),(0,30)]
for i in range(4):
    a=pts[i];b=pts[(i+1)%4]
    sk.addGeometry(Part.LineSegment(V(a[0],a[1],0),V(b[0],b[1],0)),False)
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
sk.addConstraint(Sketcher.Constraint("Horizontal",0))
sk.addConstraint(Sketcher.Constraint("Horizontal",2))
sk.addConstraint(Sketcher.Constraint("Vertical",1))
sk.addConstraint(Sketcher.Constraint("Vertical",3))
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
sk.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
r=sk.solve()
doc.recompute()
out={"solve":r}
for n in ["ConflictingConstraints","RedundantConstraints","MalformedConstraints","PartiallyRedundantConstraints"]:
    out[n]=list(getattr(sk,n,[]) ) if hasattr(sk,n) else "n/a"
for n in ["DoF","DegreesOfFreedom"]:
    out[n]=getattr(sk,n,"n/a") if hasattr(sk,n) else "n/a"
out["state"]=list(sk.State)
out["ncons"]=sk.ConstraintCount
bb=sk.Shape.BoundBox
out["bbox"]=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax]
out["edges"]=len(sk.Shape.Edges)
out["wires_closed"]=[w.isClosed() for w in sk.Shape.Wires]
print("REFSK "+json.dumps(out))
