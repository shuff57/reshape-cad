# groove__at-the-end: a rebate flush with the post end (z 25..30)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    circle(s1, 0, 0, 15)
    base = pad(body, s1, 30)
    g = sketch(body, 'front')
    rect(g, 12, 25, 18, 30)
    groove_x(body, g, 360)
    emit("groove__at-the-end", body)
    finish("groove__at-the-end")
except Exception:
    fail("groove__at-the-end", traceback.format_exc())
