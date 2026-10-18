# draft__neutral-mid: drafted about a plane at mid height
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    draft_x(body, base, [planar_face(base.Shape, (1,0,0))], 5, neutral_role='XY_Plane')
    emit("draft__neutral-mid", body)
    finish("draft__neutral-mid")
except Exception:
    fail("draft__neutral-mid", traceback.format_exc())
