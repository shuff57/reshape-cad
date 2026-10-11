# fillet-edge__disc-rim: fillet 2 on the top rim of a cylinder 30 across, 20 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 15)
    base = pad(body, sk, 20)
    dress(body, 'Fillet', base, [circ_edge(base.Shape, 20, 15)], 2)
    emit("fillet-edge__disc-rim", body)
    finish("fillet-edge__disc-rim")
except Exception:
    fail("fillet-edge__disc-rim", traceback.format_exc())
