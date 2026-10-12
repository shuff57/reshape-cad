# pocket-mode__two-sides: two sides from a plane at z=8: 3 down, 4 up (opens on the top face)
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s1 = sketch(body, 'top')
    rect(s1, 0, 0, 40, 30)
    base = pad(body, s1, 10)
    s2 = sketch(body, 'top', 8)
    rect(s2, 15, 11, 25, 19)
    pocket_x(body, s2, 3, SideType='Two sides', Length2=4)
    emit("pocket-mode__two-sides", body)
    finish("pocket-mode__two-sides")
except Exception:
    fail("pocket-mode__two-sides", traceback.format_exc())
