# sweepcmp.py <newdir> <refdir> <outids.json>: per corpus, the docs whose COM-rescored verdict or measured-feature status/refusal differ
import sys,json,os,collections
sys.path.insert(0,os.path.dirname(__file__)); from rescore import v2,load
new,ref,out=sys.argv[1:4]; ids={}; tot=collections.Counter()
def sig(r):
  return (v2(r), r.get('threw'), tuple((x['id'],x['status'],x.get('refusal')) for x in r.get('feats') or []))
for c in ['halt','ep','bool','holes','sd','pm','rg','fc','sg','mt','prim','sc','combined','rgcombined','fccombined']:
  pn=f'{new}/hr-{c}.jsonl'; pr=f'{ref}/hr-{c}.jsonl'
  if not os.path.exists(pn): print(c,'no new'); continue
  n=load(pn); r=load(pr) if os.path.exists(pr) else {}
  d=[i for i in n if i not in r or sig(n[i])!=sig(r[i])]
  ids[c]=d; vc=collections.Counter(v2(x) for x in n.values())
  print(f"{c:11s} n={len(n):5d} {dict(vc)} differ-from-ref={len(d)}")
json.dump(ids,open(out,'w'))
