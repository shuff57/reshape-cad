import json,glob,re,math,collections,sys  # usage: cone-bore-precheck.py SWEEPDIR
recs=[]
for f in glob.glob(sys.argv[1] + '/*.jsonl'):
    for l in open(f):
        l=l.strip()
        if l: recs.append(json.loads(l))
cone=[j for j in recs if j['cls']=='REFUSED' and 'cone can be drilled' in j.get('sentence','').split(' | ')[0]]
cnt=collections.Counter(); exact=[]
for j in cone:
    ls=j['code'].split('\n')
    m=re.match(r"let v = cone\(([\d.]+), ([\d.]+), \{ at: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}\)",ls[0])
    if not m: cnt['not a plain cone first']+=1; continue
    first=next((i for i,l in enumerate(ls) if l.startswith('hole(')),None)
    if first is None: cnt['no hole line']+=1; continue
    pre=[l.split('(')[0] for l in ls[1:first]]
    if any(p!='move' for p in pre): cnt['something other than move before the hole']+=1; continue
    body=re.match(r"hole\(v, \{(.*)\}\)$",ls[first]).group(1)
    if "along:" in body and "along: 'z'" not in body: cnt['across the axis']+=1; continue
    d,H=float(m.group(1)),float(m.group(2)); R=d/2
    rho=float(re.search(r"across: ([\d.]+)",body).group(1))/2
    at=re.search(r"at: \[(-?[\d.]+), (-?[\d.]+)\]",body)
    e=math.hypot(float(at.group(1)),float(at.group(2))) if at else 0.0
    stripped=re.sub(r"(counterbore|countersink): \{[^}]*\}","",body)
    kind='counterbore' if 'counterbore' in body else 'countersink' if 'countersink' in body else 'blind' if 'deep' in stripped else 'through'
    tail='alone' if first==len(ls)-1 else 'followed by more ops'
    tol=1e-6*R
    if e<1e-9: cnt[kind+' on the axis (different refusal)']+=1; continue
    if e+rho>=R-tol: cnt[kind+': bore leaves the base footprint']+=1; continue
    if abs(e-rho)<=tol: cnt[kind+': touches the tip']+=1; continue
    if kind=='blind':
        dp=float(re.search(r"deep: ([\d.]+)",stripped).group(1)); zf=H-dp; zmin=H*(1-(e+rho)/R)
        if zf<=tol: cnt['blind: floor at or below the base']+=1; continue
        if zf>zmin-tol: cnt['blind: floor pokes through the wall']+=1; continue
    cnt[('EXACT ' if kind in('through','blind') else 'candidate B6 ')+kind+' ('+tail+')']+=1
    exact.append((kind,tail,j['code']))
for k,v in sorted(cnt.items(),key=lambda x:-x[1]): print(f'{v:5d}  {k}')
print(sum(1 for k,t,c in exact if k in('through','blind')),'exact through/blind;',sum(1 for k,t,c in exact if k in('counterbore','countersink')),'counterbore/countersink candidates')
