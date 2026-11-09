#!/bin/sh
# s3-attr021c.sh: every 0.30.1 replay differ id re-run on 0.21.0 corrected, same tree (kernel or guard?)
export SOLIDCRAFT_REFEREE_PKG=/home/shuff57/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg SOLIDCRAFT_TOPOLOGY_PKG=/home/shuff57/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology BREP_PKG=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/archive/brep-rs/pkg
O=/home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/s3-attr021c; mkdir -p $O; cd /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253
LK=/home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock
flock $LK timeout 3600 node /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/packages/layer/test/live-replay-extrude-pocket.mjs --out=$O/ep.json --only=$(cat /home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/s3-differ-ep.txt); echo "ep rc=$?"
flock $LK timeout 3600 node /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/packages/layer/test/live-replay-shell-draft.mjs --out=$O/sd.json --only=$(cat /home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/s3-differ-sd.txt); echo "sd rc=$?"
flock $LK timeout 3600 node /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/packages/layer/test/live-replay-booleans.mjs --all --out=$O/bool --only=$(cat /home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/s3-differ-bool.txt); echo "bool rc=$?"
flock $LK timeout 3600 node /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/packages/layer/test/live-replay-fillet-chamfer.mjs --all --out=$O/fc --only=$(cat /home/shuff57/.cache/solidcraft-0.30.1-rig/stageB/s3-differ-fc.txt); echo "fc rc=$?"
flock $LK timeout 7200 node /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253/packages/layer/test/live-replay-unified.mjs --out=$O/unified.json "--only=pf-corner-then-join"; echo "unified rc=$?"
