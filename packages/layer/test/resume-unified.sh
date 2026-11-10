#!/usr/bin/env bash
# Finish the unified replay after its single 24 h window, without redoing the docs already done.
#
#   sh packages/layer/test/resume-unified.sh [LOOP_UNIT]
#
# Waits for the phase loop (default: any running reshape-live-replays unit) and the unified process
# to be gone, then runs the replay in attempts. Each attempt gets --skip=<the rows already on disk>,
# and every attempt's rows are merged into out/unified/merged.json. A completed attempt (rc 0 or 1)
# is copied to test/evidence/. A timeout resumes from the merged rows and continues.
#
# Why it exists: the unified corpus is now 8,222 docs, not the 5,513 the loop's 24 h default was
# sized for; at the measured 16 s/doc a full pass is ~36 h, so one window cannot finish it.
set -uo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$HERE/../../.." && pwd)
# The pinned SolidCraft release (0.30.1 since 2026-11-09); the rig and the evidence name follow it.
PIN=${SOLIDCRAFT_PIN:-0.30.1}
RIG=${SOLIDCRAFT_RIG:-$HOME/.cache/solidcraft-$PIN-rig}
PKG=${SOLIDCRAFT_REFEREE_PKG:-$RIG/sc-referee-pkg}
TOPO=${SOLIDCRAFT_TOPOLOGY_PKG:-$RIG/sc-referee-pkg-topology}
LOOP=${LAYER_LOOP_DIR:-$RIG/live-replay-loop}
OUT=$LOOP/out/unified
EVIDENCE=${LAYER_EVIDENCE:-$ROOT/packages/layer/test/evidence}
EV=$EVIDENCE/live-replay-unified-$PIN.json
MERGED=$OUT/merged.json
TS=$(date +%Y%m%d-%H%M%S)
LOG=$LOOP/logs/unified-resume-$TS.log
ATTEMPTS=${UNIFIED_ATTEMPTS:-8}
TIMEOUT=${TIMEOUT_UNIFIED:-86400}

mkdir -p "$LOOP/logs" "$OUT" "$EVIDENCE"

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

if [ -s "$EV" ] && ! grep -q '"partial": *true' "$EV"; then
  log "evidence already complete: $EV"; exit 0
fi

# One process at a time: wait for the loop unit (if named) and for any unified child.
if [ -n "${1:-}" ]; then
  while systemctl --user is-active --quiet "$1" 2>/dev/null; do sleep 30; done
  log "loop unit $1 is no longer active"
fi
while pgrep -f 'live-replay-unified\.mjs' >/dev/null 2>&1; do sleep 15; done

# The base is the merged file if a previous resume made one, else the loop's last partial.
if [ -s "$MERGED" ]; then
  BASE=$MERGED
elif [ -s "$OUT/live-replay-unified.json" ]; then
  cp "$OUT/live-replay-unified.json" "$MERGED" && BASE=$MERGED
else
  BASE=
fi
if [ -n "$BASE" ]; then
  log "base: $BASE ($(node -e "const j=require('$BASE'); console.log(j.docs+' docs, '+(j.differ||[]).length+' differ, '+(j.unifiedBuiltWhereASetRefused||[]).length+' violated')" 2>/dev/null || echo unreadable))"
fi

attempt=0
while [ "$attempt" -lt "$ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  AOUT=$OUT/attempt-$TS-$attempt.json
  SKIP=$OUT/skip-$TS-$attempt.json
  if [ -n "$BASE" ]; then
    node "$HERE/merge-unified.mjs" skip "$BASE" "$SKIP" >>"$LOG" 2>&1 || exit 2
  else
    printf '[]' >"$SKIP"
  fi
  log "attempt $attempt/$ATTEMPTS: $(node -e "console.log(require('$SKIP').length+' docs already done')" 2>/dev/null || echo 'fresh')"

  runner=()
  if systemd-run --user --scope -q -p MemoryMax=2G true >/dev/null 2>&1; then
    runner=(systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 --)
  fi
  (
    export SOLIDCRAFT_REFEREE_PKG="$PKG" SOLIDCRAFT_TOPOLOGY_PKG="$TOPO"
    exec "${runner[@]}" timeout --signal=TERM --kill-after=120 "$TIMEOUT" \
      node "$HERE/live-replay-unified.mjs" "--out=$AOUT" "--skip=$SKIP"
  ) >>"$LOG" 2>&1
  rc=$?
  log "attempt $attempt ended rc=$rc"

  if [ -s "$AOUT" ]; then
    if [ -n "$BASE" ]; then
      node "$HERE/merge-unified.mjs" merge "$MERGED.tmp" "$BASE" "$AOUT" --partial >>"$LOG" 2>&1 || exit 2
    else
      cp "$AOUT" "$MERGED.tmp"
    fi
    mv "$MERGED.tmp" "$MERGED"
    BASE=$MERGED
  fi

  if [ "$rc" = 0 ] || [ "$rc" = 1 ]; then
    if [ -z "$BASE" ]; then log "completed with no summary; nothing to write"; exit 2; fi
    node "$HERE/merge-unified.mjs" final "$BASE" >>"$LOG" 2>&1 || exit 2
    cp "$BASE" "$EV" && log "evidence written: $EV"
    log "done: $(node -e "const j=require('$EV'); console.log(j.docs+' docs, '+(j.differ||[]).length+' differ, '+(j.unifiedBuiltWhereASetRefused||[]).length+' built-where-refused')")"
    exit 0
  fi
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    log "window closed; resuming from the merged rows"
    continue
  fi
  log "unexpected rc=$rc; stopping (see $LOG)"
  exit 2
done

log "no attempts left after $ATTEMPTS"
exit 2
