#!/usr/bin/env bash
# run-live-replays.sh -- a resumable, bounded phase loop over the layer's real-kernel live replays.
#
# The five replays of the groups folded after the first evidence run were written and never run
# (patterns-mirror, booleans, revolve-groove, fillet-chamfer) or ran only to a partial file (unified).
# This runs them in a fixed order, one process at a time, under a memory cap and a wall timeout,
# copies each finished summary into packages/layer/test/evidence/, and keeps a resumable state file.
#
#   sh packages/layer/test/run-live-replays.sh --status
#   sh packages/layer/test/run-live-replays.sh --dry-run
#   sh packages/layer/test/run-live-replays.sh                 # run every phase not yet done
#   sh packages/layer/test/run-live-replays.sh --from=rg       # resume from a phase
#   sh packages/layer/test/run-live-replays.sh --only=pm,bool  # a subset
#   sh packages/layer/test/run-live-replays.sh --force         # re-run phases whose evidence exists
#   sh packages/layer/test/run-live-replays.sh --smoke         # one case per phase, scratch only
#
# Stop rules (the loop's contract):
#   PASS                      rc 0 and the summary says 0 differ / 0 hang / 0 built-wrong. Next phase.
#   FINDINGS                  rc 1. Stops the loop, unless --keep-going (which continues only on this).
#   BUILT-WRONG               a built result off its closed form (fillet-chamfer). ALWAYS stops,
#                             --keep-going or not: a silently wrong solid outranks every other result.
#   TIMEOUT / KILLED / ERROR  stops: the rig, the memory cap or the corpus needs a human.
#   A phase whose evidence already exists is skipped (use --force to re-run). A partial summary
#   (the script writes `partial: true` every 10 docs) is never copied to evidence.
#
# One process at a time is the rig's rule: two replays share ~1 GB of wasm and the machine.
# Everything is local; nothing is pushed.
set -uo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "$HERE/../../.." && pwd)
RIG=${SOLIDCRAFT_RIG:-$HOME/.cache/solidcraft-0.21.0-rig}
PKG=${SOLIDCRAFT_REFEREE_PKG:-$RIG/sc-referee-pkg}
TOPO=${SOLIDCRAFT_TOPOLOGY_PKG:-$RIG/sc-referee-pkg-topology}
EVIDENCE=${LAYER_EVIDENCE:-$ROOT/packages/layer/test/evidence}
LOOPDIR=${LAYER_LOOP_DIR:-$RIG/live-replay-loop}
LOGDIR=$LOOPDIR/logs
STATE=$LOOPDIR/state.tsv
LOCK=$LOOPDIR/lock
TS=$(date +%Y%m%d-%H%M%S)

PHASES=(pm bool rg fc unified)
DONE_ALL=0
FINDINGS_ANY=0

# Per-phase wall timeouts, in seconds. pm's first pass reached 230 of 503 cases in 3 h before its
# cap (2026-11-01), so the group phases default to 8 h and pm to 10 h. Unified replayed 2780 of
# 5513 docs in ~8 h before it was stopped (replay-unified3), so its default allows a full pass.
# Override any of them from the env.
TIMEOUT_PM=${TIMEOUT_PM:-36000}        # 10 h
TIMEOUT_BOOL=${TIMEOUT_BOOL:-28800}    # 8 h
TIMEOUT_RG=${TIMEOUT_RG:-28800}        # 8 h
TIMEOUT_FC=${TIMEOUT_FC:-28800}        # 8 h
TIMEOUT_UNIFIED=${TIMEOUT_UNIFIED:-86400}  # 24 h

LOOP_MEM=${LOOP_MEM:-1500M}              # systemd MemoryMax for the corpus phases
LOOP_MEM_UNIFIED=${LOOP_MEM_UNIFIED:-2G}
# Address-space cap (KB). OFF by default: this wasm reserves a virtual range far larger than it
# touches, and `ulimit -v` makes WebAssembly.Instance fail on Node 22 even at 8 GB (measured
# 2026-11-01). The real cap is systemd's MemoryMax above. Set LOOP_ULIMIT to a KB value to add it.
LOOP_ULIMIT=${LOOP_ULIMIT:-0}
LOOP_ULIMIT_UNIFIED=${LOOP_ULIMIT_UNIFIED:-0}

# One representative case per corpus, for --smoke. Kept in step with test/*-cases*.mjs.
SMOKE_PM='rl-disjoint-x3'
SMOKE_BOOL='join-box-cyl-through'
SMOKE_RG='groove-box-yz-half'
SMOKE_FC='a1-same-edge-twice-r2-r3'
SMOKE_UNIFIED='combined seed 0'

MODE=run
FORCE=0
KEEP_GOING=0
BUILD=0
DETACH=0
ONLY_PHASES=
FROM_PHASE=
ONLY_CASES=
SMOKE=0
ORIG_ARGS=("$@")

usage() {
  cat <<'EOF'
run-live-replays.sh -- a resumable, bounded phase loop over the layer's real-kernel live replays.

The five replays of the groups folded after the first evidence run were written and never run
(patterns-mirror, booleans, revolve-groove, fillet-chamfer) or ran only to a partial file (unified).
This runs them in a fixed order, one process at a time, under a memory cap and a wall timeout,
copies each finished summary into packages/layer/test/evidence/, and keeps a resumable state file.

  sh packages/layer/test/run-live-replays.sh --status
  sh packages/layer/test/run-live-replays.sh --dry-run
  sh packages/layer/test/run-live-replays.sh                 # run every phase not yet done
  sh packages/layer/test/run-live-replays.sh --from=rg       # resume from a phase
  sh packages/layer/test/run-live-replays.sh --only=pm,bool  # a subset
  sh packages/layer/test/run-live-replays.sh --force         # re-run phases whose evidence exists
  sh packages/layer/test/run-live-replays.sh --smoke         # one case per phase, scratch only

Stop rules (the loop's contract):
  PASS                      rc 0 and the summary says 0 differ / 0 hang / 0 built-wrong. Next phase.
  FINDINGS                  rc 1. Stops the loop, unless --keep-going (which continues only on this).
  BUILT-WRONG               a built result off its closed form (fillet-chamfer). ALWAYS stops,
                            --keep-going or not: a silently wrong solid outranks every other result.
  TIMEOUT / KILLED / ERROR  stops: the rig, the memory cap or the corpus needs a human.
  A phase whose evidence already exists is skipped (use --force to re-run). A partial summary
  (the script writes `partial: true` every 10 docs) is never copied to evidence.

One process at a time is the rig's rule: two replays share ~1 GB of wasm and the machine.
Everything is local; nothing is pushed.

Options:
  --status             print the last state of each phase and exit
  --dry-run            print the command and limits of each phase and exit
  --only=a,b           run only these phases (pm, bool, rg, fc, unified)
  --from=PHASE         start at this phase
  --only-cases=id,id   pass --only to the replay (smoke/debug; evidence is still written)
  --smoke              one case per phase into the loop scratch dir; no state, no evidence
  --force              re-run a phase even when its evidence file exists
  --keep-going         continue after FINDINGS (never after BUILT-WRONG, TIMEOUT, KILLED or ERROR)
  --build              run the sketch -> script -> layer build chain first
  --detach             start as a transient systemd user unit (survives the terminal)
  -h, --help           this text
EOF
}

phase_evidence() {
  case "$1" in
    pm) echo patterns-mirror ;;
    bool) echo booleans ;;
    rg) echo revolve-groove ;;
    fc) echo fillet-chamfer ;;
    unified) echo unified ;;
  esac
}

phase_script() {
  echo "$HERE/live-replay-$(phase_evidence "$1").mjs"
}

phase_timeout() {
  case "$1" in
    pm) echo "$TIMEOUT_PM" ;;
    bool) echo "$TIMEOUT_BOOL" ;;
    rg) echo "$TIMEOUT_RG" ;;
    fc) echo "$TIMEOUT_FC" ;;
    unified) echo "$TIMEOUT_UNIFIED" ;;
  esac
}

phase_mem() {
  case "$1" in
    unified) echo "$LOOP_MEM_UNIFIED" ;;
    *) echo "$LOOP_MEM" ;;
  esac
}

phase_ulimit() {
  case "$1" in
    unified) echo "$LOOP_ULIMIT_UNIFIED" ;;
    *) echo "$LOOP_ULIMIT" ;;
  esac
}

phase_smoke_case() {
  case "$1" in
    pm) echo "$SMOKE_PM" ;;
    bool) echo "$SMOKE_BOOL" ;;
    rg) echo "$SMOKE_RG" ;;
    fc) echo "$SMOKE_FC" ;;
    unified) echo "$SMOKE_UNIFIED" ;;
  esac
}

phase_index() {
  local p
  for i in "${!PHASES[@]}"; do
    p=${PHASES[$i]}
    [ "$p" = "$1" ] && { echo "$i"; return 0; }
  done
  return 1
}

selected() {
  local p=$1
  [ -z "$ONLY_PHASES" ] && return 0
  case ",$ONLY_PHASES," in *",$p,"*) return 0 ;; esac
  return 1
}

log_msg() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

ensure_dirs() {
  mkdir -p "$LOGDIR" "$LOOPDIR/out" "$EVIDENCE" || return 1
  [ -f "$STATE" ] || printf 'ts\tphase\tstatus\trc\tsecs\tevidence\tverdict\n' >"$STATE"
}

systemd_usable() {
  command -v systemd-run >/dev/null 2>&1 || return 1
  systemd-run --user --scope -q -p MemoryMax=1500M true >/dev/null 2>&1
}

record() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$1" "$2" "$3" "$4" "$5" "$6" >>"$STATE"
}

summary_path() { echo "$LOOPDIR/out/$1/live-replay-$(phase_evidence "$1").json"; }

preflight() {
  local fail=0
  command -v node >/dev/null 2>&1 || { log_msg "missing: node"; fail=1; }
  command -v timeout >/dev/null 2>&1 || { log_msg "missing: timeout"; fail=1; }
  [ -f "$PKG/solidcraft_referee.js" ] || { log_msg "missing rig: $PKG/solidcraft_referee.js (set SOLIDCRAFT_REFEREE_PKG)"; fail=1; }
  local p
  for p in "${PHASES[@]}"; do
    selected "$p" || continue
    [ -f "$(phase_script "$p")" ] || { log_msg "missing replay: $(phase_script "$p")"; fail=1; }
    if [ "$p" = fc ]; then
      [ -f "$TOPO/solidcraft_referee_p2.js" ] || { log_msg "fillet-chamfer needs the topology rig: $TOPO (set SOLIDCRAFT_TOPOLOGY_PKG)"; fail=1; }
    fi
  done
  for f in packages/sketch/dist/sketch-arc.js packages/script/dist/reshape-script.js packages/script/dist/model-codegen.js packages/layer/dist/index.js; do
    [ -f "$ROOT/$f" ] || { log_msg "missing build artifact: $f (run with --build, or npm run build)"; fail=1; }
  done
  [ "$fail" = 0 ]
}

acquire_lock() {
  if ! mkdir "$LOCK" 2>/dev/null; then
    local pid
    pid=$(cat "$LOCK/pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log_msg "another loop is running (pid $pid); not starting a second one"
      return 1
    fi
    log_msg "stale lock (pid ${pid:-unknown}); taking it over"
    rm -rf "$LOCK"
    mkdir "$LOCK" || return 1
  fi
  echo $$ >"$LOCK/pid"
  LOCK_OWNER=1
}

release_lock() {
  if [ "${LOCK_OWNER:-0}" = 1 ]; then rm -rf "$LOCK"; fi
}

on_signal() {
  log_msg "interrupted; releasing the lock (the replay's own children are killed by their timeout/scope)"
  release_lock
  exit 130
}

build_chain() {
  log_msg "building sketch -> script -> layer"
  ( cd "$ROOT" \
    && npm run build -w @shuff57/reshape-sketch \
    && npm run build -w @shuff57/reshape-script \
    && npm run build -w @shuff57/reshape-layer ) || return 1
}

# Fill LAST_ARGS with the replay command for one phase. OUT is the summary's directory in both
# kinds: the case-writing scripts create OUT/cases and write OUT/live-replay-<group>.json.
# ONLY overrides the case subset (used by the resume loop); empty keeps --only-cases/--smoke.
build_args() {
  local name=$1 out=$2 only=${3-}
  local script; script=$(phase_script "$name")
  LAST_ARGS=(node "$script")
  case "$name" in
    pm|unified) LAST_ARGS+=("--out=$out/live-replay-$(phase_evidence "$name").json") ;;
    *) LAST_ARGS+=("--all" "--out=$out") ;;
  esac
  if [ -n "$only" ]; then
    LAST_ARGS+=("--only=$only")
  else
    local cases=$ONLY_CASES
    if [ "$SMOKE" = 1 ]; then cases=$(phase_smoke_case "$name"); fi
    [ -n "$cases" ] && LAST_ARGS+=("--only=$cases")
  fi
  return 0
}

# The three group replays write one row per case into OUT/cases, so a phase that took several
# attempts can resume at case level and end with one summary rebuilt from every row on disk.
is_case_phase() {
  case "$1" in bool|rg|fc) return 0 ;; esac
  return 1
}

case_remaining() {
  node "$HERE/live-replay-cases.mjs" remaining "$1" "$2" 2>/dev/null
}

rebuild_summary() {
  local partial=0
  [ "${3:-0}" = 1 ] && partial=1
  if [ "$partial" = 1 ]; then
    node "$HERE/live-replay-cases.mjs" summary "$1" "$2" --partial 2>&1
  else
    node "$HERE/live-replay-cases.mjs" summary "$1" "$2" 2>&1
  fi
}

run_phase() {
  local name=$1
  local ev; ev=$(phase_evidence "$name")
  local evfile="$EVIDENCE/live-replay-$ev-0.21.0.json"
  local out="$LOOPDIR/out/$name"
  local log="$LOGDIR/$name-$TS.log"
  [ "$SMOKE" = 1 ] && out="$LOOPDIR/out/smoke-$name"
  local summary="$out/live-replay-$ev.json"

  if [ "$SMOKE" = 0 ] && [ "$FORCE" = 0 ] && [ -s "$evfile" ]; then
    log_msg "$name: evidence exists ($evfile); skip (--force to re-run)"
    record "$name" SKIP 0 0 "$evfile" "evidence-present"
    return 0
  fi

  mkdir -p "$out"
  rm -f "$summary"

  local casephase=0; is_case_phase "$name" && casephase=1
  local attempt=0 max=${LOOP_ATTEMPTS:-6} rc=1 secs=0 total=0
  local status=ERROR verdict="" built_wrong=0
  local only=$ONLY_CASES
  [ "$SMOKE" = 1 ] && only=$(phase_smoke_case "$name")

  {
    echo "# phase      $name"
    echo "# start      $(date -Is)"
    echo "# limits     timeout=$(phase_timeout "$name")s per attempt, up to $max attempt(s), MemoryMax=$(phase_mem "$name") ulimit_v=$(phase_ulimit "$name")KB (0=off)"
    echo "# rig        $PKG"
    echo "# topology   $TOPO"
    echo
  } >"$log"

  while :; do
    attempt=$((attempt + 1))

    if [ "$casephase" = 1 ]; then
      local ids="$out/case-ids.json"
      if [ ! -s "$ids" ]; then
        node "$(phase_script "$name")" "--ids-out=$ids" >>"$log" 2>&1 || { rc=2; break; }
      fi
      # Case-level resume: without an explicit subset, run only ids that have no row on disk.
      if [ "$SMOKE" = 0 ] && [ -z "$ONLY_CASES" ]; then
        only=$(case_remaining "$ids" "$out/cases")
        if [ -z "$only" ]; then
          verdict=$(rebuild_summary "$out/cases" "$summary" 0)
          rc=0
          break
        fi
      fi
    fi

    build_args "$name" "$out" "$only"
    local ncases=0 cmdline="${LAST_ARGS[*]}"
    [ -n "$only" ] && ncases=$(( $(printf '%s' "$only" | tr -cd ',' | wc -c) + 1 ))
    {
      echo "# attempt    $attempt/$max at $(date -Is) ($ncases case(s))"
      if [ "$ncases" -gt 0 ] && [ "$ncases" -lt 50 ]; then echo "# cases      $only"; fi
      echo "# command    ${cmdline:0:240}"
      echo
    } >>"$log"

    local -a runner=()
    if [ "$USE_SYSTEMD" = 1 ]; then
      runner=(systemd-run --user --scope -q -p "MemoryMax=$(phase_mem "$name")" -p MemorySwapMax=0 --)
    fi

    log_msg "$name: attempt $attempt running $ncases case(s) (timeout $(phase_timeout "$name")s, mem $(phase_mem "$name")); log $log"
    printf '%s\t%s\t%s\t%s\n' "$name" "$(date +%s)" "$attempt" "$ncases" >"$LOOPDIR/current"
    local t0
    t0=$(date +%s)
    (
      local lim; lim=$(phase_ulimit "$name")
      [ "$lim" != 0 ] && { ulimit -v "$lim" 2>/dev/null || true; }
      export SOLIDCRAFT_REFEREE_PKG="$PKG"
      export SOLIDCRAFT_TOPOLOGY_PKG="$TOPO"
      exec "${runner[@]}" timeout --signal=TERM --kill-after=120 "$(phase_timeout "$name")" "${LAST_ARGS[@]}"
    ) >>"$log" 2>&1
    rc=$?
    secs=$(( $(date +%s) - t0 ))
    total=$(( total + secs ))

    if [ "$casephase" = 1 ]; then
      # Rebuild from every row on disk, so a phase cut by its wall timeout still contributes.
      local partial=0
      if [ "$rc" != 0 ] && [ "$rc" != 1 ]; then partial=1; fi
      verdict=$(rebuild_summary "$out/cases" "$summary" "$partial")
      built_wrong=$(printf '%s' "$verdict" | sed -n 's/.* builtWrong=\([0-9]*\).*/\1/p')
      built_wrong=${built_wrong:-0}
      if [ "$built_wrong" != 0 ]; then
        log_msg "$name: BUILT-WRONG in the rows on disk; stopping"
        break
      fi
      if [ "$rc" = 0 ]; then break; fi
      if [ -n "$ONLY_CASES" ] || [ "$SMOKE" = 1 ]; then break; fi
      if [ "$attempt" -lt "$max" ]; then
        log_msg "$name: attempt $attempt stopped at rc=$rc after ${secs}s; resuming the missing cases in $(( attempt + 1 ))/$max"
        sleep 10
        continue
      fi
      log_msg "$name: attempt $attempt stopped at rc=$rc; no attempts left"
      break
    fi
    break
  done

  # Final verdict. A case phase's rebuilt line already covers every row on disk; the others use the
  # replay's own summary.
  if [ "$casephase" != 1 ]; then
    verdict=$(node "$HERE/live-replay-verdict.mjs" "$summary" 2>&1)
  fi
  if [ ! -s "$summary" ]; then verdict="RESULT status=NO-SUMMARY"; fi
  status=$(printf '%s' "$verdict" | sed -n 's/.* status=\([A-Z-]*\).*/\1/p')
  built_wrong=$(printf '%s' "$verdict" | sed -n 's/.* builtWrong=\([0-9]*\).*/\1/p')
  built_wrong=${built_wrong:-0}

  if [ "$built_wrong" != 0 ]; then
    status=FAIL
  elif [ "$rc" = 124 ]; then
    status=TIMEOUT
  elif [ "$rc" = 137 ]; then
    status=KILLED
  elif [ "$rc" = 1 ]; then
    status=FINDINGS
  elif [ "$rc" = 0 ]; then
    # A completed run that differs or hung is a finding, not a clean pass; built-wrong was handled above.
    [ "$status" = FAIL ] && status=FINDINGS
  else
    status=ERROR
  fi
  [ -z "$status" ] && status=ERROR

  # Copy a complete summary into evidence. A partial one stays in the loop scratch dir and is named
  # so nobody mistakes it for a result. Smoke runs never touch evidence.
  local ev_note=none
  if [ "$SMOKE" = 0 ] && [ -s "$summary" ]; then
    if ! grep -q '"partial": *true' "$summary"; then
      cp "$summary" "$evfile" && ev_note="$evfile"
    else
      local kept="$LOOPDIR/out/$name/live-replay-$ev.partial-$TS.json"
      cp "$summary" "$kept" && ev_note="$kept (partial)"
    fi
  fi

  log_msg "$name: $status rc=$rc ${total}s over $attempt attempt(s)  $verdict"
  [ "$ev_note" != none ] && log_msg "$name: evidence $ev_note"
  [ "$status" != PASS ] && log_msg "$name: log $log"

  if [ "$SMOKE" = 0 ]; then
    record "$name" "$status" "$rc" "$total" "$ev_note" "$(printf '%s' "$verdict" | tr '\t\n' '  ')"
  fi
  rm -f "$LOOPDIR/current"

  RUN_STATUS=$status
  RUN_BUILT_WRONG=$built_wrong
  RUN_RC=$rc

  case $status in
    PASS) return 0 ;;
    FINDINGS)
      if [ "$built_wrong" != 0 ]; then return 3; fi
      if [ "$KEEP_GOING" = 1 ]; then FINDINGS_ANY=1; return 1; fi
      return 3
      ;;
    *) return 3 ;;
  esac
}
print_status() {
  ensure_dirs || return 1
  printf '%-9s %-12s %-6s %-8s %s\n' PHASE STATUS RC WALL EVIDENCE
  local p line
  for p in "${PHASES[@]}"; do
    line=$(grep -P "^[^\t]*\t${p}\t" "$STATE" 2>/dev/null | tail -1 || true)
    if [ -z "$line" ]; then
      printf '%-9s %-12s %-6s %-8s %s\n' "$p" "not-run" "-" "-" "-"
      continue
    fi
    local phase status rc secs evfile
    IFS=$'\t' read -r _ phase status rc secs evfile _ <<<"$line"
    printf '%-9s %-12s %-6s %-8s %s\n' "$phase" "$status" "$rc" "${secs}s" "$evfile"
  done
  echo
  echo "state: $STATE"
  echo "logs:  $LOGDIR"
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --status) MODE=status ;;
      --dry-run) MODE=dry ;;
      --only=*) ONLY_PHASES=${arg#--only=} ;;
      --from=*) FROM_PHASE=${arg#--from=} ;;
      --only-cases=*) ONLY_CASES=${arg#--only-cases=} ;;
      --smoke) SMOKE=1 ;;
      --force) FORCE=1 ;;
      --keep-going) KEEP_GOING=1 ;;
      --build) BUILD=1 ;;
      --detach) DETACH=1 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
    esac
  done

  case "$MODE" in
    status) print_status; exit $? ;;
  esac

  local p idx start=0
  if [ -n "$FROM_PHASE" ]; then
    idx=$(phase_index "$FROM_PHASE") || { echo "unknown phase: $FROM_PHASE (pm, bool, rg, fc, unified)" >&2; exit 2; }
    start=$idx
  fi
  if [ -n "$ONLY_PHASES" ]; then
    local bad=
    IFS=, read -r -a _only <<<"$ONLY_PHASES"
    for p in "${_only[@]}"; do phase_index "$p" >/dev/null || bad="$bad $p"; done
    [ -n "$bad" ] && { echo "unknown phase(s):$bad (pm, bool, rg, fc, unified)" >&2; exit 2; }
  fi

  if [ "$DETACH" = 1 ] && [ "${LOOP_DETACHED:-}" != 1 ]; then
    if ! command -v systemd-run >/dev/null 2>&1; then
      echo "systemd-run is unavailable; run without --detach (or under nohup/tmux)" >&2
      exit 2
    fi
    local unit="reshape-live-replays-$TS"
    local -a pass=()
    local a
    for a in "${ORIG_ARGS[@]}"; do [ "$a" = --detach ] || pass+=("$a"); done
    systemd-run --user --unit="$unit" --collect --working-directory="$ROOT" \
      --setenv=LOOP_DETACHED=1 \
      --setenv=SOLIDCRAFT_REFEREE_PKG="$PKG" \
      --setenv=SOLIDCRAFT_TOPOLOGY_PKG="$TOPO" \
      bash "$0" "${pass[@]}" || exit 2
    echo "detached as $unit"
    echo "  state:  sh $0 --status"
    echo "  status: systemctl --user status $unit"
    echo "  stop:   systemctl --user stop $unit"
    echo "  logs:   $LOGDIR"
    exit 0
  fi

  ensure_dirs || exit 2

  if [ "$BUILD" = 1 ]; then build_chain || { log_msg "build failed"; exit 2; }; fi

  if [ "$MODE" = dry ]; then
    for i in "${!PHASES[@]}"; do
      p=${PHASES[$i]}
      [ "$i" -lt "$start" ] && continue
      selected "$p" || continue
      build_args "$p" "$LOOPDIR/out/$p"
      echo "# $p: timeout=$(phase_timeout "$p")s mem=$(phase_mem "$p") ulimit=$(phase_ulimit "$p")KB"
      echo "SOLIDCRAFT_REFEREE_PKG=$PKG SOLIDCRAFT_TOPOLOGY_PKG=$TOPO ${LAST_ARGS[*]}"
      echo
    done
    exit 0
  fi

  if ! preflight; then exit 2; fi
  USE_SYSTEMD=0
  if systemd_usable; then USE_SYSTEMD=1; else log_msg "systemd-run unavailable; relying on ulimit only"; fi

  acquire_lock || exit 2
  LOCK_OWNER=1
  trap release_lock EXIT
  trap on_signal INT TERM

  local stop=0 detail=
  for i in "${!PHASES[@]}"; do
    p=${PHASES[$i]}
    [ "$i" -lt "$start" ] && continue
    selected "$p" || continue
    run_phase "$p"
    local rc=$?
    if [ $rc = 0 ]; then
      continue
    elif [ $rc = 1 ]; then
      log_msg "$p: FINDINGS recorded; --keep-going, so the loop continues"
      continue
    else
      stop=1
      detail="$p ($RUN_STATUS, rc $RUN_RC)"
      break
    fi
  done

  echo
  echo "==================== loop summary ===================="
  print_status || true
  if [ $stop = 1 ]; then
    echo
    echo "STOPPED at $detail"
    echo "The summary and the case files are in $LOOPDIR/out (see $LOGDIR for the log)."
    exit 1
  fi
  [ "$FINDINGS_ANY" = 1 ] && { echo; echo "Finished with FINDINGS; see the state table."; exit 1; }
  echo
  echo "All selected phases passed."
}

main "$@"
