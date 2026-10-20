#!/bin/sh
# fix round 2 runs, under the shared memory cap. Usage: run-r6.sh <phase0|r3raw|guarded> <ids or empty for all> <timeoutS> <absolute outdir>   (resumable, one case at a time; SOLIDCRAFT_REFEREE_PKG must be set)
exec "$(dirname "$0")/../booleans-r4/run-r4.sh" "$@"
