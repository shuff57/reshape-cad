#!/bin/sh
# Round-4/5 booleans runs, under the shared memory cap. Usage: run-r4.sh <phase0|r3raw|guarded> <ids or empty for all> <timeoutS> <absolute outdir>
# Resumable (--resume): a case already on disk is kept. One case at a time. SOLIDCRAFT_REFEREE_PKG must be set.
MODE=$1; IDS=$2; TO=$3; OUT=$4
cd "$(dirname "$0")/../../../../.." || exit 1
ONLY=""; [ -n "$IDS" ] && ONLY="--only=$IDS"
exec systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 env BOOL_TR="$MODE" SOLIDCRAFT_REFEREE_PKG="$SOLIDCRAFT_REFEREE_PKG" bun docs/spikes/solidcraft-referee/contract/run-booleans.mjs --all --resume $ONLY --timeout="$TO" --out="$OUT"
