# dress-mode__fillet-top-loop: fillet 2 on all four top edges (a closed loop)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    dress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [30,20,10], [0,20,10]), edge_between(base.Shape, [0,20,10], [0,0,10])], 2)
    emit("dress-mode__fillet-top-loop", body)
    finish("dress-mode__fillet-top-loop")
except Exception:
    fail("dress-mode__fillet-top-loop", traceback.format_exc())
