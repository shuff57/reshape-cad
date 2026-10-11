# pad-basic__side-plane-L: side plane (YZ), L-shaped polygon, 12 deep
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'side', 0)
    poly(sk, [(0,0),(30,0),(30,10),(10,10),(10,25),(0,25)])
    pad(body, sk, 12, 'normal')
    emit("pad-basic__side-plane-L", body)
    finish("pad-basic__side-plane-L")
except Exception:
    fail("pad-basic__side-plane-L", traceback.format_exc())
