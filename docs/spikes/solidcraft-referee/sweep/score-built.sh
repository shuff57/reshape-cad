#!/bin/sh
# score-built.sh <out dir> <corpus>...: each corpus through the host route twice with the oracles: as written (<out>/full), then cut down to the steps
# that were built (<out>/built), which is the run that judges what a case builds. Ends with the tally: known rows, and NEW ones (exit code 1 if any).
#   a corpus is:  holes | sd | mt | ...            one of the harness's own
#                 combined@600-1100                a generator with its seeds (from, to); without the seeds, the corpus's own
#                 file=/path/to/cases.json         your own cases ({ id, script } or { id, doc }); named after the file
#   PAGE=<site folder>   also run every case in the REAL page as shipped (page-run.mjs; <site> serves host.html, e.g. the rig's student-preview), then
#                        compare the page with the full pass step by step (page-vs-node.mjs) and its final volume with the judged solid (page-vs-built.mjs)
# Takes the rig's lock for each run. Long: a thousand generated documents take about ten minutes per Node pass and about half an hour in the page.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); RIG=${RIG:-$HOME/.cache/solidcraft-0.30.1-rig}; OUT=$1; shift
export RIG PROBE_BLOCKED=1 PROBE_STEPS=1
mkdir -p "$OUT/full" "$OUT/built"; [ -n "${PAGE:-}" ] && mkdir -p "$OUT/page" "$OUT/cases"
NAMES=""
for spec in "$@"; do
  SEED_FROM=""; SEED_TO=""; extra=""
  case "$spec" in
    file=*) f=${spec#file=}; c=file; name=$(basename "$f" .json); extra="--cases=$f --name=$name" ;;
    *@*) c=${spec%@*}; r=${spec#*@}; SEED_FROM=${r%-*}; SEED_TO=${r#*-}; name=$c ;;
    *) c=$spec; name=$c ;;
  esac
  NAMES="$NAMES $name"
  run() { ( [ -n "$SEED_FROM" ] && export SEED_FROM SEED_TO; flock "$RIG/rig.lock" node "$HERE/host-route-sweep.mjs" --corpus=$c $extra "$@" ); }
  t0=$(date +%s); run --out="$OUT/full" --timeout=300 > "$OUT/full/$name.log" 2>&1; echo "full $name rc=$? $(( $(date +%s) - t0 ))s"
  node "$HERE/mkdrop.mjs" "$OUT/full" "$OUT" $name
  t0=$(date +%s); ( export POP_SKETCHES=1 DROP_FILE="$OUT/drop-$name.json"; run --out="$OUT/built" --timeout=300 ) > "$OUT/built/$name.log" 2>&1; echo "built $name rc=$? $(( $(date +%s) - t0 ))s"
  if [ -n "${PAGE:-}" ]; then
    ( export DUMP_FILE="$OUT/cases/$name.json"; [ -n "$SEED_FROM" ] && export SEED_FROM SEED_TO; node "$HERE/host-route-sweep.mjs" --corpus=$c $extra --out="$OUT/cases" --no-oracle --child ) > "$OUT/cases/$name.log" 2>&1
    t0=$(date +%s); flock "$RIG/rig.lock" node "$HERE/page-run.mjs" "$PAGE" "$OUT/page/$name.jsonl" off "$OUT/cases/$name.json" > "$OUT/page/$name.log" 2>&1; echo "page $name rc=$? $(( $(date +%s) - t0 ))s"
  fi
done
rc=0
node "$HERE/tally.mjs" "$OUT/built" $NAMES || rc=1
if [ -n "${PAGE:-}" ]; then
  echo "-- the page against the full pass, step by step"; node "$HERE/page-vs-node.mjs" "$OUT/page" "$OUT/full" "$OUT/page-vs-node.json" $NAMES
  echo "-- the page's final volume against the judged solid"; node "$HERE/page-vs-built.mjs" "$OUT/page" "$OUT/built" $NAMES
fi
exit $rc
