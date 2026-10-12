# Helpers shared by every variants/fc/<id>.py (each of those files exec()s this one first).
# Run under FreeCAD only: ./AppRun freecadcmd <file>.  Z-up.  Sketch planes follow the Body origin:
#   top   = XY_Plane (u=X, v=Y, normal +Z)       front = XZ_Plane (u=X, v=Z, normal -Y)      side = YZ_Plane (u=Y, v=Z, normal +X)
# AttachmentOffset moves a sketch along its own normal, which is what the script's second sketch() argument does.
import FreeCAD as App
import Part, Sketcher, json, math, os, traceback
V = App.Vector
PLANE = {'top': 'XY_Plane', 'front': 'XZ_Plane', 'side': 'YZ_Plane'}
RESULT = {}


def setup():
    doc = App.newDocument('v')
    body = doc.addObject('PartDesign::Body', 'Body')
    return doc, body


def origin(body, role):
    return [o for o in body.Origin.OriginFeatures if o.Role == role][0]


def sketch(body, plane, off=0.0, name='Sk'):
    sk = body.newObject('Sketcher::SketchObject', name)
    sk.AttachmentSupport = [(origin(body, PLANE[plane]), '')]
    sk.MapMode = 'FlatFace'
    if off:
        sk.AttachmentOffset = App.Placement(V(0, 0, off), App.Rotation())
    return sk


def poly(sk, pts):
    n = len(pts)
    first = sk.GeometryCount
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(b[0], b[1], 0)), False)
    for i in range(n):
        sk.addConstraint(Sketcher.Constraint('Coincident', first + i, 2, first + (i + 1) % n, 1))


def rect(sk, x0, y0, x1, y1):
    poly(sk, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def rpoly(sk, pts, rounds):
    """A counter-clockwise polygon with some corners (0-based, as {k: radius}) rounded by a tangent arc: lines and arcs, welded."""
    n = len(pts)
    items = []  # ('l', p, q) or ('a', centre, r, a0, a1)
    corner = []
    for k in range(n):
        c, p, q = pts[k], pts[(k - 1) % n], pts[(k + 1) % n]
        r = rounds.get(k)
        if not r:
            corner.append((c, c, None))
            continue
        u = (p[0] - c[0], p[1] - c[1]); w = (q[0] - c[0], q[1] - c[1])
        lu, lw = math.hypot(*u), math.hypot(*w)
        al = math.acos((u[0] * w[0] + u[1] * w[1]) / (lu * lw))
        t = r / math.tan(al / 2)
        pin = (c[0] + u[0] / lu * t, c[1] + u[1] / lu * t)
        pout = (c[0] + w[0] / lw * t, c[1] + w[1] / lw * t)
        b = (u[0] / lu + w[0] / lw, u[1] / lu + w[1] / lw); lb = math.hypot(*b)
        d = r / math.sin(al / 2)
        ctr = (c[0] + b[0] / lb * d, c[1] + b[1] / lb * d)
        a0 = math.atan2(pin[1] - ctr[1], pin[0] - ctr[0])
        sw = math.atan2(pout[1] - ctr[1], pout[0] - ctr[0]) - a0
        while sw < 0:
            sw += 2 * math.pi
        corner.append((pin, pout, (ctr, r, a0, a0 + sw)))
    for k in range(n):
        pin, pout, arc = corner[k]
        if arc:
            items.append(('a',) + arc)
        nxt_in = corner[(k + 1) % n][0]
        items.append(('l', pout, nxt_in))
    first = sk.GeometryCount
    for it in items:
        if it[0] == 'l':
            sk.addGeometry(Part.LineSegment(V(it[1][0], it[1][1], 0), V(it[2][0], it[2][1], 0)), False)
        else:
            sk.addGeometry(Part.ArcOfCircle(Part.Circle(V(it[1][0], it[1][1], 0), V(0, 0, 1), it[2]), it[3], it[4]), False)
    m = len(items)
    for i in range(m):
        sk.addConstraint(Sketcher.Constraint('Coincident', first + i, 2, first + (i + 1) % m, 1))


def circle(sk, cx, cy, r):
    sk.addGeometry(Part.Circle(V(cx, cy, 0), V(0, 0, 1), r), False)


def pad(body, sk, length, mode='normal'):
    p = body.newObject('PartDesign::Pad', 'Pad')
    p.Profile = sk
    p.Length = length
    if mode == 'reversed':
        p.Reversed = True
    elif mode == 'sym':
        p.SideType = 'Symmetric'
    body.Document.recompute()
    return p


def pocket(body, sk, depth=None, through=False, reversed_=False):
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk
    if through:
        p.Type = 1
    else:
        p.Type = 0
        p.Length = depth
    if reversed_:
        p.Reversed = True
    body.Document.recompute()
    return p


def revolve(body, sk, angle, axis='V_Axis', reversed_=False):
    r = body.newObject('PartDesign::Revolution', 'Rev')
    r.Profile = sk
    r.ReferenceAxis = (sk, [axis])
    r.Angle = angle
    if reversed_:
        r.Reversed = True
    body.Document.recompute()
    return r


def edge_between(shape, a, b):
    """Name of the straight edge whose two end points are a and b (either order)."""
    for i, e in enumerate(shape.Edges, 1):
        p0, p1 = e.Vertexes[0].Point, e.Vertexes[-1].Point
        d = lambda p, q: (p - V(*q)).Length
        if (d(p0, a) < 1e-6 and d(p1, b) < 1e-6) or (d(p0, b) < 1e-6 and d(p1, a) < 1e-6):
            return 'Edge%d' % i
    raise RuntimeError('no edge between %s and %s' % (a, b))


def circ_edge(shape, z, r):
    """Name of the circular edge at height z with radius r."""
    for i, e in enumerate(shape.Edges, 1):
        c = e.Curve
        if type(c).__name__ == 'Circle' and abs(c.Radius - r) < 1e-6 and abs(c.Center.z - z) < 1e-6:
            return 'Edge%d' % i
    raise RuntimeError('no circular edge at z=%s r=%s' % (z, r))


def dress(body, kind, base, edge_names, size):
    f = body.newObject('PartDesign::' + kind, kind)
    f.Base = (base, edge_names)
    if kind == 'Chamfer':
        f.Size = size
    else:
        f.Radius = size
    body.Document.recompute()
    return f


def hole(body, sk, dia, depth=None, cut=None, cut_dia=None, cut_depth=None, cs_angle=90):
    h = body.newObject('PartDesign::Hole', 'Hole')
    h.Profile = sk
    h.Threaded = False
    h.DrillPoint = 'Flat'
    h.Diameter = dia
    if cut == 'Counterbore':
        h.HoleCutType = 'Counterbore'; h.HoleCutDiameter = cut_dia; h.HoleCutDepth = cut_depth
    elif cut == 'Countersink':
        h.HoleCutType = 'Countersink'; h.HoleCutDiameter = cut_dia; h.HoleCutCountersinkAngle = cs_angle
    if depth is None:
        h.DepthType = 'ThroughAll'
    else:
        h.DepthType = 'Dimension'; h.Depth = depth
    body.Document.recompute()
    return h


def datum_plane(body, plane, off):
    dp = body.newObject('PartDesign::Plane', 'Datum')
    dp.AttachmentSupport = [(origin(body, PLANE[plane]), '')]
    dp.MapMode = 'FlatFace'
    dp.AttachmentOffset = App.Placement(V(0, 0, off), App.Rotation())
    body.Document.recompute()
    return dp


def linear_pattern(body, original, axis_role, length, n):
    lp = body.newObject('PartDesign::LinearPattern', 'LP')
    lp.Originals = [original]
    lp.Direction = (origin(body, axis_role), [''])
    lp.Length = length
    lp.Occurrences = n
    body.Tip = lp
    body.Document.recompute()
    return lp


def polar_pattern(body, original, axis_role, angle, n):
    pp = body.newObject('PartDesign::PolarPattern', 'PP')
    pp.Originals = [original]
    pp.Axis = (origin(body, axis_role), [''])
    pp.Angle = angle
    pp.Occurrences = n
    body.Tip = pp
    body.Document.recompute()
    return pp


def mirrored(body, original, plane, off):
    dp = datum_plane(body, plane, off)
    m = body.newObject('PartDesign::Mirrored', 'Mir')
    m.Originals = [original]
    m.MirrorPlane = (dp, [''])
    body.Tip = m
    body.Document.recompute()
    return m


def emit(vid, body, extra=None):
    doc = body.Document
    doc.recompute()
    sh = body.Shape
    # BoundBox of a curved face is conservative in OpenCascade (a 2 mm round on a 30 mm cylinder reports 16.24 as its radius), so the
    # reference uses the exact box.
    bb = sh.optimalBoundingBox(False, False)
    bad = {o.Name: list(o.State) for o in doc.Objects if 'Invalid' in o.State or 'Error' in ' '.join(o.State)}
    solid = sh.Solids[0] if len(sh.Solids) == 1 else sh
    com = solid.CenterOfMass if (sh.Volume > 0 and hasattr(solid, 'CenterOfMass')) else None
    r = dict(id=vid, ok=not bad and sh.isValid() and len(sh.Solids) == 1, volume=sh.Volume,
             bbox=[bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax], faces=len(sh.Faces),
             com=[com.x, com.y, com.z] if com else None, valid=sh.isValid(), solids=len(sh.Solids), bad=bad)
    if extra:
        r.update(extra)
    RESULT[vid] = r
    return r


def emit_multi(vid, body, extra=None):
    """emit() for a profile that makes several separate pieces: FreeCAD gives a valid compound of N solids, which is a good
    reference (emit() calls anything but one solid not-ok)."""
    r = emit(vid, body, extra)
    r['ok'] = (not r['bad']) and bool(r['valid']) and r['solids'] >= 1
    RESULT[vid] = r
    return r


def sk_emit(vid, sk):
    doc = sk.Document
    solve = sk.solve()
    doc.recompute()

    def lst(n):
        try:
            return list(getattr(sk, n))
        except Exception:
            return None
    bb = sk.Shape.BoundBox if sk.Shape and not sk.Shape.isNull() else None
    RESULT[vid] = dict(id=vid, kind='sketch', solve=solve, dof=getattr(sk, 'DoF', None),
                       conflicting=lst('ConflictingConstraints'), redundant=lst('RedundantConstraints'),
                       malformed=lst('MalformedConstraints'), partially_redundant=lst('PartiallyRedundantConstraints'),
                       state=list(sk.State), ncons=sk.ConstraintCount,
                       bbox=[bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax] if bb else None)


def finish(vid):
    r = RESULT.get(vid)
    if r is None:
        raise RuntimeError('no result recorded for ' + vid)
    r['ok'] = r.get('ok', True)
    json.dump(r, open(os.path.join(REFS_DIR, 'ref-%s.json' % vid), 'w'), indent=1)
    print('REFDONE', vid, 'ok' if r['ok'] else 'NOT-OK')


def fail(vid, tb):
    r = dict(id=vid, ok=False, error=tb.strip().splitlines()[-1], traceback=tb)
    json.dump(r, open(os.path.join(REFS_DIR, 'ref-%s.json' % vid), 'w'), indent=1)
    print('REFFAIL', vid, r['error'])
