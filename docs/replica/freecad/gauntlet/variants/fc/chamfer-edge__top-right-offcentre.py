# chamfer-edge__top-right-offcentre: top/right edge (30 long, along Y) of a block off the origin, size 1.5
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 5)
    rect(sk, -20, 10, 20, 40)
    base = pad(body, sk, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [20,10,15], [20,40,15])], 1.5)
    emit("chamfer-edge__top-right-offcentre", body)
    finish("chamfer-edge__top-right-offcentre")
except Exception:
    fail("chamfer-edge__top-right-offcentre", traceback.format_exc())
