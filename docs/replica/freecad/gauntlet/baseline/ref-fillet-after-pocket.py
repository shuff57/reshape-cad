import FreeCAD as App, Part, Sketcher, json, os
doc = App.newDocument("fap")
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

vol0=body.Shape.Volume; f0=len(body.Shape.Faces)
pk_state=list(pk.State)
ens=[]
for i,e in enumerate(pk.Shape.Edges,1):
    ps=[v.Point for v in e.Vertexes]
    if all(abs(p.z-10)<1e-6 for p in ps) and all(14.99<p.x<25.01 and 9.99<p.y<20.01 for p in ps): ens.append(i)
fil=body.newObject("PartDesign::Fillet","Fillet"); fil.Base=(pk,["Edge%d"%e for e in ens]); fil.Radius=1
doc.recompute()
s=body.Shape; b=s.BoundBox
r=dict(id="fillet-after-pocket",ok=s.isValid() and all(list(o.State)==["Up-to-date"] for o in doc.Objects),script="/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-fillet-after-pocket.py",
 edges=ens,pocketVolume=vol0,pocketFaces=f0,volume=s.Volume,bbox=[b.XMin,b.YMin,b.ZMin,b.XMax,b.YMax,b.ZMax],faces=len(s.Faces),valid=s.isValid(),
 states={o.Name:list(o.State) for o in doc.Objects})
Part.export([body],"/tmp/ref-fap.step")
rd=Part.read("/tmp/ref-fap.step"); r["stepVolume"]=rd.Volume; r["stepFaces"]=len(rd.Faces)
print("REFFAP "+json.dumps(r))
open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-fillet-after-pocket.json","w").write(json.dumps(r,indent=1))
