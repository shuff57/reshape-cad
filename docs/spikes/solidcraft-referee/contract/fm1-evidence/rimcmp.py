import json,sys,os,collections
S=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,S); from rescore import v2,load
k=sys.argv[1]; H=os.path.expanduser('~/.cache/solidcraft-0.21.0-rig/next-loop/hg')
ids=json.load(open(f'{S}/rim-ids.json'))
def sig(r): return (v2(r), r.get('threw'), tuple((x['id'],x['status'],x.get('refusal')) for x in r.get('feats') or []))
tot=0; ch=[]
for c,v in ids.items():
  a=load(f'{H}/sweep-fm1new-{k}/hr-{c}.jsonl'); b=load(f'{S}/rim-{k}/hr-{c}.jsonl')
  miss=[i for i in v if i in a and i not in b]
  if miss: print('MISSING',c,len(miss))
  for i in v:
    if i in a and i in b:
      tot+=1
      if sig(a[i])!=sig(b[i]): ch.append((c,i,v2(a[i]),v2(b[i]),[ (x['id'],x['status'],(x.get('refusal') or '')[:80]) for x in b[i]['feats'] if x['status']=='refused'][:1]))
print(k,'compared',tot,'changed',len(ch))
for x in ch: print('  ',x)
cyl=[i for i in ids['fc'] if 'cyl-turn' in i and ('x90' in i or 'y90' in i)]
b=load(f'{S}/rim-{k}/hr-fc.jsonl')
print('  turned-cylinder rims:',collections.Counter(('bottom' if 'bottom' in i else 'top', v2(b[i])) for i in cyl))
