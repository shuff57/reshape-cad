#!/bin/sh
# Re-runs the whole move-turn harness in place (about 15 minutes; ring/torus turns take ~19 s each), one job at a time.
# Usage: SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg> sh run-all.sh        (brep-rs wasm: BREP_RS_PKG, default archive/brep-rs/pkg)
cd "$(dirname "$0")" || exit 1
run() { n="$1"; shift; echo "== $n"; systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 bun "$@" > "rerun-$n.out" 2>&1; echo "exit $?"; }
run a-move a-move.mjs
run b-turn b-turn.mjs
run c-derived c-derived.mjs
run d-misc-move d-misc.mjs move
run d-misc-copy d-misc.mjs copy
run f-analytic f-analytic.mjs
run h-param h-param.mjs
run i-control i-control.mjs
run e-errors e-errors.mjs
run g-picks g-picks.mjs
run g-sweep g-sweep.mjs
run k-pickguard k-pickguard.mjs
run k2-guard-scope k2-guard-scope.mjs
run m-copy m-copy.mjs
run n-fork n-fork.mjs
run p-magnitude p-magnitude.mjs
run p-magnitude2 p-magnitude2.mjs
run p-magnitude3 p-magnitude3.mjs
run q-interp q-interp.mjs
run r-misc r-misc.mjs
