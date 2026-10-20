#!/usr/bin/env bash
# Re-run the layer contract with one command.
#
#   docs/spikes/solidcraft-referee/contract/run-contract.sh [--check] [--measure] [--rig] [--groups a,b] [--commit <sha>] [--out <dir>]
#
#   --check    (default) rebuild every group's rows from its committed raw results (no kernel), diff the
#              result against the committed <group>.json, then regenerate LAYER-CONTRACT.md. Seconds.
#   --measure  re-measure with the live rig: each group's `measure` commands from contract-commands.json,
#              one at a time, each under MemoryMax=${CONTRACT_MEM:-1500M} and a timeout. Hours. Partial
#              results go to --out as they finish; a command killed by the cap is reported, never passed.
#   --rig      build the SolidCraft wasm package for --commit (default: the pin below) and archive/brep-rs/pkg.
#   --commit   SolidCraft commit or tag to build and measure. A newer kernel (for example v0.16.2) is
#              measured into its own --out, then diff the two contracts with build-contract.mjs --diff.
#
# --check rebuilds in a scratch git worktree of HEAD: only COMMITTED files are checked, and your working tree is not touched.
# Needs: bun, node, python3, cargo + wasm32-unknown-unknown + wasm-bindgen (for --rig), systemd-run.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
PIN="fe3717f2e400010a4cd0e7dd4f294e7091c25625"   # SolidCraft 0.9.0 (2026-10-13), the commit the committed contract was measured on
MODE_CHECK=1; MODE_MEASURE=0; MODE_RIG=0; GROUPS_ARG=""; COMMIT="$PIN"; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE_CHECK=1;; --measure) MODE_MEASURE=1;; --rig) MODE_RIG=1;;
    --groups) GROUPS_ARG="$2"; shift;; --commit) COMMIT="$2"; shift;; --out) OUT="$2"; shift;;
    -h|--help) sed -n 2,19p "${BASH_SOURCE[0]}"; exit 0;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac; shift
done
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
cd "$REPO" || exit 2
OUT="${OUT:-${TMPDIR:-/tmp}/layer-contract-$(echo "$COMMIT" | cut -c1-8)}"
mkdir -p "$OUT"
GROUPS_ALL=$(bun -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.keys(c.groups).join(" "))' "$HERE/contract-commands.json")
[ -n "$GROUPS_ARG" ] && GROUPS_ALL=$(echo "$GROUPS_ARG" | tr ',' ' ')
cmd_of() { bun -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).groups[process.argv[2]];const k=process.argv[3];console.log(k==="measure"?c.measure.join("\n"):c[k])' "$HERE/contract-commands.json" "$1" "$2"; }

echo "== SolidCraft commit: $COMMIT   scratch: $OUT"
if [ "$MODE_RIG" = 1 ]; then
  SC="${SOLIDCRAFT_SRC:-$HOME/solidcraft}"
  SRC="$OUT/sc-src"; PKGOUT="$OUT/sc-referee-pkg"; rm -rf "$SRC" "$OUT/wrapper"; mkdir -p "$SRC"
  git -C "$SC" archive "$COMMIT" | tar -x -C "$SRC" || { echo "cannot archive $COMMIT from $SC (git fetch --tags there first)"; exit 1; }
  cp -r "$HERE/../wrapper" "$OUT/wrapper"
  sed -i "s#/home/shuff57/solidcraft#$SRC#g" "$OUT/wrapper/Cargo.toml"   # patch a COPY, never the repo file
  cp "$SRC/Cargo.lock" "$OUT/wrapper/" 2>/dev/null
  (cd "$OUT/wrapper" && CARGO_TARGET_DIR="$OUT/sc-target" cargo build --release --target wasm32-unknown-unknown) || exit 1
  wasm-bindgen --target nodejs --out-dir "$PKGOUT" "$OUT/sc-target/wasm32-unknown-unknown/release/solidcraft_referee.wasm" || exit 1
  [ -d "$REPO/archive/brep-rs/pkg" ] || (cd "$REPO/archive/brep-rs" && wasm-pack build --release --target web --out-dir pkg) || exit 1
  export SOLIDCRAFT_REFEREE_PKG="$PKGOUT"
  echo "rig built: SOLIDCRAFT_REFEREE_PKG=$PKGOUT"
fi
: "${SOLIDCRAFT_REFEREE_PKG:=$OUT/sc-referee-pkg}"; export SOLIDCRAFT_REFEREE_PKG
[ -f "$SOLIDCRAFT_REFEREE_PKG/solidcraft_referee.js" ] || echo "note: no wasm pkg at $SOLIDCRAFT_REFEREE_PKG (needed by --measure and a few rebuilds); build it with --rig"

FAIL=0
if [ "$MODE_CHECK" = 1 ]; then
  echo "== check: rebuild rows from the COMMITTED raw results in a scratch worktree and diff (your working tree is not touched)"
  WT="$OUT/worktree"; git worktree remove --force "$WT" >/dev/null 2>&1; rm -rf "$WT"
  git worktree add --detach "$WT" HEAD >/dev/null 2>&1 || { echo "cannot create a worktree"; exit 1; }
  # a real node_modules dir of symlinks (not one symlink to the main tree): builders find the repo root by walking up to node_modules/replicad-opencascadejs and must find THIS worktree, not your tree
  mkdir "$WT/node_modules"; for e in "$REPO"/node_modules/* "$REPO"/node_modules/.bin; do [ -e "$e" ] && ln -s "$e" "$WT/node_modules/$(basename "$e")"; done
  for d in "$REPO"/packages/*; do [ -d "$d/dist" ] && ln -s "$d/dist" "$WT/packages/$(basename "$d")/dist"; done
  [ -d "$REPO/archive/brep-rs/pkg" ] && ln -s "$REPO/archive/brep-rs/pkg" "$WT/archive/brep-rs/pkg"
  norm() { sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9:.]+Z)?/DATE/g' "$1"; }
  for g in $GROUPS_ALL; do
    c=$(cmd_of "$g" rebuild)
    if [ "$c" = "null" ] || [ -z "$c" ]; then echo "NOT-REPRODUCIBLE $g  (see contract-commands.json rebuildNote)"; continue; fi
    CF="contract/$g.json"
    if (cd "$WT" && bash -c "$c") > "$OUT/$g.rebuild.log" 2>&1; then
      git -C "$WT" show "HEAD:docs/spikes/solidcraft-referee/$CF" > "$OUT/$g.committed.json"
      if diff -q <(norm "$OUT/$g.committed.json") <(norm "$WT/docs/spikes/solidcraft-referee/$CF") >/dev/null; then echo "ok        $g  (rebuilt file identical to the committed one; dates ignored)"
      elif node -e 'const r=(f)=>{const d=JSON.parse(require("fs").readFileSync(f,"utf8"));return JSON.stringify((Array.isArray(d)?d:d.rows).map(x=>[x.feature,x.status,x.refusalSentence??null]))};process.exit(r(process.argv[1])===r(process.argv[2])?0:1)' "$OUT/$g.committed.json" "$WT/docs/spikes/solidcraft-referee/$CF"; then echo "ok~       $g  (feature, status and sentence of every row reproduce; evidence text differs: diff $OUT/$g.committed.json $WT/docs/spikes/solidcraft-referee/$CF)"
      else echo "DIFFERS   $g  (a row's feature, status or sentence changed: diff $OUT/$g.committed.json $WT/docs/spikes/solidcraft-referee/$CF; log $OUT/$g.rebuild.log)"; FAIL=1; fi
    else echo "BUILD-FAIL $g  (log $OUT/$g.rebuild.log)"; FAIL=1; fi
  done
  (cd "$REPO" && node docs/spikes/solidcraft-referee/contract/build-contract.mjs) > "$OUT/build-contract.log" 2>&1 && echo "ok        LAYER-CONTRACT.md regenerated from the working tree" || { echo "BUILD-FAIL build-contract.mjs (log $OUT/build-contract.log)"; FAIL=1; }
  echo "(scratch worktree kept at $WT for inspection; remove with: git worktree remove --force $WT)"
fi

if [ "$MODE_MEASURE" = 1 ]; then
  echo "== measure: one command at a time, MemoryMax=${CONTRACT_MEM:-1500M}"
  for g in $GROUPS_ALL; do
    cmd_of "$g" measure | while IFS= read -r m; do
      [ -z "$m" ] && continue
      m="${m//<out>/$OUT}"; mkdir -p "$OUT/$g"
      echo "-- $g: $m"
      systemd-run --user --scope -q -p MemoryMax="${CONTRACT_MEM:-1500M}" -p MemorySwapMax=0 timeout "${CONTRACT_TIMEOUT:-3600}" bash -c "cd '$REPO' && $m" >> "$OUT/$g/measure.log" 2>&1
      rc=$?; echo "   exit $rc" ; echo "$g	$rc	$m" >> "$OUT/measure-status.tsv"
    done
  done
  echo "statuses: $OUT/measure-status.tsv (nonzero exit = failed or killed by the cap; never a pass)"
fi
exit $FAIL
