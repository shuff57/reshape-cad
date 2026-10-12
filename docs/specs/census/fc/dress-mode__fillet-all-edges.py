# dress-mode__fillet-all-edges: fillet 2 on every edge of a 30 x 20 x 10 block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (base, [])
    f.UseAllEdges = True
    f.Radius = 2
    doc.recompute()
    emit("dress-mode__fillet-all-edges", body)
    finish("dress-mode__fillet-all-edges")
except Exception:
    fail("dress-mode__fillet-all-edges", traceback.format_exc())
