# comscore.py: the host-route-com.mjs verdict, recomputed from a row's recorded fields at a given COM tolerance (so a tolerance study and rows written by
# an earlier revision of the probe score alike). verdictVB = the old probe's verdict (volume + box only); comO / comB = per oracle {vb, com, dCom}.
import json
TOL = {'planar': 1e-6, 'curved': 2e-4}
def load(p):
  return {r['id']: r for r in map(json.loads, open(p))}
def verdict(r, tol=TOL):
  f = r.get('final') or {}
  v = f.get('verdict') or ('THREW' if r.get('threw') else ('HANG' if r.get('hang') else ('CRASH' if r.get('crashed') else None)))
  if 'verdictVB' not in f: return v
  vb = f['verdictVB']; curved = bool((f.get('m') or {}).get('curved'))
  t = tol['curved'] if curved else tol['planar']
  xs = [x for x in (f.get('comO'), f.get('comB'), f.get('comR')) if x and x.get('vb') is True and x.get('dCom') is not None]
  if any(x['dCom'] > t for x in xs) and vb in ('RIGHT', 'PIPELINE-DIFF', 'RIGHT(expect refuse)'): return 'COM-OFF'
  if vb == 'RIGHT' and r.get('corpus') == 'fc' and f.get('analytic') is not None and (f.get('okO') is False or f.get('okB') is False): return 'ORACLES-SPLIT'
  return vb
def comChecked(r):
  f = r.get('final') or {}
  return any(x and x.get('vb') is True and x.get('dCom') is not None for x in (f.get('comO'), f.get('comB'), f.get('comR')))
def bothAgree(r, tol=TOL):
  # OCCT and brep-rs both agree with the host on volume+box, and their own COMs agree with each other: a row with two oracles
  f = r.get('final') or {}; o, b = f.get('comO') or {}, f.get('comB') or {}
  s = f.get('oracleComSplit')
  return o.get('vb') is True and b.get('vb') is True and o.get('dCom') is not None and b.get('dCom') is not None and s is not None and not s['split']
