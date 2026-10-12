# pad-mode__direction-45: custom direction (1,0,1), length along the sketch normal
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, UseCustomVector=True, Direction=V(1,0,1))
    emit("pad-mode__direction-45", body)
    finish("pad-mode__direction-45")
except Exception:
    fail("pad-mode__direction-45", traceback.format_exc())
