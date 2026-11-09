#!/usr/bin/env bash
# Stage B step 3 (resume 5): the 9 live-replay evidence sets on the 0.30.1 pkg, HEAD of the stage-B worktree.
# Every set resumes at case level:
#   bool rg fc      run-live-replays.sh (one row file per case, OUT/cases; the loop resumes the missing ids itself)
#   ep holes sd pm  attempt N runs --only=<ids not yet in parts 1..N-1> (ids: the 0.21.0 evidence rows); parts merged by merge-live-replay.mjs
#   unified         attempt N runs --skip=<pairs in the merged base> (merge-unified.mjs skip / merge)
#   mp              live-moved-picks.mjs (254 generated cases, ~minutes); re-run whole on a cut
# Each attempt: flock on the rig lock, systemd scope with a memory cap, timeout. Every step writes a line to stageB-state.tsv and EXIT= to its log.
# Evidence: $OUT/<set>/final.json (never the repo's 0.21.0 files); copied as *-0.30.1.json by hand afterwards.
set -u
R=$HOME/.cache/solidcraft-0.30.1-rig
WT=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253
T=$WT/packages/layer/test; EV=$T/evidence
OUT=$R/stageB/s3; mkdir -p $OUT
export SOLIDCRAFT_RIG=$R SOLIDCRAFT_REFEREE_PKG=$R/sc-referee-pkg SOLIDCRAFT_TOPOLOGY_PKG=$R/sc-referee-pkg-topology
export BREP_PKG=$WT/archive/brep-rs/pkg
cd $WT || exit 2
st() { printf '%s\t3\t%s\t%s\t%s\n' "$(date -Is)" "$1" "$2" "$3" >> $R/stageB-state.tsv; echo "$(date +%T) $1 $2 $3"; }
cap() { local mem=$1 to=$2; shift 2; flock $R/rig.lock systemd-run --user --scope -q -p MemoryMax=$mem -p MemorySwapMax=0 timeout --kill-after=120 $to "$@"; }
done_ok() { [ -s "$1" ] && ! grep -q '"partial": *true' "$1"; }

# ---- ep holes sd pm: parts + merge ----
parts() { # set script evidence mem timeout
  local s=$1 script=$2 ev=$3 mem=$4 to=$5 d=$OUT/$1; mkdir -p $d
  if done_ok $d/final.json; then st $s SKIP final-present; return 0; fi
  node -e "const j=require('$EV/$ev');process.stdout.write([...new Set(j.rows.map(r=>r.id))].join('\n')+'\n')" > $d/all-ids.txt
  local n=0
  for n in 1 2 3 4 5 6; do
    local p=$d/part-$n.json
    if done_ok $p; then continue; fi
    local donefile=$d/done-ids.txt; : > $donefile
    for q in $d/part-*.json; do [ -s "$q" ] && node -e "const j=JSON.parse(require('fs').readFileSync('$q','utf8'));for(const r of j.rows??[])console.log(r.id)" >> $donefile 2>/dev/null; done
    local only=; if [ $n -gt 1 ]; then only=$(grep -vxF -f $donefile $d/all-ids.txt | paste -sd, -); [ -z "$only" ] && break; fi
    # a cut part keeps its rows (partial file) for the next attempt's done list; rename it so the next attempt writes a fresh file
    st $s "START part $n" "$( [ -n "$only" ] && echo "$(echo "$only" | tr -cd , | wc -c)+1 ids" || echo all)"
    local t0=$(date +%s)
    cap $mem $to node $T/$script --out=$p ${only:+--only=$only} > $d/part-$n.log 2>&1; local rc=$?
    echo "EXIT=$rc" >> $d/part-$n.log
    st $s "part $n rc=$rc" "$(( $(date +%s) - t0 ))s"
    if [ $rc = 0 ] || [ $rc = 1 ]; then
      if grep -q '"partial": *true' $p 2>/dev/null; then st $s "part $n" "rc=$rc but partial"; continue; fi
      break
    fi
    [ -s $p ] && node -e "const f='$p',fs=require('fs');const j=JSON.parse(fs.readFileSync(f,'utf8'));j.partial=false;j.cutPart=true;fs.writeFileSync(f,JSON.stringify(j))"
  done
  local ps=$(ls $d/part-*.json | sort -V)
  if [ $(echo "$ps" | wc -l) = 1 ]; then cp $ps $d/final.json; else node $T/merge-live-replay.mjs $d/final.json $ps > $d/merge.log 2>&1; echo "EXIT=$?" >> $d/merge.log; fi
  local miss=$(node -e "const j=require('$d/final.json');const s=new Set(j.rows.map(r=>r.id));const a=require('fs').readFileSync('$d/all-ids.txt','utf8').trim().split('\n');console.log(a.filter(i=>!s.has(i)).length)")
  st $s DONE "final rows=$(node -e "console.log(require('$d/final.json').rows.length)") missing-vs-0.21.0=$miss"
}

# ---- unified: --skip + merge-unified ----
unified() {
  local d=$OUT/unified; mkdir -p $d
  if done_ok $d/final.json; then st unified SKIP final-present; return 0; fi
  for n in 1 2 3 4 5 6; do
    local p=$d/part-$n.json skip=
    if [ -s $d/base.json ]; then node $T/merge-unified.mjs skip $d/base.json $d/skip-$n.json > /dev/null; skip=--skip=$d/skip-$n.json; fi
    st unified "START part $n" "${skip:-all}"
    local t0=$(date +%s)
    cap 2G 86400 node $T/live-replay-unified.mjs --out=$p $skip > $d/part-$n.log 2>&1; local rc=$?
    echo "EXIT=$rc" >> $d/part-$n.log
    st unified "part $n rc=$rc" "$(( $(date +%s) - t0 ))s"
    if [ -s $p ]; then
      if [ -s $d/base.json ]; then node $T/merge-unified.mjs merge $d/base.next.json $d/base.json $p --partial > $d/merge-$n.log 2>&1 && mv $d/base.next.json $d/base.json; else cp $p $d/base.json; fi
    fi
    if { [ $rc = 0 ] || [ $rc = 1 ]; } && ! grep -q '"partial": *true' $p; then break; fi
  done
  cp $d/base.json $d/final.json && node $T/merge-unified.mjs final $d/final.json > $d/final.log 2>&1
  st unified DONE "$(cat $d/final.log)"
}

want() { [ -z "${ONLY:-}" ] || [[ ",$ONLY," == *",$1,"* ]]; }
want ep    && parts ep    live-replay-extrude-pocket.mjs   live-replay-extrude-pocket-0.21.0.json   3G 21600
want sd    && parts sd    live-replay-shell-draft.mjs      live-replay-shell-draft-0.21.0.json      3G 21600
want holes && parts holes live-replay-holes.mjs            live-replay-holes-0.21.0.json            3G 21600
if want mp; then
  d=$OUT/mp; mkdir -p $d
  if [ -s $d/final.json ]; then st mp SKIP final-present; else
    for n in 1 2 3; do st mp "START $n" all; t0=$(date +%s)
      cap 2G 21600 node $T/live-moved-picks.mjs --out=$d/final.json > $d/run-$n.log 2>&1; rc=$?; echo "EXIT=$rc" >> $d/run-$n.log
      st mp "rc=$rc" "$(( $(date +%s) - t0 ))s"; { [ $rc = 0 ] || [ $rc = 1 ]; } && break; rm -f $d/final.json; done
  fi
fi
want pm    && parts pm    live-replay-patterns-mirror.mjs  live-replay-patterns-mirror-0.21.0.json  1500M 36000
if want loop; then
  # bool rg fc: the loop's own case-level resume (LOOP_ATTEMPTS each); evidence into $OUT/loop-evidence, never the repo
  mkdir -p $OUT/loop-evidence $OUT/loop
  st loop START "run-live-replays.sh --keep-going --only=bool,rg,fc"
  flock $R/rig.lock env LAYER_EVIDENCE=$OUT/loop-evidence LAYER_LOOP_DIR=$OUT/loop bash $T/run-live-replays.sh --keep-going --only=bool,rg,fc > $OUT/loop.log 2>&1; rc=$?
  echo "EXIT=$rc" >> $OUT/loop.log; st loop "rc=$rc" done
fi
want unified && unified
st all DONE -
