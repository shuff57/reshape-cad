#!/bin/sh
# Round-3 booleans runs. Usage: run-r3.sh <phase0|r3raw|guarded> <ids> <timeoutS> <absolute outdir>
# One case at a time (run-booleans.mjs --all spawns one child per case), under the memory cap. SOLIDCRAFT_REFEREE_PKG must be set.
MODE=$1; IDS=$2; TO=$3; OUT=$4
cd "$(dirname "$0")/../../../../.." || exit 1
exec systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env BOOL_TR="$MODE" BOOL_FAST="${BOOL_FAST:-}" SOLIDCRAFT_REFEREE_PKG="$SOLIDCRAFT_REFEREE_PKG" bun docs/spikes/solidcraft-referee/contract/run-booleans.mjs --all --only="$IDS" --timeout="$TO" --out="$OUT"
