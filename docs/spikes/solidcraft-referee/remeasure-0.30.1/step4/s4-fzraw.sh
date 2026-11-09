#!/bin/sh
# s4-fzraw.sh <021c|030>: the fuzz P corpora (seeds 1, 2) raw on that kernel's wasm, under its rig lock
set -u
R=$HOME/.cache/solidcraft-0.30.1-rig; F=$R/stageB/fz
case $1 in 021c) PK=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; LK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock;; 030) PK=$R/sc-referee-pkg; LK=$R/rig.lock;; esac
for s in 1 2; do
  flock $LK systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 env FZ=$F SOLIDCRAFT_REFEREE_PKG=$PK node $R/stageB/fz-wasm.mjs --seed $s --tag w$1 --every 4 || exit 3
done
