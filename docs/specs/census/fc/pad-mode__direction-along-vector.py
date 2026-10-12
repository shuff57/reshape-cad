# pad-mode__direction-along-vector: custom direction (1,0,1), length along the vector itself
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, UseCustomVector=True, Direction=V(1,0,1), AlongSketchNormal=False)
    emit("pad-mode__direction-along-vector", body)
    finish("pad-mode__direction-along-vector")
except Exception:
    fail("pad-mode__direction-along-vector", traceback.format_exc())
