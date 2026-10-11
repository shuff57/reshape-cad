import FreeCAD as App, Part, Sketcher, json
from FreeCAD import Vector as V
doc = App.newDocument("t")
def build(name):
    body = doc.addObject("PartDesign::Body", "Body"+name)
    sk = body.newObject("Sketcher::SketchObject", name)
    g = [Part.LineSegment(V(0,0,0),V(40,0,0)), Part.LineSegment(V(40,0,0),V(40,20,0)),
         Part.LineSegment(V(40,20,0),V(0,20,0)), Part.LineSegment(V(0,20,0),V(0,0,0))]
    sk.addGeometry(g, False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint("Coincident", i,2,(i+1)%4,1))
    sk.addConstraint(Sketcher.Constraint("Horizontal",0))
    sk.addConstraint(Sketcher.Constraint("Horizontal",2))
    sk.addConstraint(Sketcher.Constraint("Vertical",1))
    sk.addConstraint(Sketcher.Constraint("Vertical",3))
    sk.addConstraint(Sketcher.Constraint("Coincident",0,1,-1,1))
    return sk
def rep(tag, sk):
    st = sk.solve()
    d = {"tag":tag,"solve":st,"nCons":sk.ConstraintCount}
    for a in ("ConflictingConstraints","RedundantConstraints","MalformedConstraints","PartiallyRedundantConstraints"):
        try: d[a]=list(getattr(sk,a))
        except Exception as e: d[a]="n/a:"+type(e).__name__
    doc.recompute()
    d["state"]=list(sk.State)
    print("SKC", json.dumps(d)); return d
out={}
# baseline
sk=build("A"); sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40)); wi=sk.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,20))
out["baseline"]=rep("baseline",sk); out["baseline_width_idx"]=wi-1
# conflict
wi_idx=[i for i,c in enumerate(sk.Constraints) if c.Type=="DistanceX"][0]
sk.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,50))
out["conflict"]=rep("conflict",sk)
out["conflict_cons"]=[(i,c.Type,c.Value) for i,c in enumerate(sk.Constraints) if c.Type.startswith("Dist")]
# redundant
sk2=build("B"); sk2.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40)); sk2.addConstraint(Sketcher.Constraint("DistanceY",1,1,1,2,20))
sk2.addConstraint(Sketcher.Constraint("DistanceX",0,1,0,2,40))
out["redundant"]=rep("redundant",sk2)
out["redundant_cons"]=[(i,c.Type,c.Value) for i,c in enumerate(sk2.Constraints) if c.Type.startswith("Dist")]
json.dump(out,open("ref-sk-conflict.raw.json","w"))
