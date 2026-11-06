#!/bin/sh
# Stage A probe of SolidCraft v0.40.0-rc.2 (solidcore). One step at a time, the whole chain under the rig lock:
#   systemd-run --user --unit=reshape-sA-probe --collect -p MemoryMax=8G sh -c 'flock ~/.cache/solidcraft-0.40.0-rc.2-rig/rig.lock sh docs/spikes/solidcraft-referee/solidcore-0.40.0-rc.2/run-all.sh'
# Needs: the rig (sc-referee-pkg, sc-referee-pkg-topology, shadow/), BREP_PKG (a built archive/brep-rs/pkg; read-only).
# STEPS="raw familyc guard sketch prims timing" selects steps. Logs and JSON in $RIG/logs and $RIG/out; the report copies the JSON next to it.
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
RIG="$HOME/.cache/solidcraft-0.40.0-rc.2-rig"; L="$RIG/logs"; O="$RIG/out"; mkdir -p "$L" "$O"
export SOLIDCRAFT_REFEREE_PKG="$RIG/sc-referee-pkg" SOLIDCRAFT_TOPOLOGY_PKG="$RIG/sc-referee-pkg-topology"
export BREP_PKG="${BREP_PKG:-$RIG/shadow/archive/brep-rs/pkg}"
step() { n=$1; shift; echo "== $n $(date -Is) load $(cut -d' ' -f1 /proc/loadavg)" >> "$L/run-all.log"; ( "$@" ) > "$L/$n.log" 2>&1; echo "EXIT=$?" >> "$L/$n.log"; echo "   $n exit $(tail -1 "$L/$n.log") $(date -Is)" >> "$L/run-all.log"; }
for s in ${STEPS:-raw familyc guard sketch prims timing}; do case $s in
  raw) step raw timeout 7200 node "$HERE/raw-probe.mjs" --limit=300 --out="$O/raw-probe.json";;
  familyc) step familyc env OUT="$O/family-c.json" timeout 3600 node "$REPO/packages/layer/test/family-c-run.mjs";;
  guard) step guard env OUT="$O/fuzz-guard.json" timeout 3600 node "$REPO/packages/layer/test/fuzz-guard-run.mjs";;
  sketch) step sketch timeout 1800 node "$HERE/sketch-contact-probe.mjs" --out="$O/sketch-contact.json";;
  prims) step prims sh -c "cd '$RIG/shadow' && timeout 7200 node docs/spikes/solidcraft-referee/contract/primitives-sweep.mjs --spec='$HERE/primitives-spec.mjs' --out='$O/primitives.json'";;
  timing)
    step t-bool timeout 3000 node "$REPO/packages/layer/test/live-replay-booleans.mjs" --all --timeout=300 --out="$O/timing-booleans" --only=r6-tiny-cone-minus-ball-r12.5,fz17-109-wed-con-uni,r3-split-cone-slab,fz7-038-cyl-sph-sub,fz23-087-sph-box-uni,fz17-043-box-con-box-uni
    step t-rg timeout 900 node "$REPO/packages/layer/test/live-replay-revolve-groove.mjs" --all --timeout=300 --out="$O/timing-rg" --only=R5-frustum-wall-mid-90
    step t-fc timeout 900 node "$REPO/packages/layer/test/live-replay-fillet-chamfer.mjs" --all --timeout=300 --out="$O/timing-fc" --only=pf-corner-then-join
    step t-slant sh -c "cd '$RIG/shadow' && timeout 3600 node docs/spikes/solidcraft-referee/contract/extrude-pocket-slant-timing.mjs --limit=300 --ids=sx-plain-block,sx-hole-clear,sx-hole-cross,sx-hole-cross-a,sx-hole-cross-d,sx-hole-cross-e,sx-pocket-cross,sx-pocket-cross-a";;
esac; done
echo "== done $(date -Is)" >> "$L/run-all.log"
