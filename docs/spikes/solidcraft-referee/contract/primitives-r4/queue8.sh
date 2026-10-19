#!/bin/sh
# held-out fuzz seeds 4 and 5: generated after the round-4 constants of E27 were frozen, run UNGUARDED once each, one heavy job at a time
cd "$(dirname "$0")/.." || exit 1
for s in 4 5; do
  FUZZ=primitives-r4/fuzz-seed$s.json primitives-r4/run.sh fuzz-spec > /tmp/fz$s.log 2>&1
  cp primitives-r4/results/fuzz-spec.json primitives-r4/results/fuzz-seed$s.json
done
echo done > /tmp/queue8.done
