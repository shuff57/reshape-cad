# sketch-face__pocket-on-side-face: a 6 across, 8 deep pocket from a sketch on the right face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    t = sketch_on(body, base, planar_face(base.Shape, (1,0,0)))
    circle(t, 10, 5, 3)
    pocket_x(body, t, 8)
    emit("sketch-face__pocket-on-side-face", body)
    finish("sketch-face__pocket-on-side-face")
except Exception:
    fail("sketch-face__pocket-on-side-face", traceback.format_exc())
