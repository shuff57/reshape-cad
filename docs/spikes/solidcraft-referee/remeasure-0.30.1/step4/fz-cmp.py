# fz-cmp.py <seed>: per-case class 0.21.0c -> 0.30.1 (classified-nw*.jsonl), transition counts, the WRONG sets, and the families of 0.30.1-only WRONG
import json, sys, collections
F = '/home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/fz'; s = sys.argv[1]
a = {json.loads(l)['id']: json.loads(l) for l in open(f'{F}/classified-nw021c-s{s}.jsonl')}
b = {json.loads(l)['id']: json.loads(l) for l in open(f'{F}/classified-nw030-s{s}.jsonl')}
cases = {json.loads(l)['id']: json.loads(l) for l in open(f'{F}/cases-s{s}.jsonl')}
tr = collections.Counter((a[i]['cls'], b[i]['cls']) for i in a if i in b)
print('transitions', dict(tr))
new = [i for i in a if i in b and b[i]['cls'] == 'WRONG' and a[i]['cls'] != 'WRONG']
gone = [i for i in a if i in b and a[i]['cls'] == 'WRONG' and b[i]['cls'] != 'WRONG']
both = [i for i in a if i in b and a[i]['cls'] == 'WRONG' and b[i]['cls'] == 'WRONG']
print(f'WRONG both {len(both)}, 0.30.1 only {len(new)}, 0.21.0c only {len(gone)}')
for i in new: print('  NEW', i, a[i]['cls'], '->', b[i].get('rel'), cases[i]['desc'], 't', cases[i]['t'])
for i in gone: print('  GONE', i, '->', b[i]['cls'], (b[i].get('sentence') or '')[:80], cases[i]['desc'])
same = sum(1 for i in both if abs(a[i]['vol'] - b[i]['vol']) / b[i]['vol'] < 1e-9)
print(f'WRONG on both with the same volume (to 1e-9): {same} of {len(both)}')
fam = collections.Counter(cases[i]['desc'].split(' ')[0] + ' ' + cases[i]['family'] for i in both + new)
print('families of 0.30.1 WRONG', dict(fam))
json.dump({'transitions': {f'{k[0]}->{k[1]}': v for k, v in tr.items()}, 'wrongBoth': both, 'wrongNew030': new, 'wrongGone030': gone}, open(f'{F}/cmp-s{s}.json', 'w'), indent=1)
