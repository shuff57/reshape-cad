# pad-mode__start-offset: start 3 mm off the profile plane (FreeCAD StartType Offset); ours: the sketch lifted 3
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, StartType='Offset', StartOffset=3)
    emit("pad-mode__start-offset", body)
    finish("pad-mode__start-offset")
except Exception:
    fail("pad-mode__start-offset", traceback.format_exc())
