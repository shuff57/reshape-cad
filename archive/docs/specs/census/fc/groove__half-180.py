# groove__half-180: the same groove, half a turn
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    circle(s1, 0, 0, 15)
    base = pad(body, s1, 30)
    g = sketch(body, 'front')
    rect(g, 12, 10, 18, 15)
    groove_x(body, g, 180)
    emit("groove__half-180", body)
    finish("groove__half-180")
except Exception:
    fail("groove__half-180", traceback.format_exc())
