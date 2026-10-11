import FreeCAD as App, Part, Sketcher, json
doc=App.newDocument("t")
body=doc.addObject("PartDesign::Body","Body")
sk=body.newObject("Sketcher::SketchObject","Sketch")
xy=[o for o in body.Origin.OriginFeatures if o.Role=="XY_Plane"][0]
sk.AttachmentSupport=(xy,[""])
sk.MapMode="FlatFace"
P=App.Vector
pts=[P(0,0,0),P(40,0,0),P(40,30,0),P(0,30,0)]
for i in range(4):
    sk.addGeometry(Part.LineSegment(pts[i],pts[(i+1)%4]))
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
sk.addConstraint(Sketcher.Constraint("Horizontal",0));sk.addConstraint(Sketcher.Constraint("Horizontal",2))
sk.addConstraint(Sketcher.Constraint("Vertical",1));sk.addConstraint(Sketcher.Constraint("Vertical",3))
sk.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
doc.recompute()
pad=body.newObject("PartDesign::Pad","Pad");pad.Profile=sk;pad.Length=10
doc.recompute()
s=pad.Shape
edge=None
for i,e in enumerate(s.Edges):
    b=e.BoundBox
    if abs(b.XMin-40)<1e-6 and abs(b.XMax-40)<1e-6 and abs(b.ZMin-10)<1e-6 and abs(b.ZMax-10)<1e-6:
        edge=i+1
print("REF edge",edge)
ch=body.newObject("PartDesign::Chamfer","Chamfer")
ch.Base=(pad,["Edge%d"%edge]);ch.Size=2
doc.recompute()
sh=body.Shape;b=sh.BoundBox
r=dict(id="chamfer-edge",volume=sh.Volume,bbox=[b.XMin,b.YMin,b.ZMin,b.XMax,b.YMax,b.ZMax],faces=len(sh.Faces),state=list(ch.State),bodystate=list(body.State),valid=sh.isValid(),edge=edge)
print("REF",json.dumps(r))
json.dump(r,open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-chamfer-edge.json","w"))
