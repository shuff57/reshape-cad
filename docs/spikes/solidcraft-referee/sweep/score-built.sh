#!/bin/sh
# score-built.sh <out dir> <corpus>...: each corpus through the host route twice with the oracles: as written (<out>/full), then cut down to the steps
# that were built (<out>/built), which is the run that judges what a case builds. For the three generators give the seeds with SEED_FROM / SEED_TO.
# Takes the rig's lock for each run. Long: a thousand generated documents take about ten minutes per pass.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); RIG=${RIG:-$HOME/.cache/solidcraft-0.30.1-rig}; OUT=$1; shift
export RIG PROBE_BLOCKED=1 PROBE_STEPS=1
mkdir -p "$OUT/full" "$OUT/built"
for c in "$@"; do
  t0=$(date +%s); flock "$RIG/rig.lock" node "$HERE/host-route-sweep.mjs" --corpus=$c --out="$OUT/full" --timeout=300 > "$OUT/full/$c.log" 2>&1; echo "full $c rc=$? $(( $(date +%s) - t0 ))s"
  node "$HERE/mkdrop.mjs" "$OUT/full" "$OUT" $c
  t0=$(date +%s); POP_SKETCHES=1 DROP_FILE="$OUT/drop-$c.json" flock "$RIG/rig.lock" node "$HERE/host-route-sweep.mjs" --corpus=$c --out="$OUT/built" --timeout=300 > "$OUT/built/$c.log" 2>&1; echo "built $c rc=$? $(( $(date +%s) - t0 ))s"
done
node "$HERE/tally.mjs" "$OUT/built" "$@"
