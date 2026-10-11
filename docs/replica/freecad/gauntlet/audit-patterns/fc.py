import FreeCAD, Part, json
out = {}
def run(spec):
    s = Part.makeBox(40, 20, 10, FreeCAD.Vector(-20, -10, -5))
    for o in spec:
        if o['t'] == 'cyl':
            c = Part.makeCylinder(o['r'], o['z'][1]-o['z'][0], FreeCAD.Vector(o['c'][0], o['c'][1], o['z'][0]))
            s = s.cut(c)
        else:
            lo, hi = o['lo'], o['hi']
            b = Part.makeBox(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2], FreeCAD.Vector(*lo))
            s = s.fuse(b)
    s = s.removeSplitter()
    bb = s.BoundBox
    return {'volume': s.Volume, 'bbox': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax]}
specs = json.loads(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/audit-patterns/specs.json").read())
for k, v in specs.items(): out[k] = run(v)
open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/audit-patterns/fc-results.json", 'w').write(json.dumps(out))
