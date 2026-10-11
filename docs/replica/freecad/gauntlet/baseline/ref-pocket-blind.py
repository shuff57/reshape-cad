import FreeCAD as App, Part, Sketcher, json, os
doc = App.newDocument("pb")
body = doc.addObject("PartDesign::Body", "Body")
xy = body.Origin.OriginFeatures[3]
def rect(sk, x0,y0,x1,y1):
    p=[App.Vector(x0,y0,0),App.Vector(x1,y0,0),App.Vector(x1,y1,0),App.Vector(x0,y1,0)]
    for i in range(4):
        sk.addGeometry(Part.LineSegment(p[i],p[(i+1)%4]))
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
    sk.addConstraint(Sketcher.Constraint("Horizontal",0)); sk.addConstraint(Sketcher.Constraint("Horizontal",2))
    sk.addConstraint(Sketcher.Constraint("Vertical",1)); sk.addConstraint(Sketcher.Constraint("Vertical",3))
s1 = body.newObject("Sketcher::SketchObject","Sketch")
s1.AttachmentSupport=[(xy,"")]; s1.MapMode="FlatFace"
rect(s1,0,0,40,30)
s1.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
s1.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
s1.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
doc.recompute()
pad = body.newObject("PartDesign::Pad","Pad"); pad.Profile=s1; pad.Length=10
doc.recompute()
s2 = body.newObject("Sketcher::SketchObject","Sketch001")
s2.AttachmentSupport=[(xy,"")]; s2.MapMode="FlatFace"
s2.AttachmentOffset=App.Placement(App.Vector(0,0,10),App.Rotation())
rect(s2,15,10,25,20)
s2.addConstraint(Sketcher.Constraint("DistanceX",-1,1,0,1,15))
s2.addConstraint(Sketcher.Constraint("DistanceY",-1,1,0,1,10))
s2.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,10))
s2.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,10))
doc.recompute()
pk = body.newObject("PartDesign::Pocket","Pocket"); pk.Profile=s2; pk.Type=0; pk.Length=4
doc.recompute()
sh=body.Shape; bb=sh.BoundBox
out=dict(volume=sh.Volume,bbox=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],faces=len(sh.Faces),
 states={o.Name:list(o.State) for o in doc.Objects}, valid=sh.isValid(),
 sketch2_solve=s2.solve())
print("REFPB", json.dumps(out))
# step export
Part.export([body],"/tmp/ref-pb.step")
import Part as P
r=P.read("/tmp/ref-pb.step"); print("REFPB-STEP", r.Volume, len(r.Faces))
