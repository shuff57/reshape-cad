# S1 probe B: does a switched-off coincident still let FreeCAD close the sketch wire / make a pad?
# Measures; asserts nothing. Output: JSON next to this file. Run with freecadcmd.
import json, os
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe_s1b_inactive_weld.json')
R = {'freecad': list(App.Version())[:4], 'cases': {}}
doc = App.newDocument('s1b')
V = App.Vector


def rect(name, off):
    sk = doc.addObject('Sketcher::SketchObject', name)
    pts = [(0, 0), (40, 0), (40, 25), (0, 25)]
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', i, 2, (i + 1) % 4, 1))
    if off is not None:
        sk.setActive(off, False)
    doc.recompute()
    return sk


for label, off in [('all active', None), ('coincident 0 off', 0), ('coincident 3 off', 3)]:
    sk = rect('S%s' % (label.replace(' ', '_')), off)
    sh = sk.Shape
    case = dict(solve=sk.solve(), dof=sk.DoF, wires=len(sh.Wires), edges=len(sh.Edges),
                closed=[w.isClosed() for w in sh.Wires])
    try:
        body = doc.addObject('PartDesign::Body', 'B%s' % (label.replace(' ', '_')))
        body.addObject(sk)
        pad = body.newObject('PartDesign::Pad', 'P%s' % (label.replace(' ', '_')))
        pad.Profile = sk
        pad.Length = 10
        doc.recompute()
        case['pad_valid'] = pad.isValid()
        case['pad_volume'] = pad.Shape.Volume if pad.Shape and not pad.Shape.isNull() else None
        case['pad_state'] = list(pad.State)
    except Exception as e:  # noqa
        case['pad_error'] = str(e)
    R['cases'][label] = case

json.dump(R, open(OUT, 'w'), indent=1)
print(json.dumps(R, indent=1))
