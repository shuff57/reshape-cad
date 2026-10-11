import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
xy=[o for o in body.Origin.OriginFeatures if o.Role=="XY_Plane"][0]
sk.AttachmentSupport = [(xy,"")]
sk.MapMode = "FlatFace"
pts=[V(0,0,0),V(40,0,0),V(40,30,0),V(0,30,0)]
for i in range(4):
    sk.addGeometry(Part.LineSegment(pts[i],pts[(i+1)%4]),False)
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
sk.addConstraint(Sketcher.Constraint("Horizontal",0))
sk.addConstraint(Sketcher.Constraint("Horizontal",2))
sk.addConstraint(Sketcher.Constraint("Vertical",1))
sk.addConstraint(Sketcher.Constraint("Vertical",3))
sk.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
doc.recompute()
solve = sk.solve()
pad = body.newObject("PartDesign::Pad","Pad")
pad.Profile = sk
pad.Length = 10
pad.Type = 0
doc.recompute()
s = body.Shape
bb = s.BoundBox
r = dict(volume=s.Volume, bbox=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax], faces=len(s.Faces),
 sketchSolve=solve, conflicts=list(getattr(sk,"ConflictingConstraints",[])) if hasattr(sk,"ConflictingConstraints") else None,
 redundant=list(getattr(sk,"RedundantConstraints",[])) if hasattr(sk,"RedundantConstraints") else None,
 padState=list(pad.State), bodyState=list(body.State), sketchState=list(sk.State), valid=s.isValid())
print("REFRES "+json.dumps(r))
