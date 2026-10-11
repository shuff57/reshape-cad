import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
xy = body.Origin.OriginFeatures[3]
s1 = body.newObject("Sketcher::SketchObject","Sketch")
s1.AttachmentSupport=(xy,[""]); s1.MapMode="FlatFace"
pts=[(0,0),(40,0),(40,30),(0,30)]
for i in range(4):
    a=pts[i];b=pts[(i+1)%4]
    s1.addGeometry(Part.LineSegment(V(a[0],a[1],0),V(b[0],b[1],0)),False)
for i in range(4):
    s1.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
s1.addConstraint(Sketcher.Constraint("Horizontal",0))
s1.addConstraint(Sketcher.Constraint("Horizontal",2))
s1.addConstraint(Sketcher.Constraint("Vertical",1))
s1.addConstraint(Sketcher.Constraint("Vertical",3))
s1.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
s1.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
s1.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
pad = body.newObject("PartDesign::Pad","Pad")
pad.Profile=s1; pad.Length=10
doc.recompute()
# sketch on top face (Z=10)
top=[f for f in pad.Shape.Faces if abs(f.CenterOfMass.z-10)<1e-6 and abs(f.normalAt(0,0).z-1)<1e-6][0]
fi=[i for i,f in enumerate(pad.Shape.Faces,1) if f.isSame(top)][0]
s2 = body.newObject("Sketcher::SketchObject","Sketch001")
s2.AttachmentSupport=(pad,["Face%d"%fi]); s2.MapMode="FlatFace"
doc.recompute()
s2.addGeometry(Part.Circle(V(10,15,0),V(0,0,1),3),False)
s2.addConstraint(Sketcher.Constraint("Radius",0,3))
s2.addConstraint(Sketcher.Constraint("DistanceX",-1,1,0,3,10))
s2.addConstraint(Sketcher.Constraint("DistanceY",-1,1,0,3,15))
pk = body.newObject("PartDesign::Pocket","Pocket")
pk.Profile=s2; pk.Type=1
doc.recompute()
yz=body.Origin.OriginFeatures[5]
print("REFMIR yzname",yz.Name,yz.Label)
dp=body.newObject("PartDesign::Plane","DatumPlane")
dp.AttachmentSupport=[(yz,"")]; dp.MapMode="FlatFace"
dp.AttachmentOffset=FreeCAD.Placement(V(0,0,20),FreeCAD.Rotation())
doc.recompute()
print("REFMIR datum",dp.Placement)
mir=body.newObject("PartDesign::Mirrored","Mirrored")
mir.Originals=[pk]
mir.MirrorPlane=(dp,[""])
body.Tip=mir
doc.recompute()
sh=body.Shape; bb=sh.BoundBox
out={"volume":sh.Volume,"bbox":[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],"faces":len(sh.Faces),
"states":{o.Name:list(o.State) for o in [s1,pad,s2,pk,dp,mir,body]},"valid":sh.isValid(),"nsolids":len(sh.Solids),
"datum_placement":str(dp.Placement),"expected_volume":40*30*10-2*10*3.141592653589793*9}
print("REFMIR "+json.dumps(out))
json.dump(out,open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-mirrored.json","w"),indent=1)
