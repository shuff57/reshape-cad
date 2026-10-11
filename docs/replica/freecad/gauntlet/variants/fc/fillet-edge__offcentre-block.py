# fillet-edge__offcentre-block: top/left edge, block off the origin, radius 4
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 2)
    rect(sk, -30, -10, 10, 20)
    base = pad(body, sk, 12)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [-30,-10,14], [-30,20,14])], 4)
    emit("fillet-edge__offcentre-block", body)
    finish("fillet-edge__offcentre-block")
except Exception:
    fail("fillet-edge__offcentre-block", traceback.format_exc())
