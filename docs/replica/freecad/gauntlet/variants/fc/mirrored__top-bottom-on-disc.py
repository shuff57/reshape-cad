# mirrored__top-bottom-on-disc: pocket in a 60 across disc mirrored through z=5
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk1 = sketch(body, 'top')
    circle(sk1, 0, 0, 30)
    base = pad(body, sk1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 0, 4)
    pk = pocket(body, s2, 3)
    mirrored(body, pk, 'top', 5)
    emit("mirrored__top-bottom-on-disc", body)
    finish("mirrored__top-bottom-on-disc")
except Exception:
    fail("mirrored__top-bottom-on-disc", traceback.format_exc())
