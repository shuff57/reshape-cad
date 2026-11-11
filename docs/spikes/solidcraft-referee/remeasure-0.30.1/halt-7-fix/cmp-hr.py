# cmp-hr.py <base dir> <new dir> <corpora...>: every row of the host-route COM sweep, baseline vs fix tree. Prints the hollow-with-hole verdict counts, every row
# whose verdict or any feature's status/guard changed, and every non-RIGHT/REFUSED verdict among the hollow-with-hole rows now.
import json,sys,collections
B,N=sys.argv[1],sys.argv[2]
tot=collections.Counter()
for c in sys.argv[3:]:
  def load(d):
    m={}
    for l in open(f'{d}/hr-{c}.jsonl'):
      r=json.loads(l); m[(r['i'],r['id'])]=r
    return m
  b,n=load(B),load(N)
  hs=0; vb=collections.Counter(); vn=collections.Counter(); changed=[]
  for k,rn in n.items():
    rb=b.get(k)
    ks=[x['kind'] for x in rn.get('feats') or []]
    isHS='hole' in ks and 'shell' in ks
    st=lambda r:[(x['id'],x['status'],x['guard']) for x in r.get('feats') or []]
    v=lambda r:(r.get('final') or {}).get('verdict') or ('HANG' if r.get('hang') else 'CRASH' if r.get('crashed') else None)
    if isHS: hs+=1; vb[v(rb) if rb else None]+=1; vn[v(rn)]+=1
    if rb is None or v(rb)!=v(rn) or st(rb)!=st(rn): changed.append((k[1],isHS,v(rb) if rb else 'MISSING',v(rn),[x for x in st(rn) if x not in (st(rb) if rb else [])]))
  print(f'== {c}: rows {len(n)} (base {len(b)}), hollow-with-hole {hs}; verdicts base {dict(vb)} now {dict(vn)}; rows changed {len(changed)}')
  for x in changed: print('   CHANGED', x)
  tot['rows']+=len(n); tot['hs']+=hs; tot['changed']+=len(changed)
print('TOTAL', dict(tot))
