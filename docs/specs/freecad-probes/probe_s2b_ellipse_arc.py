# S2b probe: the arc of an ellipse in FreeCAD's Sketcher. Measures; asserts nothing.
# Run: ./AppRun freecadcmd docs/specs/freecad-probes/probe_s2b_ellipse_arc.py   (isolated HOME/XDG_*)
import json, math, os
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_s2b_ellipse_arc.json')
R = {'freecad': list(App.Version())[:4], 'cases': {}}
doc = App.newDocument('s2b')
V = App.Vector
C = Sketcher.Constraint
_n = [0]


def sketch():
    _n[0] += 1
    return doc.addObject('Sketcher::SketchObject', 'Sk%d' % _n[0])


def arc_of_ellipse(sk, a0=0.0, a1=math.pi / 2, cx=0.0, cy=0.0, a=10.0, b=5.0):
    base = Part.Ellipse(V(cx + a, cy, 0), V(cx, cy + b, 0), V(cx, cy, 0))
    return sk.addGeometry(Part.ArcOfEllipse(base, a0, a1), False)


def info(sk):
    st = sk.solve()
    return dict(solve=st, dof=getattr(sk, 'DoF', None),
                conflicting=list(getattr(sk, 'ConflictingConstraints', [])),
                redundant=list(getattr(sk, 'RedundantConstraints', [])),
                malformed=list(getattr(sk, 'MalformedConstraints', [])))


def arc_row(g):
    d = dict(type=type(g).__name__)
    for k in ('MajorRadius', 'MinorRadius', 'AngleXU', 'FirstParameter', 'LastParameter'):
        try:
            d[k] = getattr(g, k)
        except Exception:
            pass
    for k in ('Center', 'StartPoint', 'EndPoint'):
        try:
            v = getattr(g, k)
            d[k] = [round(v.x, 9), round(v.y, 9)]
        except Exception:
            pass
    return d


def case(label, build, cfn):
    sk = sketch()
    ids = build(sk)
    row = dict(before=info(sk))
    try:
        sk.addConstraint(cfn(sk, ids))
        row['accepted'] = True
        row['after'] = info(sk)
        row['geometry'] = [arc_row(g) for g in sk.Geometry]
    except Exception as e:  # noqa
        row['accepted'] = False
        row['error'] = '%s: %s' % (type(e).__name__, str(e)[:160])
    R['cases'][label] = row


def arc_only(sk): return [arc_of_ellipse(sk)]
def arc_pt(sk): return [arc_of_ellipse(sk), sk.addGeometry(Part.Point(V(7, 3.6, 0)), False)]
def arc_pt_outside(sk): return [arc_of_ellipse(sk), sk.addGeometry(Part.Point(V(-6.0, -4.5, 0)), False)]
def arc_line(sk): return [arc_of_ellipse(sk), sk.addGeometry(Part.LineSegment(V(-15, 7, 0), V(15, 7, 0)), False)]
def arc_line_end(sk): return [arc_of_ellipse(sk), sk.addGeometry(Part.LineSegment(V(0, 5, 0), V(-10, 5, 0)), False)]
def arc_ellipse(sk):
    e = sk.addGeometry(Part.Ellipse(V(40, 0, 0), V(40, 3, 0), V(30, 0, 0)), False)
    return [arc_of_ellipse(sk), e]
def arc_arc(sk): return [arc_of_ellipse(sk), arc_of_ellipse(sk, 0.0, 1.0, 30, 0, 8, 3)]

# lone
sk = sketch()
ae = arc_of_ellipse(sk)
R['cases']['lone'] = dict(info=info(sk), geo=arc_row(sk.Geometry[0]))

case('coincident_start_to_point', arc_pt, lambda sk, i: C('Coincident', i[1], 1, i[0], 1))
case('coincident_end_to_point', arc_pt, lambda sk, i: C('Coincident', i[1], 1, i[0], 2))
case('coincident_center_to_point', arc_pt, lambda sk, i: C('Coincident', i[1], 1, i[0], 3))
case('coincident_end_to_line_end', arc_line_end, lambda sk, i: C('Coincident', i[1], 1, i[0], 2))
case('pointOnObject_on_sweep', arc_pt, lambda sk, i: C('PointOnObject', i[1], 1, i[0]))
case('pointOnObject_outside_sweep', arc_pt_outside, lambda sk, i: C('PointOnObject', i[1], 1, i[0]))
case('tangent_line_arc_edge', arc_line, lambda sk, i: C('Tangent', i[1], i[0]))
case('tangent_endpoint_line_end_arc_end', arc_line_end, lambda sk, i: C('Tangent', i[1], 1, i[0], 2))
case('tangent_arc_ellipse', arc_ellipse, lambda sk, i: C('Tangent', i[0], i[1]))
case('tangent_arc_arc_edge', arc_arc, lambda sk, i: C('Tangent', i[0], i[1]))
case('equal_arc_ellipse', arc_ellipse, lambda sk, i: C('Equal', i[0], i[1]))
case('equal_arc_arc', arc_arc, lambda sk, i: C('Equal', i[0], i[1]))
case('radius_arc', arc_only, lambda sk, i: C('Radius', i[0], 7.0))
case('horizontal_arc', arc_only, lambda sk, i: C('Horizontal', i[0]))
case('distance_start_end', arc_only, lambda sk, i: C('Distance', i[0], 1, i[0], 2, 9.0))
case('block_arc', arc_only, lambda sk, i: C('Block', i[0]))

# internal geometry + axis dimensions
sk = sketch()
ae = arc_of_ellipse(sk)
sk.exposeInternalGeometry(ae)
lines = [i for i, g in enumerate(sk.Geometry) if type(g).__name__ == 'LineSegment']
D = dict(count=sk.GeometryCount, lines=lines, info=info(sk))
try:
    sk.addConstraint(C('Distance', lines[0], 24.0))
    sk.addConstraint(C('Distance', lines[1], 8.0))
    D['after'] = info(sk)
    D['arc'] = arc_row(sk.Geometry[ae])
except Exception as e:  # noqa
    D['error'] = str(e)
R['cases']['axis_dims'] = D

# does a Pad on a closed profile made of an elliptic arc and a line work, and what is its wall?
sk = sketch()
body = doc.addObject('PartDesign::Body', 'BodyP')
body.addObject(sk)
a = arc_of_ellipse(sk, 0.0, math.pi)
l = sk.addGeometry(Part.LineSegment(V(-10, 0, 0), V(10, 0, 0)), False)
sk.addConstraint(C('Coincident', a, 2, l, 1))
sk.addConstraint(C('Coincident', l, 2, a, 1))
doc.recompute()
pad = body.newObject('PartDesign::Pad', 'PadP')
pad.Profile = sk
pad.Length = 4
doc.recompute()
vol = pad.Shape.Volume if pad.Shape and not pad.Shape.isNull() else None
R['cases']['pad_half_ellipse'] = dict(valid=pad.isValid(), volume=vol, expected=math.pi * 10 * 5 / 2 * 4,
                                      faces=len(pad.Shape.Faces) if vol else None)
json.dump(R, open(OUT, 'w'), indent=1)
print('wrote', OUT)
