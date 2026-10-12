# mirrored__top-bottom-in-boss: pocket in the top of a joined boss (z 16) mirrored through z=8 onto the plate bottom
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    sb = sketch(body, 'top', 10)
    circle(sb, 20, 15, 10)
    bp = pad(body, sb, 6)
    s2 = sketch(body, 'top', 16)
    circle(s2, 20, 15, 4)
    pk = pocket(body, s2, 3)
    mirrored(body, pk, 'top', 8)
    emit("mirrored__top-bottom-in-boss", body)
    finish("mirrored__top-bottom-in-boss")
except Exception:
    fail("mirrored__top-bottom-in-boss", traceback.format_exc())
