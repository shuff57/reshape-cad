# S2 probe: the ellipse in FreeCAD's Sketcher. Measures; asserts nothing. Output: JSON next to this file.
# Run: ./AppRun freecadcmd docs/specs/freecad-probes/probe_s2_ellipse.py   (isolated HOME/XDG_*)
import json, math, os
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_s2_ellipse.json')
R = {'freecad': list(App.Version())[:4], 'cases': {}}
doc = App.newDocument('s2')
V = App.Vector
_n = [0]


def sketch():
    _n[0] += 1
    return doc.addObject('Sketcher::SketchObject', 'Sk%d' % _n[0])


def ellipse(sk, cx=0.0, cy=0.0, a=10.0, b=5.0, rot=0.0):
    """An ellipse with major radius a, minor b, major axis rotated by rot degrees. Returns its geo index."""
    major_dir = V(math.cos(math.radians(rot)), math.sin(math.radians(rot)), 0)
    f = math.sqrt(max(a * a - b * b, 0.0))
    # Part.Ellipse(S1, S2, Center): S1 = major-axis end, S2 = minor-axis end
    s1 = V(cx, cy, 0) + major_dir * a
    s2 = V(cx, cy, 0) + V(-major_dir.y, major_dir.x, 0) * b
    return sk.addGeometry(Part.Ellipse(s1, s2, V(cx, cy, 0)), False)


def info(sk):
    st = sk.solve()
    return dict(solve=st, dof=getattr(sk, 'DoF', None),
                conflicting=list(getattr(sk, 'ConflictingConstraints', [])),
                redundant=list(getattr(sk, 'RedundantConstraints', [])),
                malformed=list(getattr(sk, 'MalformedConstraints', [])),
                partial=list(getattr(sk, 'PartiallyRedundantConstraints', [])))


def geo_row(g):
    d = dict(type=type(g).__name__)
    for k in ('Center', 'MajorRadius', 'MinorRadius', 'AngleXU', 'Radius', 'FirstParameter', 'LastParameter'):
        try:
            v = getattr(g, k)
            d[k] = [v.x, v.y, v.z] if hasattr(v, 'x') else v
        except Exception:
            pass
    try:
        d['Focus1'] = [g.Focus1.x, g.Focus1.y]
    except Exception:
        pass
    try:
        d['StartPoint'] = [g.StartPoint.x, g.StartPoint.y]
        d['EndPoint'] = [g.EndPoint.x, g.EndPoint.y]
    except Exception:
        pass
    return d


def try_add(label, build, constraint_fn):
    sk = sketch()
    ids = build(sk)
    before = info(sk)
    row = dict(before=before)
    try:
        ci = sk.addConstraint(constraint_fn(sk, ids))
        row['accepted'] = True
        row['constraint_index'] = ci
        row['after'] = info(sk)
        row['geometry_after'] = [geo_row(g) for g in sk.Geometry]
    except Exception as e:  # noqa
        row['accepted'] = False
        row['error'] = '%s: %s' % (type(e).__name__, str(e)[:160])
    R['cases'][label] = row


# ---- A: a lone ellipse -------------------------------------------------------------------------
sk = sketch()
e = ellipse(sk, 0, 0, 10, 5, 0)
R['cases']['A_lone'] = dict(info=info(sk), geometry=[geo_row(g) for g in sk.Geometry], geo_count=sk.GeometryCount)
pts = {}
for pos in (0, 1, 2, 3):
    try:
        p = sk.getPoint(e, pos)
        pts[str(pos)] = [p.x, p.y]
    except Exception as ex:  # noqa
        pts[str(pos)] = 'ERR %s' % ex
R['cases']['A_lone']['getPoint'] = pts
# rotated + offset, to see AngleXU / Focus1 / MajorRadius conventions
sk2 = sketch()
ellipse(sk2, 3, 4, 8, 3, 30)
R['cases']['A_rotated'] = dict(info=info(sk2), geometry=[geo_row(g) for g in sk2.Geometry])

# ---- B: constraints on an ellipse ----------------------------------------------------------------
def e_only(sk):
    return [ellipse(sk, 0, 0, 10, 5, 0)]

def e_pt(sk):
    e = ellipse(sk, 0, 0, 10, 5, 0)
    p = sk.addGeometry(Part.Point(V(7, 3, 0)), False)
    return [e, p]

def e_line(sk):
    e = ellipse(sk, 0, 0, 10, 5, 0)
    l = sk.addGeometry(Part.LineSegment(V(-15, 7, 0), V(15, 7, 0)), False)
    return [e, l]

def e_circle(sk):
    e = ellipse(sk, 0, 0, 10, 5, 0)
    c = sk.addGeometry(Part.Circle(V(20, 0, 0), V(0, 0, 1), 4), False)
    return [e, c]

def e_e(sk):
    e1 = ellipse(sk, 0, 0, 10, 5, 0)
    e2 = ellipse(sk, 30, 0, 8, 3, 10)
    return [e1, e2]

C = Sketcher.Constraint
try_add('B_coincident_point_center', e_pt, lambda sk, i: C('Coincident', i[1], 1, i[0], 3))
try_add('B_pointOnObject_point_on_ellipse', e_pt, lambda sk, i: C('PointOnObject', i[1], 1, i[0]))
try_add('B_tangent_line_ellipse', e_line, lambda sk, i: C('Tangent', i[1], i[0]))
try_add('B_tangent_circle_ellipse', e_circle, lambda sk, i: C('Tangent', i[1], i[0]))
try_add('B_tangent_ellipse_ellipse', e_e, lambda sk, i: C('Tangent', i[0], i[1]))
try_add('B_equal_ellipse_ellipse', e_e, lambda sk, i: C('Equal', i[0], i[1]))
try_add('B_equal_ellipse_circle', e_circle, lambda sk, i: C('Equal', i[0], i[1]))
try_add('B_radius_ellipse', e_only, lambda sk, i: C('Radius', i[0], 7.0))
try_add('B_diameter_ellipse', e_only, lambda sk, i: C('Diameter', i[0], 14.0))
try_add('B_horizontal_ellipse', e_only, lambda sk, i: C('Horizontal', i[0]))
try_add('B_vertical_ellipse', e_only, lambda sk, i: C('Vertical', i[0]))
try_add('B_block_ellipse', e_only, lambda sk, i: C('Block', i[0]))
try_add('B_distanceX_center', e_only, lambda sk, i: C('DistanceX', i[0], 3, 4.0))
try_add('B_distance_center_point', e_pt, lambda sk, i: C('Distance', i[0], 3, i[1], 1, 12.0))
try_add('B_angle_ellipse', e_only, lambda sk, i: C('Angle', i[0], math.radians(20)))
try_add('B_symmetric_points_about_ellipse_center', e_pt,
        lambda sk, i: C('Symmetric', i[1], 1, i[1], 1, i[0], 3))

# ---- C: internal geometry ---------------------------------------------------------------------
sk = sketch()
e = ellipse(sk, 0, 0, 10, 5, 0)
before = info(sk)
try:
    r = sk.exposeInternalGeometry(e)
    after = info(sk)
    cons = [dict(type=c.Type, first=c.First, firstPos=c.FirstPos, second=c.Second, secondPos=c.SecondPos,
                 value=c.Value, driving=c.Driving) for c in sk.Constraints]
    R['cases']['C_expose_internal'] = dict(returned=r, before=before, after=after,
                                           geometry=[dict(geo_row(g), construction=sk.getConstruction(i))
                                                     for i, g in enumerate(sk.Geometry)],
                                           constraints=cons)
except Exception as ex:  # noqa
    R['cases']['C_expose_internal'] = dict(error='%s: %s' % (type(ex).__name__, ex))

# ---- D: dimension an ellipse through its internal major/minor lines --------------------------------
sk = sketch()
e = ellipse(sk, 0, 0, 10, 5, 0)
sk.exposeInternalGeometry(e)
lines = [i for i, g in enumerate(sk.Geometry) if type(g).__name__ == 'LineSegment']
D = dict(lines=lines, base=info(sk))
for li in lines:
    g = sk.Geometry[li]
    D['line_%d_length' % li] = g.length() if hasattr(g, 'length') else None
if len(lines) >= 2:
    try:
        sk.addConstraint(C('Distance', lines[0], 24.0))
        sk.addConstraint(C('Distance', lines[1], 8.0))
        D['after_dims'] = info(sk)
        D['ellipse_after'] = geo_row(sk.Geometry[e])
    except Exception as ex:  # noqa
        D['error'] = '%s: %s' % (type(ex).__name__, ex)
R['cases']['D_dimension_axes'] = D

# ---- E: arc of ellipse ---------------------------------------------------------------------------
sk = sketch()
base = Part.Ellipse(V(10, 0, 0), V(0, 5, 0), V(0, 0, 0))
ae = sk.addGeometry(Part.ArcOfEllipse(base, 0.0, math.pi / 2), False)
E = dict(info=info(sk), geometry=[geo_row(g) for g in sk.Geometry])
for pos in (1, 2, 3):
    try:
        p = sk.getPoint(ae, pos)
        E['getPoint_%d' % pos] = [p.x, p.y]
    except Exception as ex:  # noqa
        E['getPoint_%d' % pos] = 'ERR %s' % ex
try:
    sk.exposeInternalGeometry(ae)
    E['after_expose'] = info(sk)
    E['geo_count_after_expose'] = sk.GeometryCount
except Exception as ex:  # noqa
    E['expose_error'] = str(ex)
R['cases']['E_arc_of_ellipse'] = E

# ---- F: a closed profile from two half-ellipse arcs: does a Pad accept it? ---------------------------------
sk = sketch()
body = doc.addObject('PartDesign::Body', 'BodyF')
body.addObject(sk)
whole = Part.Ellipse(V(10, 0, 0), V(0, 5, 0), V(0, 0, 0))
sk.addGeometry(whole, False)
doc.recompute()
pad = body.newObject('PartDesign::Pad', 'PadF')
pad.Profile = sk
pad.Length = 4
doc.recompute()
vol = pad.Shape.Volume if pad.Shape and not pad.Shape.isNull() else None
R['cases']['F_pad_ellipse'] = dict(valid=pad.isValid(), volume=vol, expected=math.pi * 10 * 5 * 4,
                                   faces=len(pad.Shape.Faces) if vol else None,
                                   face_types=[f.Surface.__class__.__name__ for f in pad.Shape.Faces] if vol else None)

json.dump(R, open(OUT, 'w'), indent=1)
print('wrote', OUT)
