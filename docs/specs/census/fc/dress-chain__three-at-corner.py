# dress-chain__three-at-corner: chamfer 2 on the three edges meeting at the (30,0,10) corner
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,0], [30,0,10])], 2)
    emit("dress-chain__three-at-corner", body)
    finish("dress-chain__three-at-corner")
except Exception:
    fail("dress-chain__three-at-corner", traceback.format_exc())
