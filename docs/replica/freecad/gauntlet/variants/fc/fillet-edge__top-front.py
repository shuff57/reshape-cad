# fillet-edge__top-front: top/front edge radius 3
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,10], [40,0,10])], 3)
    emit("fillet-edge__top-front", body)
    finish("fillet-edge__top-front")
except Exception:
    fail("fillet-edge__top-front", traceback.format_exc())
