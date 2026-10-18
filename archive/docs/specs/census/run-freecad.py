import os, traceback, glob
for f in sorted(glob.glob("/home/shuff57/Documents/GitHub/reshape-cad/docs/specs/census/fc" + '/*.py')):
    try:
        exec(compile(open(f).read(), f, 'exec'), {})
    except Exception:
        print('DRIVERFAIL', f, traceback.format_exc().strip().splitlines()[-1])
