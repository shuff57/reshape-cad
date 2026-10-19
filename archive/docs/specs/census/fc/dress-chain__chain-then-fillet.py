# dress-chain__chain-then-fillet: chamfer 2 on top/right and top/front, then fillet 1 on top/back
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    c1 = dress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [0,0,10], [30,0,10])], 2)
    dress(body, 'Fillet', c1, [edge_between(c1.Shape, [0,20,10], [28,20,10])], 1)
    emit("dress-chain__chain-then-fillet", body)
    finish("dress-chain__chain-then-fillet")
except Exception:
    fail("dress-chain__chain-then-fillet", traceback.format_exc())
