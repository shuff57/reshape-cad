#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
while [ ! -f /tmp/queue3.done ]; do sleep 10; done
primitives-r4/run.sh e26-cone-edges > /tmp/e26-cone-edges.log 2>&1
echo done > /tmp/queue7.done
