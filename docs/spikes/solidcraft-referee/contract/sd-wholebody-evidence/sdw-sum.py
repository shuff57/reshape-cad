# sdw-sum.py <sdw-raw.json> <shell-draft-runs.json> <storedcom-030.json> > sdw-results.json
# Scores sdw-oracle.mjs's rows: the 53 (the dw2 rows storedcom.py left with no COM reference because the stored OCCT volume differs), every dw2 row
# the host builds, the rows it refuses, and the cause of the stored-OCCT disagreement (does the referee's own Body Draft, re-run, give the stored number?).
import sys, json, re, collections
raw = [r for r in json.load(open(sys.argv[1])) if 'why' not in r]
runs = {r['id']: r for r in json.load(open(sys.argv[2]))['rows']}
sc = json.load(open(sys.argv[3]))
the53 = sorted(k[3:] for k, v in sc.items() if k.startswith('sd:dw2') and v['judge'] == 'no stored COM')
K = ['021c', '030']
rel = lambda a, b: abs(a - b) / max(abs(b), 1)
ok = lambda r, f: all((r.get(f'{f}_{k}') or {}).get('ok') for k in K)
worst = lambda rs, f: max([max((r.get(f'{f}_{k}') or {}).get(x) or 0 for k in K for x in ('dVol', 'dBox', 'dCom')) for r in rs] or [None])
built = lambda r: all(r['host'][k]['verdict'] == 'RIGHT' for k in K)
by = {r['id']: r for r in raw}
out = {'what': 'GUARD-SD-WHOLEBODY: live references for the sd whole-body drafts (sdw-oracle.mjs), scored at host-route-com.mjs planar bars (volume 1e-9, 1e-8 vs OCCT; box 1e-9, 2e-7 vs OCCT; COM 1e-6 of the diagonal)'}

# the 53
r53 = [by[i] for i in the53]
out['the53'] = {
  'ids': the53, 'n': len(r53),
  'hostBuiltRightBothRigs': sum(built(r) for r in r53),
  'agreeOcctOneCall': sum(ok(r, 'hostVsOcctOne') for r in r53), 'worstVsOcctOneCall': worst(r53, 'hostVsOcctOne'),
  'agreePolyhedron': sum(ok(r, 'hostVsPoly') for r in r53), 'worstVsPolyhedron': worst(r53, 'hostVsPoly'),
  'polyhedronVsOcctOneCall': max(max(r['polyVsOcctOne'][x] for x in ('dVol', 'dBox', 'dCom')) for r in r53),
  'simpsonVsPolyhedronVolume': max(r['simpsonVsPoly'] for r in r53),
  'sideQuadNonPlanarity': max(r['poly']['sideNonPlanarity'] for r in r53),
  'brepRefuses': collections.Counter(r['brep'].get('refused') for r in r53),
  'refereeBodyDraftEqualsStored': sum(rel(r['occtSeq']['volume'], runs[r['id']]['occt']['volume']) < 1e-9 for r in r53),
  'sequentialReFoundFacesAgreeOneCall': sum(rel(r['occtSeqRe']['volume'], r['occtOne']['volume']) < 1e-9 for r in r53),
  'sequentialReFoundFacesOcctRefusedAFace': [r['id'] for r in r53 if r['occtSeqRe'].get('skipped')],
}
# every dw2 row
groups = collections.Counter(); notRef = []
for r in raw:
  st = runs.get(r['id'], {}).get('occt', {})
  stDiff = st.get('volume') is not None and (r['simpson'] or {}).get('volume') is not None and rel(st['volume'], r['simpson']['volume']) > 1e-6
  seqEq = st.get('volume') is not None and r['occtSeq'].get('volume') is not None and rel(r['occtSeq']['volume'], st['volume']) < 1e-9
  curved = re.match(r'^dw2-(cylinder|extrude-circle)', r['id']) is not None
  if built(r):
    key = ('built', 'curved side (one-call variant drafts planar faces only: not a reference)' if curved else ('OCCT one-call agrees' if ok(r, 'hostVsOcctOne') else 'OCCT one-call differs'), 'stored OCCT differs from the closed form' if stDiff else 'stored OCCT agrees', 'referee Body Draft = stored' if seqEq else 'referee Body Draft != stored')
    if not curved and not ok(r, 'hostVsOcctOne'): notRef.append({'id': r['id'], 'host': r['host']['030']['m']['volume'], 'occtOneCall': r['occtOne'].get('volume'), 'closed': (r['simpson'] or {}).get('volume'), 'd': r.get('hostVsOcctOne_030')})
  else:
    key = ('refused by the host', 'OCCT one-call refuses' if not r['occtOne'].get('volume') else 'OCCT one-call builds', 'closed form / polyhedron: vanish' if ((r['simpson'] or {}).get('vanish') or (r.get('poly') or {}).get('vanish')) else 'no vanish (refused for another reason)')
  groups[' | '.join(key)] += 1
out['allDw2'] = {'n': len(raw), 'groups': dict(groups), 'builtPlanarOcctOneCallDiffers': notRef}
json.dump(out, sys.stdout, indent=1, default=str); print()
