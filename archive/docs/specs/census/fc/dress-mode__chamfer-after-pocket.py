# dress-mode__chamfer-after-pocket: chamfer 1.5 on a top edge of a plate that already has a blind pocket
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 20, 15, 5)
    k = pocket_x(body, s2, 4)
    dress(body, 'Chamfer', k, [edge_between(k.Shape, [0,0,10], [40,0,10])], 1.5)
    emit("dress-mode__chamfer-after-pocket", body)
    finish("dress-mode__chamfer-after-pocket")
except Exception:
    fail("dress-mode__chamfer-after-pocket", traceback.format_exc())
