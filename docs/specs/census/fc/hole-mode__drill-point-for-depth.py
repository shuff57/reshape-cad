# hole-mode__drill-point-for-depth: the same, the depth measured to the cone tip
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
    h.DrillPoint = 'Angled'
    h.DrillPointAngle = 118
    h.DrillForDepth = True
    doc.recompute()
    emit("hole-mode__drill-point-for-depth", body)
    finish("hole-mode__drill-point-for-depth")
except Exception:
    fail("hole-mode__drill-point-for-depth", traceback.format_exc())
