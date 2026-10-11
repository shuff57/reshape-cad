# chamfer-edge__large-size: a big chamfer: 9 of a 10 thick plate, top/back
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,30,10], [40,30,10])], 9)
    emit("chamfer-edge__large-size", body)
    finish("chamfer-edge__large-size")
except Exception:
    fail("chamfer-edge__large-size", traceback.format_exc())
