#!/bin/sh
# page-half.sh <out dir> <corpus>...: only the PAGE part of score-built.sh, against a Node run made before into the same <out dir> (its full/ and built/,
# with the same corpora and settings). For a change to the page that the Node passes already cover (2026-11-21: allowCopies set in pane.js, after
# sweep-all.sh with ALLOW_COPIES=1), so the hours of Node passes are not run again. Needs PAGE=<site folder> (e.g. the rig's student-preview).
#   PAGE=~/.cache/solidcraft-0.30.1-rig/student-preview sh page-half.sh ~/.cache/copies-sweep-2026-11-20/all/corpora holes sd mt combined rgcombined fccombined
set -u
HERE=$(cd "$(dirname "$0")" && pwd); RIG=${RIG:-$HOME/.cache/solidcraft-0.30.1-rig}; OUT=$1; shift
: "${PAGE:?PAGE=<site folder> is needed}"
export RIG PROBE_BLOCKED=1 PROBE_STEPS=1 PROBE_NO_ACROSS=1 # the page's settings (pane.js), as score-built.sh
mkdir -p "$OUT/page" "$OUT/cases"
NAMES=""
for spec in "$@"; do
  SEED_FROM=""; SEED_TO=""; extra=""
  case "$spec" in
    file=*) f=${spec#file=}; c=file; name=$(basename "$f" .json); extra="--cases=$f --name=$name" ;;
    *@*) c=${spec%@*}; r=${spec#*@}; SEED_FROM=${r%-*}; SEED_TO=${r#*-}; name=$c ;;
    *) c=$spec; name=$c ;;
  esac
  NAMES="$NAMES $name"
  ( export DUMP_FILE="$OUT/cases/$name.json"; [ -n "$SEED_FROM" ] && export SEED_FROM SEED_TO; node "$HERE/host-route-sweep.mjs" --corpus=$c $extra --out="$OUT/cases" --no-oracle --child ) > "$OUT/cases/$name.log" 2>&1
  t0=$(date +%s); flock "$RIG/rig.lock" node "$HERE/page-run.mjs" "$PAGE" "$OUT/page/$name.jsonl" off "$OUT/cases/$name.json" > "$OUT/page/$name.log" 2>&1; echo "page $name rc=$? $(( $(date +%s) - t0 ))s"
done
echo "-- the page against the full pass, step by step"; node "$HERE/page-vs-node.mjs" "$OUT/page" "$OUT/full" "$OUT/page-vs-node.json" $NAMES
echo "-- the page's final volume against the judged solid"; node "$HERE/page-vs-built.mjs" "$OUT/page" "$OUT/built" $NAMES
