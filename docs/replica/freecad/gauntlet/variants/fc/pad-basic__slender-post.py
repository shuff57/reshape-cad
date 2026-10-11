# pad-basic__slender-post: extreme aspect: 4 x 4 post, 120 tall, off the origin
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 0)
    rect(sk, 3, -8, 7, -4)
    pad(body, sk, 120, 'normal')
    emit("pad-basic__slender-post", body)
    finish("pad-basic__slender-post")
except Exception:
    fail("pad-basic__slender-post", traceback.format_exc())
