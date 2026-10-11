# chamfer-edge__bottom-back: bottom/back edge on a taller block, size 3
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 20)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,30,0], [40,30,0])], 3)
    emit("chamfer-edge__bottom-back", body)
    finish("chamfer-edge__bottom-back")
except Exception:
    fail("chamfer-edge__bottom-back", traceback.format_exc())
