# revolution-mode__symmetric-120: a ring profile turned 120 degrees symmetric about the sketch plane
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 10, 0, 20, 30)
    r = body.newObject('PartDesign::Revolution', 'Rev')
    r.Profile = sk
    r.ReferenceAxis = (sk, ['V_Axis'])
    r.Angle = 120
    r.SideType = 'Symmetric'
    body.Document.recompute()
    emit("revolution-mode__symmetric-120", body)
    finish("revolution-mode__symmetric-120")
except Exception:
    fail("revolution-mode__symmetric-120", traceback.format_exc())
