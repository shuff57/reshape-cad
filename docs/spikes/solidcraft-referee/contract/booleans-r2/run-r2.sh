#!/bin/sh
# Round-2 booleans runs. Usage: run-r2.sh <raw|guarded> <ids|group:normal|group:hang> <timeoutS> <outdir>
# One case at a time (run-booleans.mjs --all spawns one child per case), under the memory cap.
MODE=$1; IDS=$2; TO=$3; OUT=$4
cd "$(dirname "$0")/../../../../.." || exit 1
if [ "$MODE" = guarded ]; then export BOOL_TR=guarded; else unset BOOL_TR; fi
exec systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/run-booleans.mjs --all --only="$IDS" --timeout="$TO" --out="$OUT"
