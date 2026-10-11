# fillet-edge__bottom-right-tall: bottom/right edge on a 25 tall block radius 2
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 25)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [40,0,0], [40,30,0])], 2)
    emit("fillet-edge__bottom-right-tall", body)
    finish("fillet-edge__bottom-right-tall")
except Exception:
    fail("fillet-edge__bottom-right-tall", traceback.format_exc())
