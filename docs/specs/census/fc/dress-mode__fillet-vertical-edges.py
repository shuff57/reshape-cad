# dress-mode__fillet-vertical-edges: fillet 3 on the four vertical edges of a block (rounded rectangle corners)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,0], [0,0,10]), edge_between(base.Shape, [30,0,0], [30,0,10]), edge_between(base.Shape, [0,20,0], [0,20,10]), edge_between(base.Shape, [30,20,0], [30,20,10])], 3)
    emit("dress-mode__fillet-vertical-edges", body)
    finish("dress-mode__fillet-vertical-edges")
except Exception:
    fail("dress-mode__fillet-vertical-edges", traceback.format_exc())
