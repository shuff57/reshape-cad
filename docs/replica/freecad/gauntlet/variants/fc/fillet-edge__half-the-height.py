# fillet-edge__half-the-height: a large round: radius 5 of a 10 thick plate, top/right
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [40,0,10], [40,30,10])], 5)
    emit("fillet-edge__half-the-height", body)
    finish("fillet-edge__half-the-height")
except Exception:
    fail("fillet-edge__half-the-height", traceback.format_exc())
