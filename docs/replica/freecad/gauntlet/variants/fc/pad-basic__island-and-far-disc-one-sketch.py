# pad-basic__island-and-far-disc-one-sketch: a ring with a disc in its hole, and a third disc far away (three solids)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    circle(sk, 0, 0, 30)
    circle(sk, 0, 0, 20)
    circle(sk, 0, 0, 10)
    circle(sk, 60, 0, 5)
    pad(body, sk, 15)
    emit_multi("pad-basic__island-and-far-disc-one-sketch", body)
    finish("pad-basic__island-and-far-disc-one-sketch")
except Exception:
    fail("pad-basic__island-and-far-disc-one-sketch", traceback.format_exc())
