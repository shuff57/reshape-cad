# pad-symmetric__long-slab: symmetric 60 mm tall slab, 2 x 50 footprint
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 0, 0, 2, 50)
    pad(body, sk, 60, 'sym')
    emit("pad-symmetric__long-slab", body)
    finish("pad-symmetric__long-slab")
except Exception:
    fail("pad-symmetric__long-slab", traceback.format_exc())
