import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("t")
body = doc.addObject("PartDesign::Body","Body")
xy = body.Origin.OriginFeatures[3]
zax = body.Origin.OriginFeatures[2]
s1 = body.newObject("Sketcher::SketchObject","Sketch")
s1.AttachmentSupport=(xy,[""]); s1.MapMode="FlatFace"
s1.addGeometry(Part.Circle(V(0,0,0),V(0,0,1),30),False)
s1.addConstraint(Sketcher.Constraint("Radius",0,30))
s1.addConstraint(Sketcher.Constraint("Coincident",0,3,-1,1))
pad = body.newObject("PartDesign::Pad","Pad"); pad.Profile=s1; pad.Length=10
doc.recompute()
top=[f for f in pad.Shape.Faces if abs(f.CenterOfMass.z-10)<1e-6 and abs(f.normalAt(0,0).z-1)<1e-6][0]
fi=[i for i,f in enumerate(pad.Shape.Faces,1) if f.isSame(top)][0]
s2 = body.newObject("Sketcher::SketchObject","Sketch001")
s2.AttachmentSupport=(pad,["Face%d"%fi]); s2.MapMode="FlatFace"
doc.recompute()
s2.addGeometry(Part.Circle(V(20,0,0),V(0,0,1),3),False)
s2.addConstraint(Sketcher.Constraint("Radius",0,3))
s2.addConstraint(Sketcher.Constraint("DistanceX",-1,1,0,3,20))
s2.addConstraint(Sketcher.Constraint("DistanceY",-1,1,0,3,0))
pk = body.newObject("PartDesign::Pocket","Pocket"); pk.Profile=s2; pk.Type=1
doc.recompute()
vol1=body.Shape.Volume; f1=len(body.Shape.Faces)
pp = body.newObject("PartDesign::PolarPattern","PolarPattern")
pp.Originals=[pk]; pp.Axis=(zax,[""]); pp.Angle=360; pp.Occurrences=4
body.Tip=pp
doc.recompute()
sh=body.Shape; bb=sh.BoundBox
out={"volume":sh.Volume,"bbox":[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],"faces":len(sh.Faces),
"states":{o.Name:list(o.State) for o in [s1,pad,s2,pk,pp,body]},"valid":sh.isValid(),"nsolids":len(sh.Solids),
"after_single_pocket":{"volume":vol1,"faces":f1},
"expected_volume_if_4_holes":3.141592653589793*900*10-4*3.141592653589793*9*10}
print("REFPP "+json.dumps(out))
json.dump(out,open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-polar-pattern.json","w"),indent=1)
