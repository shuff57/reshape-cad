# fillet-edge__radius-too-big: a round bigger than the plate is thick (12 on a 10 plate): both should refuse
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 40, 30)
    base = pad(body, sk, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,10], [40,0,10])], 12)
    emit("fillet-edge__radius-too-big", body)
    finish("fillet-edge__radius-too-big")
except Exception:
    fail("fillet-edge__radius-too-big", traceback.format_exc())
