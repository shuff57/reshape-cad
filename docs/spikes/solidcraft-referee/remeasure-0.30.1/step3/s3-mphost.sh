#!/bin/sh
# s3-mphost.sh <021c|030>: live-moved-picks' 254 cases through the HOST route (mp-host.mjs), its own closed-form + COM + brep-rs scoring
R=$HOME/.cache/solidcraft-0.30.1-rig; S=$R/stageB
case $1 in 021c) PK=$HOME/.cache/solidcraft-0.21.0-rig/sc-corrected-pkg; TP=$HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology; LK=$HOME/.cache/solidcraft-0.21.0-rig/next-loop/rig.lock;; 030) PK=$R/sc-referee-pkg; TP=$R/sc-referee-pkg-topology; LK=$R/rig.lock;; esac
mkdir -p $S/s3/mphost
flock $LK systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 env SOLIDCRAFT_REFEREE_PKG=$PK SOLIDCRAFT_TOPOLOGY_PKG=$TP timeout 7200 node $S/mp-host.mjs --out=$S/s3/mphost/mp-host-$1.json
