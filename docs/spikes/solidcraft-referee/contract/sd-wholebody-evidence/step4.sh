#!/bin/sh
# step4.sh: host bundle, unified invariants at 'full', root npm test, live examples, on this worktree (logs: next-loop/logs/sdw-*.log)
WT=$(cd "$(dirname "$0")/../../../../.." && pwd); cd $WT
N=$HOME/.cache/solidcraft-0.21.0-rig/next-loop; LG=$N/logs
echo "== bundle"; sh packages/solidcraft-host/pane/build.sh > $LG/sdw-bundle.log 2>&1; echo "BUNDLE rc=$?"
echo "== unified full"; (cd packages/layer && UNIFIED_EP_JOIN=full node --test test/unified.test.mjs) > $LG/sdw-unified-full.log 2>&1; echo "UNIFIED rc=$?"
echo "== npm test"; npm test > $LG/sdw-npmtest.log 2>&1; echo "NPMTEST rc=$?"
echo "== live examples"; (cd packages/solidcraft-host && flock $HOME/.cache/solidcraft-0.21.0-rig/rig.lock node test/live-examples.mjs $N/we/site $N/sdw/live-examples.png $N/sdw/live-examples.json) > $LG/sdw-live-examples.log 2>&1; echo "LIVE rc=$?"
