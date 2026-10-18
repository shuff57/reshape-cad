# hole-mode__tapered-5: a tapered hole, 5 degrees
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
    h.Tapered = True
    h.TaperedAngle = 5
    doc.recompute()
    emit("hole-mode__tapered-5", body)
    finish("hole-mode__tapered-5")
except Exception:
    fail("hole-mode__tapered-5", traceback.format_exc())
