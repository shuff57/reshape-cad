# mirrored__top-bottom-through: a through pocket mirrored through z=5: the copy is the same hole again
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 10)
    circle(s2, 10, 15, 3)
    pk = pocket(body, s2, None, through=True)
    mirrored(body, pk, 'top', 5)
    emit("mirrored__top-bottom-through", body)
    finish("mirrored__top-bottom-through")
except Exception:
    fail("mirrored__top-bottom-through", traceback.format_exc())
