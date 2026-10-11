# pad-basic__thin-plate: extreme aspect: 200 x 120 plate, 1.5 thick, corner not at the origin
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, -100, -60, 100, 60)
    pad(body, sk, 1.5, 'normal')
    emit("pad-basic__thin-plate", body)
    finish("pad-basic__thin-plate")
except Exception:
    fail("pad-basic__thin-plate", traceback.format_exc())
