#!/bin/sh
# budget-run.sh <pin: 030|021c>: the 4 reached cases + 9 variants through the host route with the bridge's budget behaviour (hr-reach.mjs --budget)
R=$HOME/.cache/solidcraft-0.30.1-rig; S=$R/slow; export WT=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-429b33d9-8105959c9b19ef51
if [ "$1" = 030 ]; then L=$R/rig.lock; export SOLIDCRAFT_REFEREE_PKG=$R/sc-referee-pkg SOLIDCRAFT_TOPOLOGY_PKG=$R/sc-referee-pkg-topology; flock $L node $S/hr-reach.mjs $S/run13.json --budget > $S/budget-030.jsonl
else L0=$HOME/.cache/solidcraft-0.21.0-rig/rig.lock; L1=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock; export SOLIDCRAFT_REFEREE_PKG=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg SOLIDCRAFT_TOPOLOGY_PKG=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; flock $L0 flock $L1 node $S/hr-reach.mjs $S/run13.json --budget > $S/budget-021c.jsonl; fi
