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
s2.addGeometry(Part.Circle(V(20,15,0),V(0,0,1),3),False)
s2.addConstraint(Sketcher.Constraint("Radius",0,3))
s2.addConstraint(Sketcher.Constraint("DistanceX",-1,1,0,3,20))
s2.addConstraint(Sketcher.Constraint("DistanceY",-1,1,0,3,15))
h = body.newObject("PartDesign::Hole","Hole")
h.Profile=s2
h.Threaded=False
h.DrillPoint="Flat"
h.Diameter=6
h.HoleCutType="Countersink"
h.HoleCutDiameter=12
h.HoleCutCountersinkAngle=90
h.DepthType="ThroughAll"
doc.recompute()
import traceback
try:
  import math
  sh=body.Shape; bb=sh.BoundBox
  # cone frustum: r 6 -> 3 over height 3
  exp=40*30*10-math.pi*9*10-(math.pi*3/3)*(36+18+9-0)+0
  exp=40*30*10-math.pi*9*7-(math.pi*3/3)*(36+18+9)
  r=dict(id="hole-countersink",ok=sh.isValid() and all(list(o.State)==["Up-to-date"] for o in doc.Objects),script="/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-hole-countersink.py",
   volume=sh.Volume,bbox=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax],faces=len(sh.Faces),valid=sh.isValid(),nsolids=len(sh.Solids),
   expected_volume=exp,sketchSolve=s2.solve(),cutType=h.HoleCutType,csAngle=float(h.HoleCutCountersinkAngle.Value if hasattr(h.HoleCutCountersinkAngle,"Value") else h.HoleCutCountersinkAngle),
   states={o.Name:list(o.State) for o in doc.Objects})
  Part.export([body],"/tmp/ref-hcs.step")
  rd=Part.read("/tmp/ref-hcs.step"); r["stepVolume"]=rd.Volume; r["stepFaces"]=len(rd.Faces)
  bb=rd.BoundBox; r["stepBbox"]=[bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax]
  print("REFHCS "+json.dumps(r))
  open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/baseline/ref-hole-countersink.json","w").write(json.dumps(r,indent=1))
except Exception:
  print('REFHCS ERR '+traceback.format_exc())
