#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
while [ ! -f /tmp/queue1.done ]; do sleep 10; done
for n in e22-turned-small-cone e21-fuzz-holes; do primitives-r4/run.sh $n > /tmp/$n.log 2>&1; done
SOLIDCRAFT_REFEREE_PKG=/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/sc-referee-pkg systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun primitives-r4/browser/capture-cmds.mjs /tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/629fe046-ebe6-436d-b818-4dfd8e729365/scratchpad/cmds.json > /tmp/capture.log 2>&1
echo done > /tmp/queue2.done
