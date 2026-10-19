#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
for n in e23-turned-cone e24-disc-corner e25-curved-far-big; do primitives-r4/run.sh $n > /tmp/$n.log 2>&1; done
echo done > /tmp/queue5.done
