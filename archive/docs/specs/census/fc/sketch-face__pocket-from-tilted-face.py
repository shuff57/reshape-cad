# sketch-face__pocket-from-tilted-face: a 6 across, 4 deep pocket from a sketch on a datum plane tilted 20 degrees through a plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    dp = datum_tilted(body, 'top', 20, 'X', 10)
    t = sketch_on(body, dp)
    circle(t, 20, 12, 3)
    pocket_x(body, t, 4)
    emit("sketch-face__pocket-from-tilted-face", body)
    finish("sketch-face__pocket-from-tilted-face")
except Exception:
    fail("sketch-face__pocket-from-tilted-face", traceback.format_exc())
