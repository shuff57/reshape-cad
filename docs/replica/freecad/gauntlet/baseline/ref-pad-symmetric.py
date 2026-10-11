import FreeCAD as App, Part, Sketcher, json
doc = App.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
sk.AttachmentSupport = (doc.getObject("XY_Plane"), [""])
sk.MapMode = "FlatFace"
V=App.Vector
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
pad = body.newObject("PartDesign::Pad","Pad")
pad.Profile = sk
pad.Length = 10
pad.SideType = "Symmetric"
doc.recompute()
s=body.Shape; b=s.BoundBox
r=dict(volume=s.Volume,bbox=[b.XMin,b.YMin,b.ZMin,b.XMax,b.YMax,b.ZMax],faces=len(s.Faces),
 sketchSolve=sk.solve(),padState=list(pad.State),bodyState=list(body.State),isValid=s.isValid())
print("REFOUT "+json.dumps(r))
