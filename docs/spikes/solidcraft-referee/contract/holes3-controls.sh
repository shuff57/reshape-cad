#!/bin/sh
# NEGATIVE CONTROLS for the round-3 hole guards: the same cases with one guard switched OFF (H3_OFF), to show what each guard prevents and that the next
# guard is a real backstop. Run one at a time (heavy), each under the memory cap:
#   PKG=<sc-referee-pkg> OUT=<dir> sh docs/spikes/solidcraft-referee/contract/holes3-controls.sh
# then: bun docs/spikes/solidcraft-referee/contract/holes3-rows.mjs holes.json $OUT/full/holes3-results.json   (controls are read by name from $OUT/ctl-*/ )
D=docs/spikes/solidcraft-referee/contract/holes3-drive.mjs
run() { # name off ids timeout
  H3_OFF=$2 systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env H3_OFF=$2 SOLIDCRAFT_REFEREE_PKG=$PKG bun $D --out=$OUT/ctl-$1 --timeout=$4 --only=$3
}
run bodies  G-BODIES  wider-than-plate-31,wide-box41,pat-disjoint-hole 120
run tangent G-TANGENT wider-than-plate-30-exact,wide-box40-tangent,bore-tangent-to-edge,holes-tangent-to-wall,holes-tangent-to-each-other,cb-ring-tangent-side,cb-wide-as-plate 120
run top     G-TOP     blind-unknown-intersect-4,blind-wedge-turned,step-join-blind-low,step-join-blind-low-deep12,rot-box-y45-blind,tilt-x30-blind-8,tilt-y20-blind-3,hollow-open-top-blind,cb-pocket-floor-9x7,cb-pocket-floor-9x3,cs-pocket-floor-8x90,cb-step-join-low,cs-step-join-low,cb-tilted-slab,cb-open-hollow 120
run band    G-CSBAND  cs-blind-d6-D12-a90-b3,cs-blind-d6-D12-a90-b3.1,cs-blind-d6-D12-a90-b3.2,cs-blind-d6-D12-a90-b3.34,cs-blind-d6-D12-a120-b1.8,cs-blind-d10-D20-a90-b5.4,holes-cs-blind-band 120
run bandvol G-CSBAND,G-RECESS-VOL cs-blind-d6-D12-a90-b3,cs-blind-d6-D12-a90-b3.1,cs-blind-d6-D12-a90-b3.2,cs-blind-d6-D12-a90-b3.34,cs-blind-d6-D12-a120-b1.8,cs-blind-d10-D20-a90-b5.4,holes-cs-blind-band 120
run recess  G-RECESS,G-RECESS-VOL cb-deep-beyond-thickness-21,cb-deep-beyond-thickness-30,cb-blind-deep-equals-hole,cb-blind-deep-beyond-hole,cb-narrower-than-bore 120
run noop    G-NOOP    at-off-the-part,hole-twice-identical,holes-all-outside,pad-L-hole-in-notch 120
run corners G-CORNERS holes-along-x,holes-along-y,holes-along-x-blind 120
run cross   G-CROSS   cross-z-blind-then-x-through,cross-both-blind,cross-z-through-then-x-through 200
run torus   G-TORUS   through-ring-offset-hits,through-ring-misses 200
