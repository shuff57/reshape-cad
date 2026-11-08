#!/bin/sh
# dp-run.sh <k> <out.json> <dump dir> <sweep root>: dp-oracle.mjs on this worktree, rig k, under the rig lock
set -u
. $HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/rig.sh $1
WT=$(cd "$(dirname "$0")/../../../../.." && pwd)
cd $WT && WT=$WT SOLIDCRAFT_REFEREE_PKG=$PK flock $LK timeout 3600 node docs/spikes/solidcraft-referee/contract/draft-pull-evidence/dp-oracle.mjs $3 $4 > $2
