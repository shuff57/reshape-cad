# Extra FreeCAD helpers for the census, on top of the gauntlet's prelude (read, never edited).
# Every census/fc/<id>.py exec()s the gauntlet's fc_prelude.py first (it defines setup, sketch, rect, poly, circle, pad, pocket,
# revolve, hole, emit ...), then this file.
import math


def setp(obj, **props):
    for k, v in props.items():
        setattr(obj, k, v)
    return obj


def pad_x(body, sk, length, **props):
    p = body.newObject('PartDesign::Pad', 'Pad')
    p.Profile = sk
    p.Length = length
    setp(p, **props)
    body.Document.recompute()
    return p


def pocket_x(body, sk, length=None, **props):
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk
    if length is not None:
        p.Type = 0
        p.Length = length
    setp(p, **props)
    body.Document.recompute()
    return p


def groove_x(body, sk, angle, axis='V_Axis', **props):
    g = body.newObject('PartDesign::Groove', 'Groove')
    g.Profile = sk
    g.ReferenceAxis = (sk, [axis])
    g.Angle = angle
    setp(g, **props)
    body.Document.recompute()
    return g


def planar_face(shape, normal, offset=None, tol=1e-6):
    """Name of the planar face whose outward normal is `normal` (and, if given, whose plane is at dot(p, normal) == offset)."""
    n = V(*normal)
    n.normalize()
    best = None
    for i, f in enumerate(shape.Faces, 1):
        s = f.Surface
        if type(s).__name__ != 'Plane':
            continue
        fn = f.normalAt(0, 0)
        if (fn - n).Length < 1e-6:
            if offset is None or abs(f.CenterOfMass.dot(n) - offset) < tol:
                best = 'Face%d' % i
    if best is None:
        raise RuntimeError('no planar face with normal %s at %s' % (normal, offset))
    return best


def edges_where(shape, pred):
    return ['Edge%d' % i for i, e in enumerate(shape.Edges, 1) if pred(e)]


def thick(body, base, faces, value, **props):
    t = body.newObject('PartDesign::Thickness', 'Thick')
    t.Base = (base, faces)
    t.Value = value
    setp(t, **props)
    body.Document.recompute()
    return t


def draft_x(body, base, faces, angle, neutral_role='XY_Plane', pull_role='Z_Axis', **props):
    d = body.newObject('PartDesign::Draft', 'Draft')
    d.Base = (base, faces)
    d.Angle = angle
    d.NeutralPlane = (origin(body, neutral_role), [''])
    d.PullDirection = (origin(body, pull_role), [''])
    setp(d, **props)
    body.Document.recompute()
    return d


def chamfer_x(body, base, edges, size, **props):
    c = body.newObject('PartDesign::Chamfer', 'Chamfer')
    c.Base = (base, edges)
    c.Size = size
    setp(c, **props)
    body.Document.recompute()
    return c


def prim(body, kind, at=(0, 0, 0), subtractive=False, **props):
    """An additive (or subtractive) primitive whose placement base is `at` (box: its min corner; cylinder / cone: the centre of
    its base; sphere: its centre -- FreeCAD's own conventions)."""
    o = body.newObject('PartDesign::%s%s' % ('Subtractive' if subtractive else 'Additive', kind), kind)
    setp(o, **props)
    o.MapMode = 'Deactivated'
    o.Placement = App.Placement(V(*at), App.Rotation())
    body.Document.recompute()
    return o


def new_body(doc, name):
    return doc.addObject('PartDesign::Body', name)


def boolean_x(body, other, kind):
    b = body.newObject('PartDesign::Boolean', 'Bool')
    b.addObject(other)
    b.Type = kind
    body.Document.recompute()
    return b


def datum_tilted(body, plane, angle_deg, about='X', off=0.0):
    dp = body.newObject('PartDesign::Plane', 'DatumT')
    dp.AttachmentSupport = [(origin(body, PLANE[plane]), '')]
    dp.MapMode = 'FlatFace'
    axis = {'X': V(1, 0, 0), 'Y': V(0, 1, 0), 'Z': V(0, 0, 1)}[about]
    dp.AttachmentOffset = App.Placement(V(0, 0, off), App.Rotation(axis, angle_deg))
    body.Document.recompute()
    return dp


def sketch_on(body, support, sub=''):
    sk = body.newObject('Sketcher::SketchObject', 'SkOn')
    sk.AttachmentSupport = [(support, sub)]
    sk.MapMode = 'FlatFace'
    return sk


def plate(body, w=40, d=30, h=10):
    s = sketch(body, 'top')
    rect(s, 0, 0, w, d)
    return pad(body, s, h)
