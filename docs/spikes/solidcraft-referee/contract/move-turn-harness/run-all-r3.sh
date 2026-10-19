#!/bin/sh
# Round 3 additions (each is one job at a time under systemd-run). Usage: SOLIDCRAFT_REFEREE_PKG=<sc-referee-pkg> sh run-all-r3.sh
# The SC_BOX_MS runs use the child-process time box (sc-child.mjs); wall times are upper bounds on a shared machine, CPU seconds are the load-independent figure.
cd "$(dirname "$0")" || exit 1
run() { n="$1"; shift; echo "== $n"; systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 "$@" > "$n.out" 2>&1; echo "exit $?"; }
run r3-lumps bun r3-lumps.mjs
MT_NOEXTRA=1 run r3-lumps-control bun r3-lumps.mjs
MT_SHIPPED=1 run r3-lumps-shipped bun r3-lumps.mjs
run r3-seam bun r3-seam.mjs
run r3-prismrot bun r3-prismrot.mjs
run r3-cuthead bun r3-cuthead.mjs
MT_NOCUTGUARD=1 run r3-cuthead-control bun r3-cuthead.mjs
run r3-param bun r3-param.mjs
run r3-sketchturn bun r3-sketchturn.mjs
SC_BOX_MS=120000 run r3-magnitude bun r3-magnitude.mjs
SC_BOX_MS=120000 run r3-deps bun r3-deps.mjs
SC_BOX_MS=120000 run r3-ringtime bun r3-ringtime.mjs
SC_BOX_MS=120000 run r3-slow-120000 bun r3-slow.mjs --out=r3-slow-120000.json
SC_BOX_MS=120000 run r3-slow-120000-s15 bun r3-slow.mjs --only=s15 --out=r3-slow-120000-s15.json
run r3-pickrepro bun r3-pickrepro.mjs
SC_BOX_MS=300000 run r3-slow-300000 bun r3-slow.mjs --only=s01,s02,s06,s07,s08,s09,s11 --out=r3-slow-300000.json
bun make-rows-r3.mjs
