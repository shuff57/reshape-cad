#!/bin/sh
# Live-reference gate (remaining-work loop phase 4). One command:
#   sh packages/layer/test/live-gate.sh
#   POSITIVE: SOLIDCRAFT_REFEREE_PKG=<rig pkg> sh packages/layer/test/live-gate.sh   (rig present: scored, fails on any wrong solid)
#   NEGATIVE CONTROL: NEGATIVE_CONTROL=1=wrong-oracle ... (a deliberately wrong oracle must flip the gate red)
# Without the rig it SKIPS cleanly (exit 0), so CI can run it everywhere.
set -u
cd "$(dirname "$0")/../../.."

PKG="${SOLIDCRAFT_REFEREE_PKG:-}"
BREP="${BREP_PKG:-$PWD/archive/brep-rs/pkg}"
if [ -z "$PKG" ] || [ ! -f "$PKG/solidcraft_referee.js" ] || [ ! -f "$BREP/brep_rs.js" ]; then
  echo "SKIP: no SolidCraft referee rig (SOLIDCRAFT_REFEREE_PKG) or no brep-rs wasm; gate not scored (exit 0)."
  exit 0
fi
echo "live-gate: rig present ($PKG); scoring guard-layer fuzz (exit nonzero on any WRONG solid)"
# needs built dist
node -e "require('./packages/layer/dist/index.js')" 2>/dev/null || npm run build >/dev/null 2>&1
SOLIDCRAFT_REFEREE_PKG="$PKG" node packages/layer/test/fuzz-guard-run.mjs
