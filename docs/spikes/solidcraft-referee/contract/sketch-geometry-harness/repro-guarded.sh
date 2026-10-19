#!/bin/sh
# The GUARDED run of every cases-*.mjs (SG_GUARD=1: translate-p4 + contract/sketch-geometry.guard.mjs). Output: results-guarded/<name>.json.
#   SOLIDCRAFT_REFEREE_PKG=<pkg> sh docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/repro-guarded.sh [name ...]
# The unguarded run that the "before" numbers come from is repro.sh (results/). control-noprofiles is an unguarded negative control and is not repeated here.
set -e
cd "$(dirname "$0")"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG (contract/RIG.md)}"
mkdir -p results-guarded
names="$*"; [ -n "$names" ] || names=$(ls cases-*.mjs | sed 's/^cases-//; s/\.mjs$//' | grep -v '^control-noprofiles$')
for n in $names; do
  systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 --setenv=SG_GUARD=1 --setenv=SOLIDCRAFT_REFEREE_PKG="$SOLIDCRAFT_REFEREE_PKG" bun run-group.mjs cases-$n.mjs --out=results-guarded/$n.json 2> results-guarded/$n.log
  echo "done $n"
done
