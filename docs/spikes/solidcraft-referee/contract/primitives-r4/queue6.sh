#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
while [ ! -f /tmp/queue5.done ]; do sleep 10; done
PKG_WEB=/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/sc-referee-web CMDS=/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/cmds.json systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun primitives-r4/browser/run-bench.mjs primitives-r4/results/browser-bench.json /tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/pwbench > /tmp/bench.log 2>&1
echo done > /tmp/bench.done
