# Merges the one-case-at-a-time AS-IS torus runs (scratch dir TA/<id>/pm-results.json + TA/<id>.txt, plus the exit codes in full-summary.txt)
# into pm-torus-asis.json: {id: {hung, secs, exit, line, outcome, truckVol, occtVol}}.  usage: python3 pm-merge-torus.py <scratch>
import json, os, re, sys
S = sys.argv[1]
summ = open(os.path.join(S, 'full-summary.txt')).read()
out = {}
for m in re.finditer(r'^TA (\S+) exit=(\d+) secs=(\d+)$', summ, re.M):
    i, code, secs = m.group(1), int(m.group(2)), int(m.group(3))
    rec = {'exit': code, 'secs': secs, 'hung': code == 124, 'line': '', 'outcome': None}
    txt = os.path.join(S, 'TA', i + '.txt')
    if os.path.exists(txt):
        ls = [l for l in open(txt).read().splitlines() if l.startswith(i)]
        rec['line'] = ls[0][:400] if ls else ''
    res = os.path.join(S, 'TA', i, 'pm-results.json')
    if os.path.exists(res):
        x = json.load(open(res))[0]
        rec['outcome'] = x['outcome']; t = x['fx'].get('truck') or {}
        rec['truckVol'] = t.get('volume'); rec['occtVol'] = x['fx']['occt']['volume']; rec['truckBodies'] = t.get('bodies'); rec['dVol'] = t.get('dVol'); rec['dBbox'] = t.get('dBbox')
    out[i] = rec
# optional overrides for cases re-run with a longer timeout: id=dir (dir holds pm-results.json and, for a run that was killed, done.txt with 'exit=124 secs=N')
for a in sys.argv[2:]:
    i, d = a.split('=', 1)
    rec = {'exit': 0, 'secs': None, 'hung': False, 'line': '', 'outcome': None}
    dn = os.path.join(d, 'done.txt')
    if os.path.exists(dn):
        m = re.search(r'exit=(\d+) secs=(\d+)', open(dn).read())
        if m: rec['exit'], rec['secs'], rec['hung'] = int(m.group(1)), int(m.group(2)), int(m.group(1)) == 124
    res = os.path.join(d, 'pm-results.json')
    if os.path.exists(res):
        x = json.load(open(res))[0]; t = x['fx'].get('truck') or {}
        rec.update(outcome=x['outcome'], truckVol=t.get('volume'), occtVol=x['fx']['occt']['volume'], truckBodies=t.get('bodies'), dVol=t.get('dVol'), dBbox=t.get('dBbox'), secs=rec['secs'] or round(x['fx']['ms'] / 1000))
    out[i] = rec
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pm-torus-asis.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
