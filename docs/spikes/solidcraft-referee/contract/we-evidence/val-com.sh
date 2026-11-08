#!/bin/sh
# val-com.sh <k> <tree> <outdir>: the FM-1 pick-after-move/turn docs (fm1-ids-<c>.txt) and the turned-cylinder rims through host-route-com.mjs
set -u
H=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/hg; . $HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/rig.sh $1
S=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-050a04e4/docs/spikes/solidcraft-referee/contract/fm1-evidence
export WT=$2 SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP; OUT=$3; rm -rf $OUT; mkdir -p $OUT; rc=0
RIM=r-cyl-turn-x90-bottom-rim-bevel,r-cyl-turn-y90-bottom-rim-bevel,b-cyl-turn-x90-bottom-rim-bevel3,b-cyl-turn-y90-bottom-rim-bevel3
for C in fc mt sd; do
  ids=$(cat $S/fm1-ids-$C.txt); [ $C = fc ] && ids="$ids,$RIM"
  flock $LK timeout --kill-after=60 7200 node $H/host-route-com.mjs --corpus=$C --out=$OUT --only="$ids"; r=$?; echo "VAL $C rc=$r"; [ $r = 0 ] || rc=$r
done
exit $rc
