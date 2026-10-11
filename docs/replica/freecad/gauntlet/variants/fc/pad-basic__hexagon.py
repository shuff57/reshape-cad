# pad-basic__hexagon: a regular hexagon polygon 20 across corners, 7 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    poly(sk, [(10,0),(5,8.660254038),(-5,8.660254038),(-10,0),(-5,-8.660254038),(5,-8.660254038)])
    pad(body, sk, 7, 'normal')
    emit("pad-basic__hexagon", body)
    finish("pad-basic__hexagon")
except Exception:
    fail("pad-basic__hexagon", traceback.format_exc())
