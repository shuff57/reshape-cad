#!/bin/sh
# one heavy job at a time, in order (the machine was at load 40-120 the whole time)
cd "$(dirname "$0")/.." || exit 1
while pgrep -f "e15-cyl-leftover.mjs" >/dev/null; do sleep 5; done
for n in e15b-cyl-leftover-big e14b-cyl-corner-bigR e19-ring-boundary e16-sphere-turn e18-prism-sides; do primitives-r4/run.sh $n > /tmp/$n.log 2>&1; done
FUZZ=primitives-r4/fuzz-seed1.json primitives-r4/run.sh fuzz-spec > /tmp/fz1.log 2>&1
cp primitives-r4/results/fuzz-spec.json primitives-r4/results/fuzz-seed1.json
for n in e20-curved-far-nondyadic e17-sliders; do primitives-r4/run.sh $n > /tmp/$n.log 2>&1; done
echo done > /tmp/queue1.done
