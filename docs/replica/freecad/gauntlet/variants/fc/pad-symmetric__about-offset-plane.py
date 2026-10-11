# pad-symmetric__about-offset-plane: symmetric about the plane z=12 (sketch offset 12)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top', 12)
    rect(sk, 0, 0, 30, 20)
    pad(body, sk, 8, 'sym')
    emit("pad-symmetric__about-offset-plane", body)
    finish("pad-symmetric__about-offset-plane")
except Exception:
    fail("pad-symmetric__about-offset-plane", traceback.format_exc())
