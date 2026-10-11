# fillet-edge__L-prism-top-right: fillet 2 on the top/right edge of an L-shaped prism (the right-most face is x=30)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    poly(sk, [(0,0),(30,0),(30,10),(10,10),(10,25),(0,25)])
    base = pad(body, sk, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [30,0,10], [30,10,10])], 2)
    emit("fillet-edge__L-prism-top-right", body)
    finish("fillet-edge__L-prism-top-right")
except Exception:
    fail("fillet-edge__L-prism-top-right", traceback.format_exc())
