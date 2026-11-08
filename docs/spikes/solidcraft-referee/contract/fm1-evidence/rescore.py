# rescore.py: host-route rows with the feature-level centre-of-mass check against OCCT that the probe's verdict drops (it passes on f.ok OR scene.ok,
# and the scene score carries no COM). COM_TOL as sg-core.mjs: planar 1e-6, curved 3e-5 of the OCCT box diagonal.
import json
TOL={'planar':1e-6,'curved':3e-5}
def v2(r):
  f=r.get('final') or {}; v=f.get('verdict') or ('THREW' if r.get('threw') else None)
  if v!='RIGHT': return v
  sO=f.get('sO') or {}; ff=sO.get('f') or {}
  d=ff.get('dCom'); m=f.get('m') or {}
  if d is not None and d>(TOL['curved'] if m.get('curved') else TOL['planar']): return 'COM-OFF'
  return v
def load(p):
  return {r['id']:r for r in map(json.loads,open(p))}
