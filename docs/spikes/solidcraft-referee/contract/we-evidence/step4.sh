#!/bin/sh
# step4.sh: host bundle, unified invariants at 'full', root npm test, live examples, on the worktree (5180994a + docs only)
cd /home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-050a04e4
echo "== bundle"; sh packages/solidcraft-host/pane/build.sh; echo "BUNDLE rc=$?"
echo "== unified full"; (cd packages/layer && UNIFIED_EP_JOIN=full node --test test/unified.test.mjs) > /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/logs/we-unified-full.log 2>&1; echo "UNIFIED rc=$?"
echo "== npm test"; npm test > /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/logs/we-npmtest.log 2>&1; echo "NPMTEST rc=$?"
echo "== live examples"; (cd packages/solidcraft-host && flock $HOME/.cache/solidcraft-0.21.0-rig/rig.lock node test/live-examples.mjs /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/we/site /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/we/live-examples.png /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/we/live-examples.json) > /home/shuff57/.cache/solidcraft-0.21.0-rig/next-loop/logs/we-live-examples.log 2>&1; echo "LIVE rc=$?"
