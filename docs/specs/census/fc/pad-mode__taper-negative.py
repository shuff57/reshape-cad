# pad-mode__taper-negative: taper angle -8 (the section grows)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, TaperAngle=-8)
    emit("pad-mode__taper-negative", body)
    finish("pad-mode__taper-negative")
except Exception:
    fail("pad-mode__taper-negative", traceback.format_exc())
