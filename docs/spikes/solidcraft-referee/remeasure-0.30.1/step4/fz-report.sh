#!/bin/sh
# fz-report.sh <seed>: normalise the raw wasm rows to the CLI's 60 s rule (any run over 60 s = timeout; the first 021c pass used 120 s), keep the every-4 ids, classify with fuzz/report.mjs
F=$HOME/.cache/solidcraft-0.30.1-rig/stageB/fz; s=$1
for t in w021c w030; do python3 - $F $t $s <<'PY'
import json, sys
F, t, s = sys.argv[1:4]
out = open(f'{F}/cli-n{t}-s{s}.jsonl', 'w')
for l in open(f'{F}/cli-{t}-s{s}.jsonl'):
  r = json.loads(l)
  for k in ('base', 'shell'):
    if (r[k].get('ms') or 0) > 60000: r[k] = {'status': 'timeout', 'ms': r[k]['ms'], 'was': r[k]['status']}
  out.write(json.dumps(r) + '\n')
PY
done
cd /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/docs/spikes/solidcraft-referee/fuzz && FZ=$F node report.mjs --seed $s --bins nw021c=0.21.0c,nw030=0.30.1 --basetag nw021c --idfile $F/every4-s$s.txt --out $F/summary-s$s.json
