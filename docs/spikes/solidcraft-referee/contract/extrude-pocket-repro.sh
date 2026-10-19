#!/bin/sh
# SPIKE, referee only (contract / extrude-pocket group). ONE entry point for every measurement behind extrude-pocket.json, so a row's RE-RUN line is a single command.
#   export SOLIDCRAFT_REFEREE_PKG=<wasm-bindgen --target nodejs pkg of SolidCraft fe3717f, built as in contract/RIG.md "Measuring rig">
#   sh docs/spikes/solidcraft-referee/contract/extrude-pocket-repro.sh <step> [args passed to the script]
# Steps (each heavy one runs under a 16 GB cap, one at a time):
#   measure [--only=id,id]   the case list (about 480 cases, 10-20 min under load) -> contract/ep-results.json, table on stdout (save it as ep-run.txt)
#   softfuzz [--n=120 --seed=1]  taper on holes / several shapes against live OCCT offsets -> extrude-pocket-taper-soup-fuzz-results.json
#   taperfuzz [--n=500 --seed=1]  taper fold guard on one outline against live OCCT -> extrude-pocket-taper-fuzz-results.json
#   slender                   curved-volume accuracy table -> extrude-pocket-slender-results.json
#   raw                       raw SolidCraft, no translator, no guard -> stdout (save as extrude-pocket-raw.txt)
#   floors                    floor / wall / step sweep, raw against contract -> stdout (save as extrude-pocket-floor-sweep.txt)
#   timing                    wall clock of ordinary round tools -> stdout (save as extrude-pocket-timing.txt)
#   probes | hang | lint | census | watchdog   the older raw-kernel probes (see RIG.md)
#   synthesize                no wasm: rebuilds extrude-pocket.json + extrude-pocket.meta.json from the files above
#   all                       measure, softfuzz, taperfuzz, slender, raw, floors, timing, synthesize in that order
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
: "${SOLIDCRAFT_REFEREE_PKG:?set SOLIDCRAFT_REFEREE_PKG to the SolidCraft wasm-bindgen nodejs pkg dir (contract/RIG.md)}"
CAP="systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0"
step=$1; [ $# -gt 0 ] && shift
heavy() { $CAP bun "$@"; }
case "$step" in
  measure)   heavy "$HERE/extrude-pocket-measure.mjs" "$@" ;;
  softfuzz)  heavy "$HERE/extrude-pocket-taper-soup-fuzz.mjs" "$@" ;;
  taperfuzz) heavy "$HERE/extrude-pocket-taper-fuzz.mjs" "$@" ;;
  slender)   heavy "$HERE/extrude-pocket-slender.mjs" "$@" ;;
  raw)       heavy "$HERE/extrude-pocket-raw.mjs" "$@" ;;
  floors)    heavy "$HERE/extrude-pocket-floor-sweep.mjs" "$@" ;;
  timing)    heavy "$HERE/extrude-pocket-timing.mjs" "$@" ;;
  probes)    heavy "$HERE/extrude-pocket-probes.mjs" "$@" ;;
  hang)      heavy "$HERE/extrude-pocket-hang.mjs" "$@" ;;
  watchdog)  heavy "$HERE/extrude-pocket-watchdog.mjs" "$@" ;;
  lint)      bun "$HERE/extrude-pocket-lint.mjs" "$@" ;;
  census)    bun "$HERE/extrude-pocket-census.mjs" "$@" ;;
  synthesize) bun "$HERE/extrude-pocket-synthesize.mjs" "$@" ;;
  all)
    cd "$HERE"
    sh "$0" measure > ep-run.txt
    sh "$0" softfuzz; sh "$0" taperfuzz --n=500 --seed=1; sh "$0" slender
    sh "$0" raw > extrude-pocket-raw.txt; sh "$0" floors > extrude-pocket-floor-sweep.txt; sh "$0" timing > extrude-pocket-timing.txt
    sh "$0" synthesize ;;
  *) echo "unknown step '$step' (see the header of this file)"; exit 2 ;;
esac
