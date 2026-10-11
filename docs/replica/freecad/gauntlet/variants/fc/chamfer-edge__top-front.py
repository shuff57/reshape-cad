# chamfer-edge__top-front: top/front edge (40 long, along X), size 2
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [40,0,10])], 2)
    emit("chamfer-edge__top-front", body)
    finish("chamfer-edge__top-front")
except Exception:
    fail("chamfer-edge__top-front", traceback.format_exc())
