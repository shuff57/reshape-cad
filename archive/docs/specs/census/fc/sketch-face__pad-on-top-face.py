# sketch-face__pad-on-top-face: a 10 x 8 boss 5 high padded from a sketch on the top face of a block
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    base = pad(body, s, 10)
    t = sketch_on(body, base, planar_face(base.Shape, (0,0,1)))
    rect(t, 10, 6, 20, 14)
    pad_x(body, t, 5)
    emit("sketch-face__pad-on-top-face", body)
    finish("sketch-face__pad-on-top-face")
except Exception:
    fail("sketch-face__pad-on-top-face", traceback.format_exc())
