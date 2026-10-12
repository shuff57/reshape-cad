# helix__coil: a 4 across circle swept on a helix of pitch 8, height 24, radius 10
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    prof = sketch(body, 'front', 0)
    circle(prof, 10, 0, 2)
    doc.recompute()
    h = body.newObject('PartDesign::AdditiveHelix', 'Helix')
    h.Profile = prof
    h.ReferenceAxis = (prof, ['V_Axis'])
    h.Mode = 'pitch-height-angle'
    h.Pitch = 8
    h.Height = 24
    doc.recompute()
    emit("helix__coil", body)
    finish("helix__coil")
except Exception:
    fail("helix__coil", traceback.format_exc())
