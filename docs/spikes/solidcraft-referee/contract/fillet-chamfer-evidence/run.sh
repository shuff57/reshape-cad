#!/bin/bash
# usage: SOLIDCRAFT_REFEREE_PKG=<pkg> run.sh <out-name> [from-case-id]
# One process, all cases from <from-case-id>; resumes with --from after a hang. Heavy: one at a time, memory-capped.
cd "$(dirname "$0")"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG}"
export STAGEFILE=$PWD/stage-$1.txt
timeout 3000 systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun drive.mjs --out=$PWD/out --res=res-$1.json ${2:+--from=$2} >> log-$1.txt 2>&1
echo "EXIT $? last: $(cut -c1-800 $STAGEFILE)" >> log-$1.txt
