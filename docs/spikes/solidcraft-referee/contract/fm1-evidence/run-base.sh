#!/bin/sh
# run-base.sh <k: 021c|030> <diff.json>: the docs a sweep changed, through the host route on the BASE tree (1ced28e3)
set -u
H=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/hg; S=$(dirname "$0"); k=$1; D=$2
export WT=$S/base-tree
if [ $k = 021c ]; then PK=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; TP=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock
else PK=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg; TP=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.30.1-rig/rig.lock; fi
OUT=$S/sweepbase-$k; rm -rf $OUT; mkdir -p $OUT; rc=0
for c in $(python3 -c "import json,sys; print(' '.join(c for c,v in json.load(open('$D')).items() if v))"); do
  ids=$(python3 -c "import json; print(','.join(json.load(open('$D'))['$c']))")
  SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP flock $LK timeout --kill-after=60 7200 node $H/host-route.mjs --corpus=$c --out=$OUT --only="$ids"; r=$?; echo "BASE $k $c rc=$r"; [ $r = 0 ] || rc=$r
done
echo EXIT=$rc
