# sweepcom.py <sweepdir> [--tol-curved=x]: a host-route-com.mjs sweep, per corpus. Verdict counts (comscore.verdict), the rows RIGHT by volume+box (the old
# probe's verdict) that the COM or the closed-form/oracle split flags, the COM distribution on rows with two agreeing oracles, and the flags among those.
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comscore import verdict, load, bothAgree, comChecked, TOL
D = sys.argv[1]; tol = dict(TOL)
JS = None
for a in sys.argv[2:]:
  if a.startswith('--tol-curved='): tol['curved'] = float(a.split('=')[1])
  if a.startswith('--json='): JS = a.split('=', 1)[1]
summary = {'tol': tol, 'corpora': {}}
CS = ['halt','ep','bool','holes','sd','pm','rg','fc','sg','mt','prim','sc','combined','rgcombined','fccombined']
flag = {}; dist = collections.defaultdict(list); fp = []; unchecked = collections.Counter(); tot = collections.Counter()
for c in CS:
  p = f'{D}/hr-{c}.jsonl'
  if not os.path.exists(p): print(f'{c:11s} (not run)'); continue
  rows = load(p); vc = collections.Counter(verdict(r, tol) for r in rows.values())
  fl = []
  for i, r in rows.items():
    f = r.get('final') or {}; v = verdict(r, tol); vb = f.get('verdictVB')
    if vb in ('RIGHT', 'PIPELINE-DIFF') and v in ('COM-OFF', 'ORACLES-SPLIT'):
      fl.append({'id': i, 'verdict': v, 'vb': vb, 'dComO': (f.get('comO') or {}).get('dCom'), 'vbO': (f.get('comO') or {}).get('vb'), 'dComB': (f.get('comB') or {}).get('dCom'), 'vbB': (f.get('comB') or {}).get('vb'), 'curved': bool((f.get('m') or {}).get('curved')), 'closed': f.get('analytic')})
    if v == 'RIGHT' and not comChecked(r): unchecked[c] += 1
    if bothAgree(r, tol) and vb == 'RIGHT':
      cur = bool((f.get('m') or {}).get('curved')); d = max(f['comO']['dCom'], f['comB']['dCom'])
      dist[cur].append((d, c, i)); tot[c] += 1
      if v == 'COM-OFF': fp.append((c, i, d))
  flag[c] = fl
  summary['corpora'][c] = {'n': len(rows), 'verdicts': dict(vc), 'flagged': fl, 'rightNoComOracle': unchecked[c], 'wrongIds': sorted(i for i, r in rows.items() if verdict(r, tol) == 'WRONG')}
  print(f'{c:11s} n={len(rows):5d} {dict(vc)}  RIGHT-by-vol+box flagged: {len(fl)}  RIGHT with no COM oracle: {unchecked[c]}')
print('\nflagged rows (RIGHT by volume+box, wrong by COM or with no second oracle):')
for c, fl in flag.items():
  for x in fl: print(f"  {c:6s} {x['id']:40s} {x['verdict']:14s} dComO {x['dComO']} (vb {x['vbO']}) dComB {x['dComB']} (vb {x['vbB']}) curved {x['curved']} closed {x['closed']}")
print('\nrows with two agreeing oracles (OCCT and brep-rs agree with the host on volume+box and with each other on the COM):', sum(tot.values()))
for cur, v in dist.items():
  v.sort(); n = len(v); q = lambda p: v[min(n - 1, int(p * n))][0]
  print(f"  curved={cur} n={n} host dCom (max over the two) p50 {q(.5):.2e} p99 {q(.99):.2e} max {v[-1][0]:.2e}; top {[(f'{d:.1e}', c, i) for d, c, i in v[-5:]]}")
print(f'  flagged COM-OFF among them (false positives): {len(fp)} of {sum(tot.values())}: {fp}')
summary['twoOracleRows'] = sum(tot.values()); summary['falsePositives'] = fp
summary['noise'] = {str(cur): {'n': len(v), 'max': v[-1][0], 'p99': v[min(len(v) - 1, int(.99 * len(v)))][0], 'top': v[-5:]} for cur, v in dist.items()}
if JS: json.dump(summary, open(JS, 'w'), indent=1)
