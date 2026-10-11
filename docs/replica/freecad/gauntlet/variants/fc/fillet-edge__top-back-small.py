# fillet-edge__top-back-small: top/back edge radius 0.5
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [0,30,10], [40,30,10])], 0.5)
    emit("fillet-edge__top-back-small", body)
    finish("fillet-edge__top-back-small")
except Exception:
    fail("fillet-edge__top-back-small", traceback.format_exc())
