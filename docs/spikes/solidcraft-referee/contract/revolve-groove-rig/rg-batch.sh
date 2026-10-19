#!/bin/bash
# One heavy process per case, each under systemd-run memory caps and a wall-clock timeout, results merged in <outdir>/<id>.json.
# usage: SOLIDCRAFT_REFEREE_PKG=<pkg dir> bash rg-batch.sh <translator g0|g4|raw0|raw4> <outdir> <timeout seconds> <id> [id...]
# (paths are relative to the repo root found from this file; nothing is hardcoded to a session directory)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG to the wasm-bindgen --target nodejs pkg dir}"
trn=$1; out=$2; to=$3; shift 3
mkdir -p "$out"; cd "$REPO"
for id in "$@"; do
  timeout "$to" systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 \
    bun "$HERE/rg-run.mjs" --translator="$trn" --only="$id" --out="$out" --res="$id.json" > "$out/$id.txt" 2>&1
  echo "$id exit=$? $(date +%T)" >> "$out/_status.txt"
done
echo ALLDONE >> "$out/_status.txt"
