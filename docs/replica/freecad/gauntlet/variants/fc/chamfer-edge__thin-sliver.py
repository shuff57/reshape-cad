# chamfer-edge__thin-sliver: extreme aspect: 100 x 6 x 3 bar, top/left chamfer 1
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 100, 6)
    base = pad(body, sk, 3)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,3], [0,6,3])], 1)
    emit("chamfer-edge__thin-sliver", body)
    finish("chamfer-edge__thin-sliver")
except Exception:
    fail("chamfer-edge__thin-sliver", traceback.format_exc())
