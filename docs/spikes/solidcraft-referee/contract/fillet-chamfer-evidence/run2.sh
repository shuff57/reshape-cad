#!/bin/bash
# usage: SOLIDCRAFT_REFEREE_PKG=<pkg> run2.sh <tag> <cases-file> [--only=prefix,..] ; heavy: memory-capped, one at a time
cd "$(dirname "$0")"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG}"
export STAGEFILE=$PWD/stage-$1.txt
timeout 3000 systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun drive2.mjs --cases=$2 --out=$PWD/out --res=res-$1.json ${3:+$3} >> log-$1.txt 2>&1
echo "EXIT $? last: $(cut -c1-800 $STAGEFILE)" >> log-$1.txt
