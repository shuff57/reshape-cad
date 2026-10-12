# groove__quarter-90: the same groove, a quarter turn
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
    groove_x(body, g, 90)
    emit("groove__quarter-90", body)
    finish("groove__quarter-90")
except Exception:
    fail("groove__quarter-90", traceback.format_exc())
