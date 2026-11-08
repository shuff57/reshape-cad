# validate.py <valdir-prefix>: host-route-com.mjs on the pre-FM-1 tree (7183ea8f), the FM-1 pick-after-move/turn docs and the turned-cylinder rims.
# Known wrong = FM-1's base verdict COM-OFF or WRONG (fm1-host-route.json, rescored against OCCT, then refused by de674503 / ef650230); known right = its RIGHT.
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from comscore import verdict, load
S = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(f'{S}/../fm1-evidence/fm1-host-route.json'))['picksAfterMoveTurn']['docs']
P = sys.argv[1]; out = {}
for k in ['021c', '030']:
  new = {}
  for c in ['fc', 'mt', 'sd']:
    for i, r in load(f'{P}-{k}/hr-{c}.jsonl').items(): new[f'{c}:{i}'] = r
  cnt = collections.Counter(); miss = []; wrongD = []
  for key, v in D.items():
    b = v[k]['base']['v']; nv = verdict(new[key]); cnt[f'{b} -> {nv}'] += 1
    flagged = nv in ('COM-OFF', 'WRONG', 'ORACLES-SPLIT')
    if b in ('COM-OFF', 'WRONG') and not flagged: miss.append((key, b, nv))
    if b == 'RIGHT' and nv != 'RIGHT': miss.append((key, b, nv))
  rims = {x: verdict(new[x]) for x in new if 'bottom-rim' in x}
  out[k] = {'counts': dict(cnt), 'rims': rims, 'misses': miss}
  print(k, dict(cnt), 'rims', collections.Counter(rims.values()), 'misses', miss)
json.dump(out, open(f'{S}/validate.json', 'w'), indent=1)
