# hole-mode__counterdrill: a counterdrill (a conical recess)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 3)
    h = body.newObject('PartDesign::Hole', 'Hole')
    h.Profile = s2
    h.Threaded = False
    h.Diameter = 6
    h.DepthType = 'Dimension'
    h.Depth = 7
    h.DrillPoint = 'Flat'
    h.HoleCutType = 'Counterdrill'
    h.HoleCutDiameter = 10
    h.HoleCutDepth = 3
    doc.recompute()
    emit("hole-mode__counterdrill", body)
    finish("hole-mode__counterdrill")
except Exception:
    fail("hole-mode__counterdrill", traceback.format_exc())
