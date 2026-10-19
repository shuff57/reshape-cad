#!/bin/sh
# the whole round-5 measurement chain, one job at a time (heavy jobs), under a 16G cgroup cap.
# SOLIDCRAFT_REFEREE_PKG = the supplied referee pkg dir (solidcraft_referee.js, wasm-bindgen --target nodejs). Nothing else is needed: no wrapper2, no @sketch dump.
S=/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad
export SOLIDCRAFT_REFEREE_PKG=${SOLIDCRAFT_REFEREE_PKG:-$S/sc-referee-pkg}
cd "$(dirname "$0")"
mkdir -p out
rm -f out/all-status.txt out/sentences.jsonl
export SENTENCE_LOG=$PWD/out/sentences.jsonl
run() { systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun "$@"; }
for j in ${JOBS:-sweeps perm-test profiles-test stored-run param-grid legacy-run accuracy probes placement redundant references axes arcs-fuzz param-drags exp-arcs extras jitter underconstrained audit}; do
  case $j in
    sweeps) run run-sweeps.mjs --fracs=0.8,0.4,0.15,0.035 --out=out/sweeps.json > out/sweeps.txt 2>&1;;
    exp-arcs) run exp-arcs.mjs > out/arcs.txt 2>&1;;
    *) run $j.mjs > out/$j.txt 2>&1;;
  esac
  echo "$j exit $?" >> out/all-status.txt
done
