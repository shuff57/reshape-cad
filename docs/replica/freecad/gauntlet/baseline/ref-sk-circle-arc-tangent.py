import FreeCAD, Part, Sketcher, json, math
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
sk.AttachmentSupport=(body.Origin.OriginFeatures[3],[""])
sk.MapMode="FlatFace"
# 0 bottom line, 1 right arc, 2 top line, 3 left arc
sk.addGeometry(Part.LineSegment(V(0,0,0),V(40,0,0)),False)
sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(40,10,0),V(0,0,1),10),-math.pi/2,math.pi/2),False)
sk.addGeometry(Part.LineSegment(V(40,20,0),V(0,20,0)),False)
sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(0,10,0),V(0,0,1),10),math.pi/2,3*math.pi/2),False)
C=Sketcher.Constraint
sk.addConstraint(C("Tangent",0,2,1,1))
sk.addConstraint(C("Tangent",1,2,2,1))
sk.addConstraint(C("Tangent",2,2,3,1))
sk.addConstraint(C("Tangent",3,2,0,1))
sk.addConstraint(C("Horizontal",0))
sk.addConstraint(C("Radius",1,10))
sk.addConstraint(C("Equal",1,3))
sk.addConstraint(C("DistanceX",0,1,0,2,40))
sk.addConstraint(C("Coincident",0,1,-1,1))
r=sk.solve()
doc.recompute()
out={"solve":r}
for n in ["ConflictingConstraints","RedundantConstraints","MalformedConstraints","PartiallyRedundantConstraints"]:
    out[n]=list(getattr(sk,n)) if hasattr(sk,n) else "n/a"
out["state"]=list(sk.State)
out["ncons"]=sk.ConstraintCount
bb=sk.Shape.BoundBox
out["bbox"]=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax]
out["edges"]=len(sk.Shape.Edges)
out["wires_closed"]=[w.isClosed() for w in sk.Shape.Wires]
out["geo"]=[str(sk.Geometry[i].StartPoint)+"->"+str(sk.Geometry[i].EndPoint) for i in range(4)]
print("REFSK "+json.dumps(out))
# pad for area/volume check
pad=body.newObject("PartDesign::Pad","Pad"); pad.Profile=sk; pad.Length=5; doc.recompute()
print("REFSK_PAD "+json.dumps({"vol":pad.Shape.Volume,"expected":(800+math.pi*100)*5,"state":list(pad.State)}))
