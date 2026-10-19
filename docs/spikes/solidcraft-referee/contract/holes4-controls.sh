#!/bin/sh
# NEGATIVE CONTROLS for the round-4 hole guards: the same cases with one guard switched OFF (H4_OFF), to show what each guard prevents and that the next layer is a real
# backstop. A hang-class guard is switched off twice: alone (the G-BUDGET watchdog must catch it) and together with G-BUDGET (the run is killed at H4_CTL_S = 100 s of CPU and
# reported as a hang). Run one at a time (heavy), each under the memory cap:
#   PKG=<sc-referee-pkg> OUT=<dir> sh docs/spikes/solidcraft-referee/contract/holes4-controls.sh [name ...]
# then: CTL=$OUT bun docs/spikes/solidcraft-referee/contract/holes4-rows.mjs holes.json <result files>   (controls are read by name from $OUT/ctl-<name>.json)
D=docs/spikes/solidcraft-referee/contract/holes4-drive.mjs
run() { # name off ids timeout
  case " $WANT " in *" $1 "*|"  ") ;; *) return ;; esac
  systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env H4_OFF=$2 SOLIDCRAFT_REFEREE_PKG=$PKG bun $D --out=$OUT/ctl-$1 --timeout=$4 --only=$3
  cp $OUT/ctl-$1/holes4-results.json $OUT/ctl-$1.json
}
WANT="$*"
run bodies  G-BODIES  wider-than-plate-31,wide-box41,pat-disjoint-hole 900
run tangent G-TANGENT wider-than-plate-30-exact,wide-box40-tangent,bore-tangent-to-edge,holes-tangent-to-wall,holes-tangent-to-each-other,cb-ring-tangent-side,cb-wide-as-plate 900
run top     G-TOP     blind-unknown-intersect-4,blind-wedge-turned,step-join-blind-low,step-join-blind-low-deep12,rot-box-y45-blind,tilt-x30-blind-8,tilt-y20-blind-3,hollow-open-top-blind,cb-pocket-floor-9x7,cb-pocket-floor-9x3,cs-pocket-floor-8x90,cb-step-join-low,cs-step-join-low,cb-tilted-slab,cb-open-hollow 900
run band    G-CSBAND  cs-blind-d6-D12-a90-b3,cs-blind-d6-D12-a90-b3.1,cs-blind-d6-D12-a90-b3.2,cs-blind-d6-D12-a120-b1.8,cs-blind-d10-D20-a90-b5.4,holes-cs-blind-band 900
run bandvol G-CSBAND,G-RECESS-VOL cs-blind-d6-D12-a90-b3,cs-blind-d6-D12-a90-b3.1,cs-blind-d6-D12-a90-b3.2,cs-blind-d6-D12-a120-b1.8,cs-blind-d10-D20-a90-b5.4,holes-cs-blind-band 900
run recess  G-RECESS,G-RECESS-VOL cb-deep-beyond-thickness-21,cb-deep-beyond-thickness-30,cb-blind-deep-equals-hole,cb-blind-deep-beyond-hole,cb-narrower-than-bore 900
run noop    G-NOOP    at-off-the-part,hole-twice-identical,holes-all-outside,pad-L-hole-in-notch 900
run corners G-CORNERS holes-along-x,holes-along-y,holes-along-x-blind 900
run cross   G-CROSS   cross-z-blind-then-x-through,cross-both-blind,cross-z-through-then-x-through 900
run torus   G-TORUS   through-ring-offset-hits,through-ring-misses 900
# ---- round 4
run csoverlap     G-CSOVERLAP          cs-overlap-holes-10x14,cs-seq-overlap,cs-over-earlier-bore,cb-over-earlier-cs 1500
run csoverlap-nobudget G-CSOVERLAP,G-BUDGET cs-overlap-holes-10x14,cs-over-earlier-bore 1500
run curved        G-CURVED             cross-bore-dowel-y,rot-cylinder-x90-hole-z,cb-along-x-on-cylinder,rot-cone-turned-through,cross-bore-round-pad 1500
run curved-nobudget G-CURVED,G-BUDGET  cross-bore-dowel-y,cb-along-x-on-cylinder 1500
run revolve       G-REVOLVE            spin-tube-along-x,spin-cup-along-x,spin-cup-along-y-blind 1500
run revolve-nobudget G-REVOLVE,G-BUDGET spin-tube-along-x,spin-cup-along-x 1500
run csedge        G-CSEDGE             cs-ring-breaks-out-side,cs-wide-mouth-wider-than-plate 1500
run tiny          G-TINY               tiny-across-0p0005,tiny-across-0p0003,tiny-across-0p0002,tiny-across-0p0001 900
run wide          G-WIDE               wide-cyl30,wide-cyl40 900
