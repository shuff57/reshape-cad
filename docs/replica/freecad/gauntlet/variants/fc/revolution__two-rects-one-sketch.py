# revolution__two-rects-one-sketch: two profiles at different radii on one sketch, a full turn: two rings
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'front')
    rect(sk, 8, 0, 12, 20)
    rect(sk, 28, 0, 32, 20)
    revolve(body, sk, 360, 'V_Axis')
    emit_multi("revolution__two-rects-one-sketch", body)
    finish("revolution__two-rects-one-sketch")
except Exception:
    fail("revolution__two-rects-one-sketch", traceback.format_exc())
