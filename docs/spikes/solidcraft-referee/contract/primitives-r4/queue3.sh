#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
while [ ! -f /tmp/bench.done ]; do sleep 10; done
for s in 2 3; do
  FUZZ=primitives-r4/fuzz-seed$s.json primitives-r4/run.sh fuzz-spec > /tmp/fz$s.log 2>&1
  cp primitives-r4/results/fuzz-spec.json primitives-r4/results/fuzz-seed$s.json
done
echo done > /tmp/queue3.done
