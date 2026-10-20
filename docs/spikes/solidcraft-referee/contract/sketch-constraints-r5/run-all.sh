#!/bin/sh
# the whole round-5 measurement chain, one job at a time (heavy jobs), under a 16G cgroup cap.
# SOLIDCRAFT_REFEREE_PKG = the supplied referee pkg dir (solidcraft_referee.js, wasm-bindgen --target nodejs). Nothing else is needed: no wrapper2, no @sketch dump.
# round 6: SOLIDCRAFT_REFEREE_PKG must be set by the caller; MEM = cgroup cap per job (default 1500M), TMO = kill after N seconds (default 900)
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG}"
cd "$(dirname "$0")"
mkdir -p out
[ -z "$JOBS" ] && rm -f out/all-status.txt out/sentences.jsonl
export SENTENCE_LOG=$PWD/out/sentences.jsonl
run() { systemd-run --user --scope -q -p MemoryMax=${MEM:-1500M} -p MemorySwapMax=0 env SOLIDCRAFT_REFEREE_PKG="$SOLIDCRAFT_REFEREE_PKG" SENTENCE_LOG="$SENTENCE_LOG" timeout ${TMO:-900} bun "$@"; }
for j in ${JOBS:-scale sweeps floating-slot perm-test profiles-test stored-run param-grid legacy-run accuracy probes placement redundant references axes arcs-fuzz param-drags exp-arcs extras jitter underconstrained audit}; do
  case $j in
    sweeps) # round 6: in chunks of 3 fixtures (each chunk is one killable job under the TMO cap), merged into out/sweeps.json
      rm -f out/sw-*.json out/sweeps.txt; i=0
      for chunk in $(tr ',' '\n' < sweep-ids.txt | paste -d, - - -); do
        i=$((i+1)); run run-sweeps.mjs --ids=$chunk --fracs=0.8,0.4,0.15,0.035 --out=out/sw-$i.json >> out/sweeps.txt 2>&1 || echo "sweep chunk $i ($chunk) exit $?" >> out/all-status.txt
      done
      bun -e "const fs=require('fs');const a=fs.readdirSync('out').filter(f=>/^sw-\\d+\\.json$/.test(f)).sort((x,y)=>parseInt(x.slice(3))-parseInt(y.slice(3))).flatMap(f=>JSON.parse(fs.readFileSync('out/'+f,'utf8')));fs.writeFileSync('out/sweeps.json',JSON.stringify(a));console.log(a.length+' sweep records')" >> out/sweeps.txt;;
    exp-arcs) run exp-arcs.mjs > out/arcs.txt 2>&1;;
    *) run $j.mjs > out/$j.txt 2>&1;;
  esac
  echo "$j exit $?" >> out/all-status.txt
done
