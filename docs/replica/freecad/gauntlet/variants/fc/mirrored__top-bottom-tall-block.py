# mirrored__top-bottom-tall-block: pocket 5 deep in a 20 thick block, mirrored through z=10 onto its bottom face
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 20)
    s2 = sketch(body, 'top', 20)
    rect(s2, 8, 8, 24, 20)
    pk = pocket(body, s2, 5)
    mirrored(body, pk, 'top', 10)
    emit("mirrored__top-bottom-tall-block", body)
    finish("mirrored__top-bottom-tall-block")
except Exception:
    fail("mirrored__top-bottom-tall-block", traceback.format_exc())
