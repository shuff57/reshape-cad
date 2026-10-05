#!/usr/bin/env python3
"""Bucket a sweep's REFUSED scripts by capability (one bucket per script, by the first refusal sentence), then break the pair-family
booleans down by shape pair and operation.   usage: buckets.py SWEEPDIR
The bucket names are the plan's vocabulary (docs/specs/PLAN-kernel-next-2026-10-05.md)."""
import json, glob, re, sys, collections
d = sys.argv[1]
recs = []
for f in glob.glob(d + '/*.jsonl'):
    for l in open(f):
        l = l.strip()
        if l: recs.append(json.loads(l))
print('classes:', dict(collections.Counter(j['cls'] for j in recs)))
ref = [j for j in recs if j['cls'] == 'REFUSED']
def bucket(j):
    s = j.get('sentence', ''); c = j['code']; first = s.split(' | ')[0]; sph = 'sphere(' in c
    if first.startswith('hole') and 'cone can be drilled' in first: return 'hole in a cone'
    if first.startswith('hole') and 'cannot cut this hole yet' in first:
        return 'hole in a sphere (remaining)' if sph else 'hole, other (see census-hole-interactions.mjs)'
    if first.startswith('hole') and 'rounded, chamfered' in first: return 'hole reaching a rounded face'
    if first.startswith('hole') and 'bore across the side of a round' in first: return 'hole across a round part'
    if first.startswith('The recess'): return 'recess wider than the part'
    if 'can only hollow' in first: return 'hollow of a shape other than box/cylinder'
    if first.startswith('pattern') and 'copies overlap' in first: return 'pattern whose copies overlap'
    if first.startswith('combine') and 'cannot boolean' in first:
        if sph: return 'boolean involving a sphere'
        if 'cone(' in c: return 'boolean involving a cone'
        if 'ring(' in c: return 'boolean involving a torus'
        return 'boolean, other'
    if 'edge could not be found' in first: return 'fillet/chamfer: edge not found'
    if 'can only round' in first or 'can only chamfer' in first: return 'round/chamfer an edge that is not plain'
    if 'cannot round a flat edge' in first or 'cannot chamfer a flat edge' in first: return 'round/chamfer a flat edge'
    if 'same shape in the same place' in first: return 'cut leaves nothing'
    if 'does not touch the part' in first: return 'cutter does not touch'
    if 'only touch along a line' in first: return 'touching solids'
    if 'cannot find' in first: return 'cascade from an earlier refusal'
    return 'other: ' + first[:60]
cnt = collections.Counter(); ex = {}
for j in ref:
    b = bucket(j); cnt[b] += 1; ex.setdefault(b, j['code'].replace('\n', ' ; ')[:150])
tot = sum(cnt.values())
print('\nREFUSED by capability (%d):' % tot)
for b, n in cnt.most_common(): print('%5d %4.1f%%  %s\n         e.g. %s' % (n, 100 * n / tot, b, ex[b]))
agg = collections.Counter()
for j in recs:
    if j['family'] != 'pair': continue
    k = re.findall(r'(?:let v|const p1) = (\w+)\(', j['code']); op = re.search(r'v = (\w+)\(v, p1\)', j['code'])
    if len(k) == 2 and op: agg[('x'.join(sorted(k)), op.group(1), j['cls'])] += 1
print('\npair family: REFUSED / total per (pair, op)')
keys = sorted(set((a, b) for a, b, _ in agg))
for a, b in sorted(keys, key=lambda k: -agg[(k[0], k[1], 'REFUSED')])[:24]:
    t = sum(v for (x, y, _), v in agg.items() if (x, y) == (a, b))
    print('  %3d/%3d  %s %s' % (agg[(a, b, 'REFUSED')], t, a, b))
