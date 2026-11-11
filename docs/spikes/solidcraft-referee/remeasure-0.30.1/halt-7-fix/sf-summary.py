# sf-summary.py <cases.json> <run.jsonl> [vox bar]: the seeded family's outcome per case. Built = RIGHT when the closed form AND the voxel oracle agree with the host
# within the bar (closed form 1e-4; voxel oracle the given bar, default 1e-3; voxel COM 1e-3 of the diagonal), else WRONG. Refused cases by guard.
import json,sys,collections
cs={c['id']:c for c in json.load(open(sys.argv[1]))}; VB=float(sys.argv[3]) if len(sys.argv)>3 else 1e-3
out=collections.Counter(); wrong=[]; worst={'closed':0,'vox':0,'com':0}; f3=[]
for l in open(sys.argv[2]):
  d=json.loads(l); c=cs[d['id']]; sh=[f for f in d['feats'] if f[1]=='shell'][0]; hole=[f for f in d['feats'] if f[1]=='hole'][0]
  grp=('f3' if c.get('f3') is not None else f"k{'<' if c['k']<2 else '>='}2")
  if hole[2]!='built': key=(c['kind'],c['open'],grp,'hole refused '+str(hole[3]))
  elif sh[2]!='built': key=(c['kind'],c['open'],grp,'refused '+str(sh[3]))
  else:
    v=d['scene']['volume']; s=d['score']; dc=(v-c['closed']['P'])/c['closed']['P']
    worst['closed']=max(worst['closed'],abs(dc)); worst['vox']=max(worst['vox'],abs(s['dVol'])); worst['com']=max(worst['com'],s.get('dComOfDiag',0))
    ok=abs(dc)<=1e-4 and abs(s['dVol'])<=VB and s.get('dComOfDiag',0)<=1e-3
    key=(c['kind'],c['open'],grp,'built RIGHT' if ok else 'built WRONG')
    if not ok: wrong.append((d['id'],v,c['closed']['P'],dc,s['dVol'],s.get('dComOfDiag')))
  if c.get('f3') is not None: f3.append((d['id'],c['f3'],key[3], [r['ms'] for r in d['shellRuns']]))
  out[key]+=1
for k in sorted(out): print(k, out[k])
print('worst |host-closed|/closed %.2e, |host-voxel|/voxel %.2e, voxel COM %.2e of diag'%(worst['closed'],worst['vox'],worst['com']))
print('WRONG', wrong)
print('family 3:'); [print('  ',x) for x in f3]
ms=[r['ms'] for l in open(sys.argv[2]) for r in json.loads(l)['shellRuns']]
print('hollow kernel runs', len(ms), 'max ms', max(ms) if ms else None, 'over 10 s', sum(1 for m in ms if m>10000))
