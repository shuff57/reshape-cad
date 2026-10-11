# pad-symmetric__side-plane-L: symmetric on the side plane, L polygon, 7
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'side', 0)
    poly(sk, [(0,0),(20,0),(20,6),(6,6),(6,18),(0,18)])
    pad(body, sk, 7, 'sym')
    emit("pad-symmetric__side-plane-L", body)
    finish("pad-symmetric__side-plane-L")
except Exception:
    fail("pad-symmetric__side-plane-L", traceback.format_exc())
