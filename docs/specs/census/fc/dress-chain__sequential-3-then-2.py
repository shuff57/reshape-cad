# dress-chain__sequential-3-then-2: chamfer 3 on top/right then chamfer 2 on top/front
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    c1 = dress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10])], 3)
    dress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [27,0,10])], 2)
    emit("dress-chain__sequential-3-then-2", body)
    finish("dress-chain__sequential-3-then-2")
except Exception:
    fail("dress-chain__sequential-3-then-2", traceback.format_exc())
