# sketch-face__datum-tilted-pad: a 20 x 10 rectangle on a datum plane tilted 30 degrees about X, padded 6
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    dp = datum_tilted(body, 'top', 30, 'X')
    t = sketch_on(body, dp)
    rect(t, 0, 0, 20, 10)
    pad_x(body, t, 6)
    emit("sketch-face__datum-tilted-pad", body)
    finish("sketch-face__datum-tilted-pad")
except Exception:
    fail("sketch-face__datum-tilted-pad", traceback.format_exc())
