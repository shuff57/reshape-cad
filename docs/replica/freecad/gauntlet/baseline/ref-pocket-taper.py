import FreeCAD as App, Part, Sketcher, json
def run(angle):
    doc = App.newDocument("pt")
    body = doc.addObject("PartDesign::Body", "Body")
    xy = body.Origin.OriginFeatures[3]
    def rect(sk, x0,y0,x1,y1):
        p=[App.Vector(x0,y0,0),App.Vector(x1,y0,0),App.Vector(x1,y1,0),App.Vector(x0,y1,0)]
        for i in range(4):
            sk.addGeometry(Part.LineSegment(p[i],p[(i+1)%4]))
        for i in range(4):
            sk.addConstraint(Sketcher.Constraint("Coincident",i,2,(i+1)%4,1))
    s1 = body.newObject("Sketcher::SketchObject","Sketch")
    s1.AttachmentSupport=[(xy,"")]; s1.MapMode="FlatFace"
    rect(s1,-30,-20,30,20)
    doc.recompute()
    pad = body.newObject("PartDesign::Pad","Pad"); pad.Profile=s1; pad.Length=8
    doc.recompute()
    s2 = body.newObject("Sketcher::SketchObject","Sketch001")
    s2.AttachmentSupport=[(xy,"")]; s2.MapMode="FlatFace"
    s2.AttachmentOffset=App.Placement(App.Vector(0,0,8),App.Rotation())
    rect(s2,-10,-6,10,6)
    doc.recompute()
    pk = body.newObject("PartDesign::Pocket","Pocket"); pk.Profile=s2; pk.Type=0; pk.Length=3; pk.TaperAngle=angle
    doc.recompute()
    sh=body.Shape; bb=sh.BoundBox
    print("PKT", angle, repr(sh.Volume), [bb.XMin,bb.YMin,bb.ZMin,bb.XMax,bb.YMax,bb.ZMax], len(sh.Faces), sh.isValid(), list(pk.State))
for a in (0, 15, -15):
    run(a)
