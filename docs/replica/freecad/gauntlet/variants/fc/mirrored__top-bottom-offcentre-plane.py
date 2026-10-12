# mirrored__top-bottom-offcentre-plane: circle pocket 3 deep mirrored through z=6: the copy is a sealed void (z 2 to 5) inside the plate
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pk = pocket(body, s2, 3)
    mirrored(body, pk, 'top', 6)
    emit("mirrored__top-bottom-offcentre-plane", body)
    finish("mirrored__top-bottom-offcentre-plane")
except Exception:
    fail("mirrored__top-bottom-offcentre-plane", traceback.format_exc())
