# dress-chain__top-front-and-vertical: chamfer 2 on top/front and the vertical front/right (adjacent, different axes)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    dress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,0], [30,0,10])], 2)
    emit("dress-chain__top-front-and-vertical", body)
    finish("dress-chain__top-front-and-vertical")
except Exception:
    fail("dress-chain__top-front-and-vertical", traceback.format_exc())
