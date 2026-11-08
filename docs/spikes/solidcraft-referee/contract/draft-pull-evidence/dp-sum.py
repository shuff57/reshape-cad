# dp-sum.py <dp-raw.json> <shell-draft-runs.json> > dp-results.json
# Verdict per affected row (a draft pulled along x or y, or a whole/Body Draft) and per kernel, from dp-oracle.mjs's references:
#   OCCT (corrected; counted ONCE: occtChain if the row has one, else occtOne, else occtFixed), the exact polyhedron, brep-rs (volume + box).
#   RIGHT   the host agrees with at least two of them;
#   WRONG   two of them agree with each other and the host agrees with neither;
#   NO-TWO  otherwise (refuse-worthy by the owner's rule).
# Also: which probe / stored verdicts used the referee as it is (occtBug) where it is wrong (it disagrees with the agreeing references).
import sys, json, collections
rows = json.load(open(sys.argv[1])); runs = {r['id']: r for r in json.load(open(sys.argv[2]))['rows']}
K = ['021c', '030']
def occtRef(r):
  for k in ('occtChain', 'occtOne', 'occtFixed'):
    if r.get(k) and r[k].get('volume') is not None: return k
  return None
def rel(a, b): return abs(a - b) / max(abs(b), 1)
def agree(a, b, curved, occt):
  if not a or not b or a.get('volume') is None or b.get('volume') is None: return None
  tv = 3e-4 if curved else (1e-8 if occt else 1e-9); tb = 3e-4 if curved else (2e-7 if occt else 1e-9); tc = 2e-4 if curved else 1e-6
  diag = max(((b['bbox'][3] - b['bbox'][0]) ** 2 + (b['bbox'][4] - b['bbox'][1]) ** 2 + (b['bbox'][5] - b['bbox'][2]) ** 2) ** .5, 1)
  ok = rel(a['volume'], b['volume']) <= tv and max(rel(a['bbox'][i], b['bbox'][i]) for i in range(6)) <= tb
  if a.get('com') and b.get('com'): ok = ok and max(abs(x - y) for x, y in zip(a['com'], b['com'])) / diag <= tc
  return ok
out = {'rows': [], 'counts': {}, 'refereeWrong': []}
cnt = collections.Counter()
for r in rows:
  if not r['affected']: continue
  built = [k for k in K if r['host'].get(k) and r['host'][k]['verdict'] not in (None, 'REFUSED')]
  ok_ = r.get('occtRef') or occtRef(r)
  refs = {'OCCT(' + (ok_ or '-') + ')': r.get(ok_) if ok_ else None, 'poly': r.get('poly') if r.get('poly', {}).get('volume') is not None else None, 'brep': r.get('brep') if r.get('brep', {}).get('volume') is not None else None}
  refs = {k: v for k, v in refs.items() if v}
  names = list(refs)
  pair = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if agree(refs[a], refs[b], r['curved'], True)]
  rec = {'corpus': r['corpus'], 'id': r['id'], 'drafts': r['drafts'], 'curved': r['curved'], 'refs': names, 'refsAgreeing': pair, 'verdict': {}}
  for k in K:
    if k not in built: rec['verdict'][k] = 'REFUSED' if r['host'].get(k) else 'NOT RUN'; cnt[(k, rec['verdict'][k])] += 1; continue
    m = r['host'][k]['m']
    hits = [n for n in names if agree(m, refs[n], r['curved'], n.startswith('OCCT') or n == 'brep')]
    v = 'RIGHT' if len(hits) >= 2 else ('WRONG' if pair and not hits else 'NO-TWO')
    rec['verdict'][k] = v; rec[f'hostAgrees_{k}'] = hits; cnt[(k, v)] += 1
    rec[f'probe_{k}'] = r['host'][k]['verdict']
  # the referee as it is: wrong here when it disagrees with an agreeing pair that contains no OCCT entry, or with the corrected OCCT that the pair confirms
  good = None
  for a, b in pair: good = refs[a]; break
  bug = r.get('occtBug') or {}
  if good and bug.get('volume') is not None and agree(bug, good, r['curved'], True) is False:
    st = runs.get(r['id'], {})
    rec['refereeWrong'] = {'occtBugVolume': bug['volume'], 'reference': good['volume'], 'storedOcct': (st.get('occt') or {}).get('volume'), 'storedRefKind': st.get('refKind'), 'storedOutcome': st.get('outcome')}
    out['refereeWrong'].append({'corpus': r['corpus'], 'id': r['id'], **rec['refereeWrong'], 'probeVerdict030': r['host']['030']['verdict'] if r['host'].get('030') else None, 'probeRef030': r['host']['030'].get('ref') if r['host'].get('030') else None})
  out['rows'].append(rec)
out['counts'] = {f'{k} {v}': n for (k, v), n in sorted(cnt.items())}
json.dump(out, sys.stdout, indent=1); print()
