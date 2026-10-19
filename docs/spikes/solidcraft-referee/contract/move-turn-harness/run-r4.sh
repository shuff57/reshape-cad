#!/bin/sh
# Round 4 (critic: cone silent wrong solid, missing rows). One job at a time. Usage: SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg> sh run-r4.sh
cd "$(dirname "$0")" || exit 1
run() { n="$1"; shift; echo "== $n"; systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 "$@" > "$n.out" 2>&1; echo "exit $?"; }
run r4-conechain bun r4-conechain.mjs --n=40 --seed=11 --out=r4-conechain-results.json
MT_NOINVARIANT=1 run r4-conechain-control-noinvariant bun r4-conechain.mjs --n=40 --seed=11 --only=cone,join --out=r4-conechain-control-noinvariant-results.json
MT_NOREPAIR=1 run r4-conechain-control-norepair bun r4-conechain.mjs --n=40 --seed=11 --only=cone,join,copies --out=r4-conechain-control-norepair-results.json
run r4-misc bun r4-misc.mjs
bun r4-lint.mjs > r4-lint.out 2>&1
SC_BOX_MS=120000 run r4-magnitude bun r4-magnitude.mjs
MT_MAX_PLANAR=100000 MT_MAX_CURVED=3000 SC_BOX_MS=120000 run r4-magnitude-guard bun r4-magnitude.mjs --guard
# regression: the 'supported' rows through the guard translator WITH the invariant (MT_GUARD=1 makes the runner use it)
MT_GUARD=1 run r4-reg-a-move bun a-move.mjs
MT_GUARD=1 run r4-reg-c-derived bun c-derived.mjs
MT_GUARD=1 run r4-reg-d-misc-move bun d-misc.mjs move
MT_GUARD=1 run r4-reg-s1-turn-compose bun s1-turn-compose.mjs
