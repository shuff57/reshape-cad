#!/bin/sh
# Stage B step 4: the fuzz oracle P (family-c-run.mjs: P + OCCT, path A and the shipped unified path) and the guard fuzz (fuzz-guard-run.mjs: P vs the
# shell-draft set), plus the fillet chain (fillet-chain-run.mjs), on kernel $1 (030 | 021c), the stage-B tree, under that rig's lock. Resumable per step.
set -u
T=/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-84337253; O=$HOME/.cache/solidcraft-0.30.1-rig/stageB/s4-$1; mkdir -p $O; BREP=$T/archive/brep-rs/pkg
case $1 in
  021c) REF=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; TOPO=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; LOCK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock;;
  030) REF=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg; TOPO=$HOME/.cache/solidcraft-0.30.1-rig/sc-referee-pkg-topology; LOCK=$HOME/.cache/solidcraft-0.30.1-rig/rig.lock;;
esac
for s in famc fuzz chain; do
  [ -s $O/$s.json ] && grep -q '^EXIT=' $O/$s.log && { echo "STEP $s SKIP"; continue; }
  case $s in famc) S=family-c-run.mjs;; fuzz) S=fuzz-guard-run.mjs;; chain) S=fillet-chain-run.mjs;; esac
  t0=$(date +%s)
  flock $LOCK systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 env SOLIDCRAFT_REFEREE_PKG=$REF SOLIDCRAFT_TOPOLOGY_PKG=$TOPO BREP_PKG=$BREP OUT=$O/$s.json timeout --kill-after=60 7200 node $T/packages/layer/test/$S > $O/$s.log 2>&1; r=$?
  echo "EXIT=$r" >> $O/$s.log; echo "STEP $1 $s rc=$r $(( $(date +%s) - t0 ))s $(date -Is)"
done
