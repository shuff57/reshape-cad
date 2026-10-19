# dress-chain__pentagon-big: pentagon prism, chamfer 6 on front and right
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    poly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])
    base = pad(body, s, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,10], [40,15,10])], 6)
    emit("dress-chain__pentagon-big", body)
    finish("dress-chain__pentagon-big")
except Exception:
    fail("dress-chain__pentagon-big", traceback.format_exc())
