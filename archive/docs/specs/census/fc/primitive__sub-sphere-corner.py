# primitive__sub-sphere-corner: a subtractive 16 across sphere centred on a top corner
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    prim(body, 'Sphere', at=(0,0,10), subtractive=True, Radius=8)
    emit("primitive__sub-sphere-corner", body)
    finish("primitive__sub-sphere-corner")
except Exception:
    fail("primitive__sub-sphere-corner", traceback.format_exc())
