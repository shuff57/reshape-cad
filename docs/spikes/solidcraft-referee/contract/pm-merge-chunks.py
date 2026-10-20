# Merges the per-chunk live runs of pm-run.mjs into pm-results.json + pm-results.stamp.json (round 5 regeneration).
#   usage: python3 pm-merge-chunks.py <out dir> <chunk dir> [<chunk dir> ...]   (several chunk dirs: the main run, the r4 groups, the individually run heavy cases)
#          python3 pm-merge-chunks.py --concat <out file> <chunk dir> [...]       (no previous file: a plain list of the fresh records, used for pm-results-snapoff.json)
# <chunk dir>/<chunk>/pm-results.json (+ .stamp.json) is one `bun pm-run.mjs --out=<chunk dir>/<chunk> --only=<ids>` run under a 1500 MB cap.
# A case with no fresh record (its chunk was killed by the cap or the 900 s limit) keeps the STORED record, is flagged "storedNotReplayed" in the
# stamp, and make-rows reports it; it is never counted as a pass of this round. Order = the previous pm-results.json, new ids appended.
import json, os, sys, glob, datetime
if sys.argv[1] == '--concat':
    outf, dirs = sys.argv[2], sys.argv[3:]
    recs = []
    for D in dirs:
        if os.path.isfile(D):                      # a plain json list file (pm-count-truck.mjs output)
            recs += json.load(open(D)); continue
        for d in ([D] if os.path.exists(os.path.join(D, 'pm-results.json')) else sorted(glob.glob(os.path.join(D, '*')))):
            f = os.path.join(d, 'pm-results.json')
            if os.path.exists(f): recs += json.load(open(f))
    json.dump(recs, open(outf, 'w'), indent=1); print(len(recs), 'records ->', outf); sys.exit(0)
OUT, CHS = sys.argv[1], sys.argv[2:]
H = os.path.dirname(os.path.abspath(__file__))
old = json.load(open(os.path.join(H, 'pm-results-round4-stored.json')))  # the round-4 pm-results.json (stored truck numbers, no stamp, no r4-* cases)
new = {}; stamps = []
for d in sorted(sum(([C] if os.path.exists(os.path.join(C, 'pm-results.json')) else glob.glob(os.path.join(C, '*')) for C in CHS), [])):
    f = os.path.join(d, 'pm-results.json')
    if not os.path.exists(f): continue
    for x in json.load(open(f)): new[x['id']] = x
    sf = os.path.join(d, 'pm-results.stamp.json')
    if os.path.exists(sf): stamps.append(json.load(open(sf)))
order = [x['id'] for x in old] + [i for i in new if i not in {x['id'] for x in old}]
oldm = {x['id']: x for x in old}
res = []; stored = []; changed = []
for i in order:
    if i in new:
        res.append(new[i])
        if i in oldm and (oldm[i]['outcome'] != new[i]['outcome'] or oldm[i].get('sentence') != new[i].get('sentence')): changed.append(i)
    else: res.append(oldm[i]); stored.append(i)
json.dump(res, open(os.path.join(OUT, 'pm-results.json'), 'w'), indent=1)
s0 = stamps[0]
stamp = {k: s0[k] for k in ('solidcraftPkg', 'wasmFile', 'wasmSha256', 'wasmBytes', 'solidcraftSource', 'patches', 'translator', 'budgets', 'runtime', 'host')}
assert all(s['wasmSha256'] == s0['wasmSha256'] and s['patches'] == s0['patches'] for s in stamps)
stamp.update(resultsFile='pm-results.json', merged=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).isoformat() + 'Z', chunks=len(stamps), cases=len(res), freshCases=len(new), storedNotReplayed=stored,
             cap='systemd-run MemoryMax=1500M MemorySwapMax=0, timeout 900 per chunk', changedVsPrevious=changed,
             chunkRuns=[{'written': s['written'], 'cases': s['cases'], 'argv': s['argv']} for s in stamps])
json.dump(stamp, open(os.path.join(OUT, 'pm-results.stamp.json'), 'w'), indent=1)
print(len(res), 'cases;', len(new), 'fresh;', len(stored), 'stored-not-replayed', stored, '; changed vs previous (outcome or sentence):', changed)
