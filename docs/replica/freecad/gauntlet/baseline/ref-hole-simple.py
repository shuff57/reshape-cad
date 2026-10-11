import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("hs")
body = doc.addObject("PartDesign::Body","Body")
sk = body.newObject("Sketcher::SketchObject","Sketch")
sk.AttachmentSupport=[(body.Origin.OriginFeatures[3],"")]
sk.MapMode="FlatFace"
pts=[V(0,0,0),V(40,0,0),V(40,30,0),V(0,30,0)]
for i in range(4):
    sk.addGeometry(Part.LineSegment(pts[i],pts[(i+1)%4]))
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
sk.addConstraint(Sketcher.Constraint("Horizontal",0)); sk.addConstraint(Sketcher.Constraint("Horizontal",2))
sk.addConstraint(Sketcher.Constraint("Vertical",1)); sk.addConstraint(Sketcher.Constraint("Vertical",3))
sk.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
doc.recompute()
pad = body.newObject("PartDesign::Pad","Pad"); pad.Profile=sk; pad.Length=10
doc.recompute()
# hole sketch on top face
top=[ (i,f) for i,f in enumerate(pad.Shape.Faces) if abs(f.CenterOfMass.z-10)<1e-6][0]
hs = body.newObject("Sketcher::SketchObject","HoleSketch")
hs.AttachmentSupport=[(pad,"Face%d"%(top[0]+1))]; hs.MapMode="FlatFace"
hs.addGeometry(Part.Circle(V(20,15,0),V(0,0,1),3))
doc.recompute()
hole = body.newObject("PartDesign::Hole","Hole")
hole.Profile=hs
hole.Diameter=6
hole.DepthType="ThroughAll"
hole.Threaded=False
hole.HoleCutType="None"
doc.recompute()
s=body.Shape
bb=s.BoundBox
res=dict(id="hole-simple",volume=s.Volume,bbox=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],faces=len(s.Faces),
 state=[list(o.State) for o in (sk,pad,hs,hole)],valid=s.isValid(),
 expected_volume=40*30*10-3.14159265358979*9*10)
print("REF "+json.dumps(res))
json.dump(res,open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-hole-simple.json","w"),indent=1)
