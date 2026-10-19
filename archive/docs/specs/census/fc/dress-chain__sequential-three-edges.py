# dress-chain__sequential-three-edges: chamfer 2 top/right, then 2 top/front, then 2 top/back as three features
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    c1 = dress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10])], 2)
    c2 = dress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [28,0,10])], 2)
    dress(body, 'Chamfer', c2, [edge_between(c2.Shape, [0,20,10], [28,20,10])], 2)
    emit("dress-chain__sequential-three-edges", body)
    finish("dress-chain__sequential-three-edges")
except Exception:
    fail("dress-chain__sequential-three-edges", traceback.format_exc())
