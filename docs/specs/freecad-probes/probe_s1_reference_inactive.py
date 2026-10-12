# S1 probe: reference (Driving=False) and inactive (IsActive=False) constraints in FreeCAD's Sketcher.
# Measures; asserts nothing. Output: JSON next to this file. Run with freecadcmd.
import json, os, traceback
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_s1_reference_inactive.json')
R = {'freecad': list(App.Version())[:4], 'introspection': {}, 'cases': {}}

doc = App.newDocument('s1')
V = App.Vector


def new_sketch():
    sk = doc.addObject('Sketcher::SketchObject', 'Sk')
    return sk


def lst(sk, name):
    try:
        return list(getattr(sk, name))
    except Exception as e:  # noqa
        return 'ERR:%s' % e


def snap(sk, label, **extra):
    st = sk.solve()
    d = dict(label=label, solve=st, dof=getattr(sk, 'DoF', None),
             conflicting=lst(sk, 'ConflictingConstraints'),
             redundant=lst(sk, 'RedundantConstraints'),
             malformed=lst(sk, 'MalformedConstraints'),
             partially_redundant=lst(sk, 'PartiallyRedundantConstraints'))
    d['constraints'] = []
    for i, c in enumerate(sk.Constraints):
        row = dict(i=i, type=c.Type, driving=c.Driving, active=getattr(c, 'IsActive', None),
                   value=c.Value, name=c.Name)
        d['constraints'].append(row)
    d['geometry'] = []
    for g in sk.Geometry:
        try:
            if g.TypeId == 'Part::GeomLineSegment':
                d['geometry'].append(['line', [g.StartPoint.x, g.StartPoint.y], [g.EndPoint.x, g.EndPoint.y]])
            else:
                d['geometry'].append([g.TypeId])
        except Exception as e:  # noqa
            d['geometry'].append(['ERR', str(e)])
    d.update(extra)
    return d


def rect(sk, w=10.0, h=6.0):
    """Four lines, closed by coincidents, H/V, anchored at origin. Dimensions added by caller."""
    p = [V(0, 0, 0), V(w, 0, 0), V(w, h, 0), V(0, h, 0)]
    for i in range(4):
        sk.addGeometry(Part.LineSegment(p[i], p[(i + 1) % 4]), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', i, 2, (i + 1) % 4, 1))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 0))
    sk.addConstraint(Sketcher.Constraint('Horizontal', 2))
    sk.addConstraint(Sketcher.Constraint('Vertical', 1))
    sk.addConstraint(Sketcher.Constraint('Vertical', 3))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -1, 1))  # anchor to origin


def case(name, fn):
    try:
        R['cases'][name] = fn()
    except Exception:
        R['cases'][name] = {'EXCEPTION': traceback.format_exc()}


# ---- 0. introspection -------------------------------------------------------------------------------------------
sk0 = new_sketch()
names = [n for n in dir(sk0) if any(k in n for k in ('Driv', 'Activ', 'Refer', 'Datum', 'Dependent', 'Conflict', 'Redundan', 'Malformed', 'toggle', 'DoF'))]
R['introspection']['sketch_methods'] = sorted(names)
c = Sketcher.Constraint('Distance', 0, 5.0)
R['introspection']['constraint_attrs'] = sorted(n for n in dir(c) if not n.startswith('_'))
R['introspection']['constraint_defaults'] = {'Driving': c.Driving, 'IsActive': getattr(c, 'IsActive', 'n/a'), 'Value': c.Value}
R['introspection']['sketch_properties'] = sk0.PropertiesList


# ---- A. baseline: fully constrained -----------------------------------------------------------------------------
def A():
    sk = new_sketch(); rect(sk)
    iw = sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 10.0))
    ih = sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 6.0))
    return dict(idx=dict(w=iw, h=ih), base=snap(sk, 'baseline'))
case('A_baseline', A)


# ---- B. a dimension becomes reference: DoF +1, value is measured ------------------------------------------------
def B():
    sk = new_sketch(); rect(sk)
    iw = sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 10.0))
    ih = sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 6.0))
    out = dict(idx=dict(w=iw, h=ih), before=snap(sk, 'before'))
    try:
        sk.setDriving(iw, False)
        out['after_setDriving_false'] = snap(sk, 'width reference')
    except Exception:
        out['setDriving_err'] = traceback.format_exc()
    # does a reference value follow later moves? drive the height to 9 and look at the width reference
    try:
        sk.setDatum(ih, App.Units.Quantity('9 mm'))
        out['after_height_9'] = snap(sk, 'height=9, width reference')
    except Exception:
        out['setDatum_err'] = traceback.format_exc()
    return out
case('B_reference_dimension', B)


# ---- C. redundant dimension: reference removes the redundancy ---------------------------------------------------
def C():
    sk = new_sketch(); rect(sk)
    iw = sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 10.0))
    ih = sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 6.0))
    ir = sk.addConstraint(Sketcher.Constraint('DistanceX', 2, 2, 2, 1, 10.0))  # same width again, redundant
    out = dict(idx=dict(w=iw, h=ih, redundant_w=ir), redundant_driving=snap(sk, 'redundant driving'))
    try:
        sk.setDriving(ir, False)
        out['redundant_as_reference'] = snap(sk, 'redundant -> reference')
    except Exception:
        out['err'] = traceback.format_exc()
    return out
case('C_redundant_to_reference', C)


# ---- D. conflicting dimension: reference and inactive both resolve it ---------------------------------------------
def D():
    out = {}
    for mode in ('reference', 'inactive'):
        sk = new_sketch(); rect(sk)
        iw = sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 10.0))
        ih = sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 6.0))
        ic = sk.addConstraint(Sketcher.Constraint('DistanceX', 2, 2, 2, 1, 12.0))  # conflicts: 12 vs 10
        entry = dict(idx=dict(w=iw, h=ih, conflicting_w=ic), conflict=snap(sk, 'conflict'))
        try:
            if mode == 'reference':
                sk.setDriving(ic, False)
            else:
                sk.setActive(ic, False)
            entry['resolved'] = snap(sk, mode)
        except Exception:
            entry['err'] = traceback.format_exc()
        out[mode] = entry
    return out
case('D_conflict_resolution', D)


# ---- E. an inactive driving dimension leaves a DoF, and its stored value ------------------------------------------
def E():
    sk = new_sketch(); rect(sk)
    iw = sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 10.0))
    ih = sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 6.0))
    out = dict(idx=dict(w=iw, h=ih))
    try:
        sk.setActive(ih, False)
        out['height_inactive'] = snap(sk, 'height inactive')
        sk.setActive(ih, True)
        out['height_reactivated'] = snap(sk, 'height reactivated')
    except Exception:
        out['err'] = traceback.format_exc()
    return out
case('E_inactive_dimension', E)


# ---- F. which kinds accept setDriving(False)? ------------------------------------------------------------------
def F():
    sk = new_sketch(); rect(sk, 10, 6)
    kinds = {}
    sk.addGeometry(Part.Circle(V(5, 3, 0), V(0, 0, 1), 1.0), False)  # geo 4
    sk.addGeometry(Part.LineSegment(V(0, 0, 0), V(1, 1, 0)), False)  # geo 5
    probes = [
        ('Horizontal', Sketcher.Constraint('Horizontal', 5)),
        ('Vertical', Sketcher.Constraint('Vertical', 5)),
        ('Coincident', Sketcher.Constraint('Coincident', 5, 1, 4, 3)),
        ('Radius', Sketcher.Constraint('Radius', 4, 1.0)),
        ('Diameter', Sketcher.Constraint('Diameter', 4, 2.0)),
        ('Distance', Sketcher.Constraint('Distance', 5, 1.4142)),
        ('Angle', Sketcher.Constraint('Angle', 0, 1, 5, 1, 0.7853981)),
        ('Equal', Sketcher.Constraint('Equal', 0, 2)),
        ('Parallel', Sketcher.Constraint('Parallel', 0, 2)),
        ('Perpendicular', Sketcher.Constraint('Perpendicular', 0, 1)),
        ('Symmetric', Sketcher.Constraint('Symmetric', 5, 1, 5, 2, -1, 1)),
        ('Block', Sketcher.Constraint('Block', 5)),
    ]
    for label, con in probes:
        try:
            idx = sk.addConstraint(con)
        except Exception as e:
            kinds[label] = dict(add_error=str(e)); continue
        row = dict(idx=idx, default_driving=sk.Constraints[idx].Driving)
        try:
            sk.setDriving(idx, False)
            row['setDriving_false'] = 'ok'
            row['driving_after'] = sk.Constraints[idx].Driving
        except Exception as e:
            row['setDriving_false'] = 'ERR:%s' % e
        try:
            sk.setActive(idx, False)
            row['setActive_false'] = 'ok'
            row['active_after'] = getattr(sk.Constraints[idx], 'IsActive', None)
        except Exception as e:
            row['setActive_false'] = 'ERR:%s' % e
        kinds[label] = row
    return kinds
case('F_kind_support', F)


with open(OUT, 'w') as fh:
    json.dump(R, fh, indent=1, default=str)
print('S1PROBE_DONE', OUT)
