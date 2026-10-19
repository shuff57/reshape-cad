# Census step 1: FreeCAD's own inventory of PartDesign features, their properties and every enumeration, by introspection.
# Run: ./AppRun freecadcmd docs/specs/census/inventory.py   (isolated HOME/XDG_*)
import json, os
import FreeCAD as App
import Part, Sketcher

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inventory.json')
doc = App.newDocument('inv')
body = doc.addObject('PartDesign::Body', 'Body')
KINDS = ['Pad', 'Pocket', 'Revolution', 'Groove', 'Hole', 'Fillet', 'Chamfer', 'Draft', 'Thickness', 'AdditiveLoft', 'SubtractiveLoft',
         'AdditivePipe', 'SubtractivePipe', 'AdditiveHelix', 'SubtractiveHelix', 'LinearPattern', 'PolarPattern', 'Mirrored',
         'MultiTransform', 'Boolean', 'AdditiveBox', 'AdditiveCylinder', 'AdditiveSphere', 'AdditiveCone', 'AdditiveEllipsoid',
         'AdditiveTorus', 'AdditivePrism', 'AdditiveWedge', 'SubtractiveBox', 'SubtractiveCylinder', 'SubtractiveSphere',
         'SubtractiveCone', 'SubtractiveEllipsoid', 'SubtractiveTorus', 'SubtractivePrism', 'SubtractiveWedge', 'Plane', 'Line',
         'Point', 'CoordinateSystem', 'ShapeBinder', 'SubShapeBinder', 'Clone']
SKIP = {'Label', 'Label2', 'Visibility', 'Proxy', 'ExpressionEngine', 'Placement', 'Shape', 'AddSubShape', 'BaseFeature',
        'Group', 'ShowInTree', 'AttacherType', 'AttacherEngine', 'Material', 'Tip', 'Origin', 'OriginFeatures'}
R = {'freecad': list(App.Version())[:4], 'features': {}, 'commands': None}
for k in KINDS:
    try:
        o = body.newObject('PartDesign::' + k, k) if k not in ('Plane', 'Line', 'Point', 'CoordinateSystem', 'ShapeBinder', 'SubShapeBinder', 'Clone') \
            else doc.addObject('PartDesign::' + k, k)
    except Exception as e:  # noqa
        R['features'][k] = dict(error=str(e)[:120])
        continue
    props = {}
    for p in o.PropertiesList:
        if p in SKIP:
            continue
        d = dict(type=o.getTypeIdOfProperty(p), group=o.getGroupOfProperty(p))
        try:
            en = o.getEnumerationsOfProperty(p)
            if en:
                d['enum'] = list(en)
        except Exception:
            pass
        try:
            v = getattr(o, p)
            if isinstance(v, (int, float, bool, str)):
                d['default'] = v
        except Exception:
            pass
        if d['group'] in ('Base', 'Attachment', 'Part Design', 'Pad', 'Pocket', 'Hole', 'Revolution', 'Groove', 'Fillet', 'Chamfer',
                         'Draft', 'Thickness', 'Loft', 'Pipe', 'Helix', 'Pattern', 'Boolean', 'Primitive', 'Mirrored', 'Part Design Plane',
                         'Transform', '') or 'enum' in d or True:
            props[p] = d
    R['features'][k] = dict(typeId=o.TypeId, props=props)
json.dump(R, open(OUT, 'w'), indent=1)
print('wrote', OUT, len(R['features']))
