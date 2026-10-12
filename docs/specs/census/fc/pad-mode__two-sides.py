# pad-mode__two-sides: two sides: 10 one way, 4 the other
REFS_DIR = "/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/refs"
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc_prelude.py").read())
exec(open("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/census-prelude.py").read())
try:
    doc, body = setup()
    s = sketch(body, 'top')
    rect(s, 0, 0, 30, 20)
    pad_x(body, s, 10, SideType='Two sides', Length2=4)
    emit("pad-mode__two-sides", body)
    finish("pad-mode__two-sides")
except Exception:
    fail("pad-mode__two-sides", traceback.format_exc())
