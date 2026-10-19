#!/bin/sh
# usage: run.sh <spec-name-without-ext> [extra sweep args]   (runs from contract/, one heavy job at a time)
cd "$(dirname "$0")/.." || exit 1
n=$1; shift
SOLIDCRAFT_REFEREE_PKG=${SOLIDCRAFT_REFEREE_PKG:-/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/sc-referee-pkg} systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun primitives-sweep.mjs --spec=primitives-r4/$n.mjs --out=primitives-r4/results/$n.json "$@"
