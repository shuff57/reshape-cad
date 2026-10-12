# pad-mode__up-to-face: a 6 across post padded up to the underside of a plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top', 10)
    rect(s1, -20, -20, 20, 20)
    base = pad(body, s1, 5)
    s2 = sketch(body, 'top', 0)
    circle(s2, 0, 0, 3)
    pad_x(body, s2, 5, Type='UpToFace', UpToFace=(base, [planar_face(base.Shape, (0,0,-1), -10)]))
    emit("pad-mode__up-to-face", body)
    finish("pad-mode__up-to-face")
except Exception:
    fail("pad-mode__up-to-face", traceback.format_exc())
