#!/bin/sh
# Round 6 (critic: cone chain guard still fails 3 of 360 on the centre-of-mass bar). One job at a time, 1.5G cap, each job under 900 s.
# Usage: SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg> sh run-r6.sh
cd "$(dirname "$0")" || exit 1
run() { n="$1"; shift; echo "== $n"; systemd-run --user --scope -q -p MemoryMax=${MT_MEM:-1500M} -p MemorySwapMax=0 timeout 900 "$@" > "$n.out" 2>&1; echo "exit $?"; }
run r6-guardwrong bun r5-guardwrong.mjs
run r6-limit-sentence bun r6-limit-sentence.mjs
run r6-wide-a bun r4-conechain.mjs --n=120 --seed=5150 --only=cone,copies --out=r6-wide-a-results.json
run r6-wide-join bun r4-conechain.mjs --n=60 --seed=5150 --only=join --out=r6-wide-join-results.json
run r6-wide-control bun r4-conechain.mjs --n=120 --seed=5150 --only=control --out=r6-wide-control-results.json
run r6-conechain-moves bun r4-conechain.mjs --n=100 --seed=7 --only=moves --out=r6-conechain-moves-results.json
run r6-fresh-a bun r4-conechain.mjs --n=120 --seed=9001 --only=cone,copies --out=r6-fresh-a-results.json
run r6-fresh-join bun r4-conechain.mjs --n=60 --seed=9001 --only=join --out=r6-fresh-join-results.json
MT_NOCONELIMIT=1 run r6-control-nolimit bun r4-conechain.mjs --n=120 --seed=5150 --only=cone,copies --out=r6-control-nolimit-results.json
echo ALLDONE
