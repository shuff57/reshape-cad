# groove__v-notch: a triangular V groove, full turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    circle(s1, 0, 0, 15)
    base = pad(body, s1, 30)
    g = sketch(body, 'front')
    poly(g, [(13,10),(18,10),(18,20)])
    groove_x(body, g, 360)
    emit("groove__v-notch", body)
    finish("groove__v-notch")
except Exception:
    fail("groove__v-notch", traceback.format_exc())
