import FreeCAD, Part, Sketcher, json
from FreeCAD import Vector as V
doc = FreeCAD.newDocument("rev")
body = doc.addObject("PartDesign::Body","Body")
xz = [o for o in body.Origin.OriginFeatures if o.Role=="XZ_Plane"][0]
sk = body.newObject("Sketcher::SketchObject","Sketch")
sk.AttachmentSupport=[(xz,"")]
sk.MapMode="FlatFace"
doc.recompute()
# sketch coords: sketch x -> global X, sketch y -> global Z for XZ plane (verify via placement)
pts=[V(10,0,0),V(20,0,0),V(20,30,0),V(10,30,0)]
for i in range(4):
    sk.addGeometry(Part.LineSegment(pts[i],pts[(i+1)%4]))
for i in range(4):
    sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
sk.addConstraint(Sketcher.Constraint("Horizontal",0))
sk.addConstraint(Sketcher.Constraint("Horizontal",2))
sk.addConstraint(Sketcher.Constraint("Vertical",1))
sk.addConstraint(Sketcher.Constraint("Vertical",3))
sk.addConstraint(Sketcher.Constraint("DistanceX",-1,1,0,1,10))
sk.addConstraint(Sketcher.Constraint("DistanceY",-1,1,0,1,0))
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,10))
sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,30))
doc.recompute()
dof = sk.solve()
rev = body.newObject("PartDesign::Revolution","Revolution")
rev.Profile=sk
rev.ReferenceAxis=(sk,["V_Axis"])
rev.Angle=360
doc.recompute()
s=body.Shape
bb=s.BoundBox
sp=sk.Placement
res=dict(piece="revolution",
 volume=s.Volume,
 bbox=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],
 faces=len(s.Faces),
 sketch_solve=dof,
 sketch_dof_attr=getattr(sk,"DoF",None) if hasattr(sk,"DoF") else None,
 conflicting=list(getattr(sk,"ConflictingConstraints",[])) if hasattr(sk,"ConflictingConstraints") else "n/a",
 redundant=list(getattr(sk,"RedundantConstraints",[])) if hasattr(sk,"RedundantConstraints") else "n/a",
 malformed=list(getattr(sk,"MalformedConstraints",[])) if hasattr(sk,"MalformedConstraints") else "n/a",
 states=dict(sketch=sk.State,rev=rev.State,body=body.State),
 valid=s.isValid(), solids=len(s.Solids),
 sketch_placement=str(sp), expected_volume=3.141592653589793*(400-100)*30)
print("REFOUT "+json.dumps(res))
json.dump(res,open("ref-revolution.json","w"),indent=1)
