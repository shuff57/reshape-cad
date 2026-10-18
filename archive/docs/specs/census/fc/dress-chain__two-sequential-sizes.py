# dress-chain__two-sequential-sizes: chamfer 2 on top/right then, as a later feature, chamfer 3 on top/front
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    c1 = dress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10])], 2)
    base = c1
    dress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [28,0,10])], 3)
    emit("dress-chain__two-sequential-sizes", body)
    finish("dress-chain__two-sequential-sizes")
except Exception:
    fail("dress-chain__two-sequential-sizes", traceback.format_exc())
