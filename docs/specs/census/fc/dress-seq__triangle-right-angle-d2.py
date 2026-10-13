# dress-seq__triangle-right-angle-d2: right-triangle prism, the 90 degree (0,0,10) corner; 3 SEPARATE chamfer features of 2, in order
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(0,20)])
    base = pad(body, s, 10)
    import math
    from collections import Counter
    NORM = {"top": (0,0,1), "bottom": (0,0,-1), "front": (0,-1,0), "back": (0,1,0), "left": (-1,0,0), "right": (1,0,0)}
    def side_norms(poly):
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            out.append((dy / L, -dx / L, 0.0))
        return out
    def eb(shape, na, nb):
        na, nb = V(*NORM.get(na, na)), V(*NORM.get(nb, nb))
        for i, e in enumerate(shape.Edges, 1):
            if type(e.Curve).__name__ != "Line": continue
            fs = shape.ancestorsOfType(e, Part.Face)
            if len(fs) != 2: continue
            n0, n1 = fs[0].normalAt(0, 0), fs[1].normalAt(0, 0)
            if ((n0 - na).Length < 1e-6 and (n1 - nb).Length < 1e-6) or ((n0 - nb).Length < 1e-6 and (n1 - na).Length < 1e-6):
                return "Edge%d" % i
        raise RuntimeError("no edge between faces %s and %s" % (na, nb))
    _emit0 = emit
    def emit(vid, b, extra=None):
        sh = b.Shape
        ex = dict(surf=dict(Counter(type(f.Surface).__name__ for f in sh.Faces)), faceAreas=sorted([[type(f.Surface).__name__, round(f.Area, 6)] for f in sh.Faces], key=lambda t: (t[0], t[1])))
        if extra: ex.update(extra)
        return _emit0(vid, b, ex)
    _sn = side_norms([(0,0),(30,0),(0,20)])
    for _w, _ax, _sg in (("front", 1, -1), ("back", 1, 1), ("left", 0, -1), ("right", 0, 1)):
        NORM[_w] = max(_sn, key=lambda n: n[_ax] * _sg)
    cur = base
    for a, b in [('top', 'front'), ('top', 'left'), ('front', 'left')]:
        cur = dress(body, 'Chamfer', cur, [eb(cur.Shape, a, b)], 2)
    emit("dress-seq__triangle-right-angle-d2", body)
    finish("dress-seq__triangle-right-angle-d2")
except Exception:
    fail("dress-seq__triangle-right-angle-d2", traceback.format_exc())
