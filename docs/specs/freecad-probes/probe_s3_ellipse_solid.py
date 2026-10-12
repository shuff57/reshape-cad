# S3 probe: ellipse pads and pockets in FreeCAD's PartDesign. Measures; asserts nothing.
# Run: ./AppRun freecadcmd docs/specs/freecad-probes/probe_s3_ellipse_solid.py   (isolated HOME/XDG_*)
import json, math, os
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_s3_ellipse_solid.json')
R = {'freecad': list(App.Version())[:4], 'cases': {}}
doc = App.newDocument('s3')
V = App.Vector
C = Sketcher.Constraint


def summarize(shape):
    if shape is None or shape.isNull():
        return None
    bb = shape.BoundBox
    return dict(volume=shape.Volume, faces=len(shape.Faces), edges=len(shape.Edges), valid=shape.isValid(),
                bbox=[bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
                face_types=sorted(f.Surface.__class__.__name__ for f in shape.Faces))


def ellipse_geo(cx, cy, a, b, rot_deg):
    c, s = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    s1 = V(cx + a * c, cy + a * s, 0)
    s2 = V(cx - b * s, cy + b * c, 0)
    return Part.Ellipse(s1, s2, V(cx, cy, 0))


def block(name):
    body = doc.addObject('PartDesign::Body', 'Body' + name)
    sk = doc.addObject('Sketcher::SketchObject', 'Base' + name)
    body.addObject(sk)
    pts = [(0, 0), (40, 0), (40, 30), (0, 30)]
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(C('Coincident', i, 2, (i + 1) % 4, 1))
    pad = body.newObject('PartDesign::Pad', 'BasePad' + name)
    pad.Profile = sk
    pad.Length = 10
    doc.recompute()
    return body, pad


def pocket_case(label, cx, cy, a, b, rot, through):
    body, base = block(label)
    sk = doc.addObject('Sketcher::SketchObject', 'Pk' + label)
    body.addObject(sk)
    sk.Placement = App.Placement(V(0, 0, 10), App.Rotation())
    sk.MapMode = 'Deactivated'
    sk.addGeometry(ellipse_geo(cx, cy, a, b, rot), False)
    doc.recompute()
    pk = body.newObject('PartDesign::Pocket', 'Pocket' + label)
    pk.Profile = sk
    if through:
        pk.Type = 1
    else:
        pk.Type = 0
        pk.Length = 4
    doc.recompute()
    R['cases'][label] = dict(base=summarize(base.Shape), pocket=summarize(pk.Shape), valid=pk.isValid(),
                             state=list(pk.State))


pocket_case('blind', 20, 15, 10, 5, 0, False)
pocket_case('through', 14, 18, 8, 3, 35, True)

# half ellipse closed by its chord: a D-shaped pad
body = doc.addObject('PartDesign::Body', 'BodyD')
sk = doc.addObject('Sketcher::SketchObject', 'SkD')
body.addObject(sk)
base = Part.Ellipse(V(10, 0, 0), V(0, 5, 0), V(0, 0, 0))
a = sk.addGeometry(Part.ArcOfEllipse(base, 0.0, math.pi), False)
l = sk.addGeometry(Part.LineSegment(V(-10, 0, 0), V(10, 0, 0)), False)
sk.addConstraint(C('Coincident', a, 2, l, 1))
sk.addConstraint(C('Coincident', l, 2, a, 1))
pad = body.newObject('PartDesign::Pad', 'PadD')
pad.Profile = sk
pad.Length = 4
doc.recompute()
R['cases']['d_shape_pad'] = dict(pad=summarize(pad.Shape), expected=math.pi * 10 * 5 / 2 * 4)

# an ellipse hole in a rectangle, one sketch
body = doc.addObject('PartDesign::Body', 'BodyH')
sk = doc.addObject('Sketcher::SketchObject', 'SkH')
body.addObject(sk)
pts = [(0, 0), (40, 0), (40, 25), (0, 25)]
for i in range(4):
    p, q = pts[i], pts[(i + 1) % 4]
    sk.addGeometry(Part.LineSegment(V(p[0], p[1], 0), V(q[0], q[1], 0)), False)
for i in range(4):
    sk.addConstraint(C('Coincident', i, 2, (i + 1) % 4, 1))
sk.addGeometry(ellipse_geo(20, 12.5, 9, 4, 15), False)
pad = body.newObject('PartDesign::Pad', 'PadH')
pad.Profile = sk
pad.Length = 6
doc.recompute()
R['cases']['ellipse_hole_pad'] = dict(pad=summarize(pad.Shape), expected=(1000 - math.pi * 9 * 4) * 6)

json.dump(R, open(OUT, 'w'), indent=1)
print('wrote', OUT)
