#!/bin/bash
# One heavy process per case (rg-run.mjs --cases=<module>), each under systemd-run memory caps and a wall-clock timeout; per-case json in <outdir>/<id>.json, status in <outdir>/_status.txt.
# usage: SOLIDCRAFT_REFEREE_PKG=<pkg> [RG3_SEED=.. RG3_N=..] bash rg3-batch.sh <cases module, relative to this dir> <translator g0|g4|raw0|raw4> <outdir> <timeout s> <id> [id...]
# A case that hits the timeout leaves no json: the merge step records it as TIMEOUT.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG}"
cases=$1; trn=$2; out=$3; to=$4; shift 4
mkdir -p "$out"; cd "$REPO"
for id in "$@"; do
  [ -f "$out/$id.json" ] && continue
  timeout "$to" systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 \
    bun "$HERE/rg-run.mjs" --cases="$cases" --translator="$trn" --only="$id" --out="$out" --res="$id.json" > "$out/$id.txt" 2>&1
  echo "$id exit=$? $(date +%T)" >> "$out/_status.txt"
done
echo ALLDONE >> "$out/_status.txt"
