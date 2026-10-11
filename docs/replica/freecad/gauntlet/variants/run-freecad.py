# Batch driver: runs every fc/<id>.py in one FreeCAD process, each in its own namespace.
#   cd ~/Applications/freecad-rc/squashfs-root && ./AppRun freecadcmd <this file>
import os, traceback, glob
for f in sorted(glob.glob("/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/fc" + '/*.py')):
    try:
        exec(compile(open(f).read(), f, 'exec'), {})
    except Exception:
        print('DRIVERFAIL', f, traceback.format_exc().strip().splitlines()[-1])
