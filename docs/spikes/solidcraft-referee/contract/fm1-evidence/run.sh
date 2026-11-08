#!/bin/sh
# run.sh: the fc, mt and sd pick-after-move/turn docs (ids in fm1-host-route.json) through the host route on both rigs; WT is the tree under test. Needs fm1-ids-<c>.txt beside it (one comma list per corpus).
set -u
H=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/hg; S=$(dirname "$0"); OUT=$S/new/fm1-out
export WT=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-dbcf8306
rc=0
for C in fc mt sd; do for k in 021c 030; do
  if [ $k = 021c ]; then PK=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; TP=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock
  else PK=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg; TP=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.30.1-rig/rig.lock; fi
  rm -rf $OUT-$C-$k; mkdir -p $OUT-$C-$k
  SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP flock $LK timeout --kill-after=60 7200 node $H/host-route.mjs --corpus=$C --out=$OUT-$C-$k --only="$(cat $S/fm1-ids-$C.txt)"; r=$?
  echo "RIG $C $k rc=$r"; [ $r = 0 ] || rc=$r
done; done
echo EXIT=$rc
