#!/bin/sh
# the whole round-3 measurement chain, one job at a time (heavy jobs), under a 16G cgroup cap. SOLIDCRAFT_REFEREE_PKG2 = wrapper2 pkg dir.
S=/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad
export SOLIDCRAFT_REFEREE_PKG2=${SOLIDCRAFT_REFEREE_PKG2:-$S/scr2/pkg2}
cd "$(dirname "$0")"
mkdir -p out
rm -f out/all-status.txt out/sentences.jsonl
export SENTENCE_LOG=$PWD/out/sentences.jsonl
run() { systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun "$@"; }
run run-sweeps.mjs --fracs=0.8,0.4,0.15,0.035 --out=out/sweeps.json > out/sweeps.txt 2>&1; echo "sweeps exit $?" >> out/all-status.txt
for j in perm-test profiles-test stored-run param-grid legacy-run accuracy probes placement redundant references axes arcs-fuzz param-drags; do
  run $j.mjs > out/$j.txt 2>&1; echo "$j exit $?" >> out/all-status.txt
done
run exp-arcs.mjs > out/arcs.txt 2>&1; echo "exp-arcs exit $?" >> out/all-status.txt
run audit.mjs > out/audit.txt 2>&1; echo "audit exit $?" >> out/all-status.txt
