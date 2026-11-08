#!/bin/sh
# sdw-run.sh <k> <out.json> <host sweep dir 021c> <host sweep dir 030>: sdw-oracle.mjs over every dw2-* row (ALL=1) on rig k (021c | 030), on this worktree
set -u
. $HOME/.cache/solidcraft-0.21.0-rig/next-loop/we/rig.sh $1
WT=$(cd "$(dirname "$0")/../../../../.." && pwd)
cd $WT && ALL=1 WT=$WT SOLIDCRAFT_REFEREE_PKG=$PK flock $LK timeout 1800 node docs/spikes/solidcraft-referee/contract/sd-wholebody-evidence/sdw-oracle.mjs $3/hr-sd.jsonl $4/hr-sd.jsonl > $2
