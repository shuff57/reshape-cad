# storedcom.py <sweepdir>: the RIGHT rows the probe scored against a STORED reference with no COM (sd closed form, ep / halt3 analytic) get their COM
# checked against the group's stored OCCT run of the same doc (sd: shell-draft-runs.json, which applies the named open face; ep: ep-results.json occt,
# and the analytic COM where it has one) when that stored run agrees with the host on volume. Same bars as comscore (COM 2e-4 curved / 1e-6 planar).
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from comscore import verdict, comChecked, load, TOL
R = os.path.expanduser('~/.cache/solidcraft-0.30.1-rig')
SD = {r['id']: r for r in json.load(open(R + '/step2c/intree030/docs/spikes/solidcraft-referee/contract/shell-draft-runs.json'))['rows']}
EP = {c['id']: c for c in json.load(open(R + '/step2b/intree/docs/spikes/solidcraft-referee/contract/ep-results.json'))}
D = sys.argv[1]; res = collections.Counter(); bad = []; out = {}
for c in ['sd', 'ep', 'halt']:
  for i, r in load(f'{D}/hr-{c}.jsonl').items():
    if verdict(r) != 'RIGHT' or comChecked(r): continue
    f = r['final']; m = f.get('m') or {}; cur = bool(m.get('curved')); t = TOL['curved'] if cur else TOL['planar']; tv = 3e-4 if cur else 1e-8
    refs = []
    if c == 'sd' and i in SD: refs.append(('stored OCCT (group runner)', SD[i].get('occt') or {}))
    k = i.split(':', 1)[1] if c == 'halt' else i
    if c in ('ep', 'halt') and k in EP: refs += [('stored analytic', EP[k].get('analytic') or {}), ('stored OCCT', EP[k].get('occt') or {})]
    got = []
    for name, x in refs:
      if not x.get('com') or x.get('volume') is None or not m.get('com'): continue
      if abs(x['volume'] - m['volume']) / max(abs(x['volume']), 1) > tv: got.append((name, 'volume differs')); continue
      bb = x.get('bbox') or m['bbox']; bb = bb if len(bb) == 6 else [*bb[0], *bb[1]]
      diag = max(((bb[3] - bb[0]) ** 2 + (bb[4] - bb[1]) ** 2 + (bb[5] - bb[2]) ** 2) ** .5, 1)
      d = max(abs(a - b) for a, b in zip(m['com'], x['com'])) / diag; got.append((name, d))
    ds = [d for _, d in got if isinstance(d, float)]
    key = 'no stored COM' if not ds else ('COM-OFF' if any(d > t for d in ds) else 'COM agrees')
    res[(c, key)] += 1; out[f'{c}:{i}'] = {'judge': key, 'refs': got}
    if key == 'COM-OFF': bad.append((c, i, got))
print(dict(res)); print('COM-OFF:', bad)
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'storedcom-' + os.path.basename(D.rstrip('/')).split('-')[-1] + '.json'), 'w'), indent=1)
