# hole-simple__hexagon-prism: a 8 hole through the middle of a hexagonal prism 40 across corners, 12 tall
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
try:
    doc, body = setup()
    sk = sketch(body, 'top')
    poly(sk, [(20,0),(10,17.320508076),(-10,17.320508076),(-20,0),(-10,-17.320508076),(10,-17.320508076)])
    base = pad(body, sk, 12)
    hs = sketch(body, 'top', 12)
    circle(hs, 0, 0, 4)
    hole(body, hs, 8)
    emit("hole-simple__hexagon-prism", body)
    finish("hole-simple__hexagon-prism")
except Exception:
    fail("hole-simple__hexagon-prism", traceback.format_exc())
