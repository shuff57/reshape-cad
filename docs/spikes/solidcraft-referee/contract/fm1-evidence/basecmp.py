# basecmp.py <k>: for every doc the sweep changed against the reference sweep, base tree (1ced28e3) vs new tree, COM-rescored
import json,sys,os,collections
S=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,S); from rescore import v2,load
k=sys.argv[1]; H=os.path.expanduser('~/.cache/solidcraft-0.21.0-rig/next-loop/hg')
d=json.load(open(f'{S}/diff-{k}.json')); res={'causedByChange':{}, 'notCaused':{}}
def sig(r): return (v2(r), tuple((x['id'],x['status'],x.get('refusal')) for x in r.get('feats') or []))
for c,ids in d.items():
  if not ids: continue
  b=load(f'{S}/sweepbase-{k}/hr-{c}.jsonl'); n=load(f'{H}/sweep-fm1new-{k}/hr-{c}.jsonl')
  for i in ids:
    tgt='causedByChange' if sig(b[i])!=sig(n[i]) else 'notCaused'
    res[tgt].setdefault(c,[]).append({'id':i,'base':v2(b[i]),'new':v2(n[i]),
      'changed':[{'feature':x['id'],'base':(y['status'],y.get('refusal')),'new':(x['status'],x.get('refusal'))} for x in n[i].get('feats') or [] for y in (b[i].get('feats') or []) if y['id']==x['id'] and (y['status'],y.get('refusal'))!=(x['status'],x.get('refusal'))]})
for t in res:
  print(t, {c:collections.Counter((e['base'],e['new']) for e in v) for c,v in res[t].items()})
json.dump(res,open(f'{S}/basecmp-{k}.json','w'),indent=1)
