# mitresum.py <mitre-k.json> <sweepcom-k.json>: the mitre oracle's verdict on the flagged fc rows and on the triaged fc WRONG rows.
# two-oracle RIGHT = host within the curved bars of BOTH the closed form and the OCCT intersection (volume 3e-4, COM 2e-4 of the diagonal), and those two agree
import json, sys, collections
M = {r['id']: r for r in json.load(open(sys.argv[1]))}; S = json.load(open(sys.argv[2]))
def judge(r):
  if r is None: return 'not a plain blend chain on one box'
  c, o = r.get('closed') or {}, r.get('occtIntersect')
  if not c.get('volume'): return 'closed: ' + (c.get('why') or 'none') + ('; OCCT∩ only' if o else '')
  if not o: return 'closed only (OCCT∩ did not build)'
  ok = lambda dv, dc: dv is not None and dc is not None and dv <= 3e-4 and dc <= 2e-4
  if ok(r['dVolClosed'], r['dComClosed']) and ok(r['dVolOI'], r['dComOI']) and (r['dComClosedVsOI'] or 0) <= 1e-6: return 'RIGHT by two oracles'
  return 'DISAGREE'
flag = [x['id'] for x in S['corpora']['fc']['flagged']]; wrong = S['corpora']['fc']['wrongIds']
out = {}
for name, ids in (('flagged', flag), ('wrong', wrong)):
  j = {i: judge(M.get(i)) for i in ids}; out[name] = j
  print(name, len(ids), dict(collections.Counter(j.values())))
  for i, v in j.items():
    if v == 'DISAGREE': print('   DISAGREE', i, M[i])
  if name == 'flagged':
    for i, v in j.items():
      if v != 'RIGHT by two oracles': print('   ', i, v)
worst = max((M[i]['dComClosed'], i) for i in flag if M.get(i) and M[i].get('dComClosed') is not None)
print('worst host-vs-closed COM on flagged:', worst)
json.dump(out, open(sys.argv[1].replace('.json', '-judged.json'), 'w'), indent=1)
