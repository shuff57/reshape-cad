# mirrored__top-bottom-pocket: pocket mirrored across the horizontal plane z=5 (FreeCAD can; the script says a parallel plane is refused)
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
    mirrored(body, pk, 'top', 5)
    emit("mirrored__top-bottom-pocket", body)
    finish("mirrored__top-bottom-pocket")
except Exception:
    fail("mirrored__top-bottom-pocket", traceback.format_exc())
