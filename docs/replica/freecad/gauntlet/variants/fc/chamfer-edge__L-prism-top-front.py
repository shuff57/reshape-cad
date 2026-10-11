# chamfer-edge__L-prism-top-front: chamfer 2 on the top/front edge of an L-shaped prism (the front-most face is y=0)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    poly(sk, [(0,0),(30,0),(30,10),(10,10),(10,25),(0,25)])
    base = pad(body, sk, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 2)
    emit("chamfer-edge__L-prism-top-front", body)
    finish("chamfer-edge__L-prism-top-front")
except Exception:
    fail("chamfer-edge__L-prism-top-front", traceback.format_exc())
