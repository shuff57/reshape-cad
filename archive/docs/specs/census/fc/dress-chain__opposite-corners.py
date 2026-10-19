# dress-chain__opposite-corners: chamfer 2 on top/front and top/back (parallel, no shared vertex)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,20,10], [0,20,10])], 2)
    emit("dress-chain__opposite-corners", body)
    finish("dress-chain__opposite-corners")
except Exception:
    fail("dress-chain__opposite-corners", traceback.format_exc())
