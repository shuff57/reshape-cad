#!/bin/bash
# usage: SOLIDCRAFT_REFEREE_PKG=<pkg> runfz.sh <tag> --mode=single|pair --seed=N --n=N   (one heavy job at a time, memory-capped)
cd "$(dirname "$0")"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG}"
tag=$1; shift
export STAGEFILE=$PWD/stage-fz-$tag.txt
timeout 5400 systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun fuzz.mjs --res=$PWD/fuzz-$tag.json "$@" >> log-fz-$tag.txt 2>&1
echo "EXIT $?" >> log-fz-$tag.txt
