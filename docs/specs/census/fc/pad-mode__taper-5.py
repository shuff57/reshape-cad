# pad-mode__taper-5: taper angle 5 degrees on a 30 x 20 x 10 pad
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, TaperAngle=5)
    emit("pad-mode__taper-5", body)
    finish("pad-mode__taper-5")
except Exception:
    fail("pad-mode__taper-5", traceback.format_exc())
