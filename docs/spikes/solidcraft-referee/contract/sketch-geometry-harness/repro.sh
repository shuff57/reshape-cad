#!/bin/sh
# One-line repro of the sketch-geometry measurements, run from the REAL repo (no shadow root needed):
#   SOLIDCRAFT_REFEREE_PKG=<wasm-bindgen --target nodejs pkg dir, see contract/RIG.md> sh docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/repro.sh [cases-name ...] 
# With no argument it runs every cases-*.mjs. Output goes to results-rerun/<name>.json (results/ holds the committed run).
# sg-core.mjs finds the repo root by walking up to node_modules/replicad-opencascadejs and takes brep-rs from
# packages/brep-rs/pkg or, since the kernel retirement, archive/brep-rs/pkg -- so run-phase0.mjs's hardcoded path is not needed.
set -e
cd "$(dirname "$0")"
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG to the solidcraft_referee wasm-bindgen nodejs pkg dir (contract/RIG.md)}"
mkdir -p results-rerun
names="$*"; [ -n "$names" ] || names=$(ls cases-*.mjs | sed 's/^cases-//; s/\.mjs$//')
for n in $names; do
  extra=""; [ "$n" = "control-noprofiles" ] && extra="--setenv=SG_NO_PROFILES=1"
  systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 $extra bun run-group.mjs cases-$n.mjs --out=results-rerun/$n.json 2> results-rerun/$n.log
  echo "done $n"
done
