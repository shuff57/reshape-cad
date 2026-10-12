import FreeCAD as App, Part, Sketcher, json
from FreeCAD import Vector as V, Placement, Rotation
doc = App.newDocument("g")
body = doc.addObject("PartDesign::Body","Body")
def rect(sk, x0,y0,x1,y1):
    pts=[V(x0,y0,0),V(x1,y0,0),V(x1,y1,0),V(x0,y1,0)]
    for i in range(4):
        sk.addGeometry(Part.LineSegment(pts[i],pts[(i+1)%4]))
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident',i,2,(i+1)%4,1))
xy=[o for o in body.Origin.OriginFeatures if o.Role=='XY_Plane'][0]
xz=[o for o in body.Origin.OriginFeatures if o.Role=='XZ_Plane'][0]
s1=body.newObject("Sketcher::SketchObject","S1")
s1.AttachmentSupport=[(xy,'')]; s1.MapMode='FlatFace'
s1.addGeometry(Part.Circle(V(0,0,0),V(0,0,1),20))
s1.addConstraint(Sketcher.Constraint('Radius',0,20))
s1.addConstraint(Sketcher.Constraint('Coincident',0,3,-1,1))
doc.recompute()
pad=body.newObject("PartDesign::Pad","Pad"); pad.Profile=s1; pad.Length=30
doc.recompute()
s2=body.newObject("Sketcher::SketchObject","S2")
s2.AttachmentSupport=[(xz,'')]; s2.MapMode='FlatFace'
rect(s2,18,10,20,15)
doc.recompute()
g=body.newObject("PartDesign::Groove","Groove"); g.Profile=s2
g.ReferenceAxis=(s2,['V_Axis']); g.Angle=180
doc.recompute()
sh=body.Shape; bb=sh.BoundBox
print("REF", "vol",sh.Volume,"bbox",bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax,"faces",len(sh.Faces),"valid",sh.isValid())
print("REF states",pad.State,g.State,s2.State,body.State)
print("REF s2 solve",s2.solve(), "pad vol", pad.Shape.Volume)
print("REF s2 vertex map", [ (v.X,v.Y,v.Z) for v in s2.Shape.Vertexes][:4], s2.Placement)
print("REF com", sh.Solids[0].CenterOfMass.x, sh.Solids[0].CenterOfMass.y, sh.Solids[0].CenterOfMass.z)
