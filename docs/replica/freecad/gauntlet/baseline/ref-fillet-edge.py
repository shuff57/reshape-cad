import FreeCAD as App, Part, Sketcher, json
doc = App.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
xy=[o for o in body.Origin.OriginFeatures if o.Role=="XY_Plane"][0]
sk.AttachmentSupport=[(xy,"")]
sk.MapMode="FlatFace"
V=App.Vector
pts=[V(0,0,0),V(40,0,0),V(40,30,0),V(0,30,0)]
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
dof=sk.solve()
pad=body.newObject("PartDesign::Pad","Pad"); pad.Profile=sk; pad.Length=10
doc.recompute()
vol0=body.Shape.Volume; f0=len(body.Shape.Faces)
# vertical edge at (40,30)
en=None
for i,e in enumerate(pad.Shape.Edges,1):
    p0,p1=e.Vertexes[0].Point,e.Vertexes[-1].Point
    if abs(p0.x-40)<1e-6 and abs(p0.y-30)<1e-6 and abs(p1.x-40)<1e-6 and abs(p1.y-30)<1e-6 and abs(p0.z-p1.z)>1: en=i
fil=body.newObject("PartDesign::Fillet","Fillet"); fil.Base=(pad,["Edge%d"%en]); fil.Radius=3
doc.recompute()
s=body.Shape; b=s.BoundBox
r=dict(piece="fillet-edge",edge=en,sketchDoF=dof,padVolume=vol0,padFaces=f0,volume=s.Volume,bbox=[b.XMin,b.YMin,b.ZMin,b.XMax,b.YMax,b.ZMax],faces=len(s.Faces),valid=s.isValid(),states=[o.State for o in (sk,pad,fil,body)])
print("REF "+json.dumps(r))
open("ref-fillet-edge.json","w").write(json.dumps(r,indent=1))
