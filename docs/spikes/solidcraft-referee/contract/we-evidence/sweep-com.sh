#!/bin/sh
# sweep-com.sh <k> <tree> <outdir> [corpora...]: every corpus (or the ones named) through hg/host-route-com.mjs on <tree>, rig k (021c | 030)
set -u
H=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/hg; . $HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/rig.sh $1
export WT=$2 SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP; OUT=$3; mkdir -p $OUT; shift 3
CS=${*:-halt ep bool holes sd pm rg fc sg mt prim sc combined rgcombined fccombined}
rc=0
for c in $CS; do
  t0=$(date +%s); flock $LK timeout --kill-after=120 43200 node $H/host-route-com.mjs --corpus=$c --out=$OUT; r=$?
  echo "CORPUS $c rc=$r $(( $(date +%s) - t0 ))s"; [ $r = 0 ] || rc=$r
done
exit $rc
