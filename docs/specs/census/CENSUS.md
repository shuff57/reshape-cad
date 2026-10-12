# PartDesign census: modes the gauntlet does not cover

FreeCAD 26.3.0 RC1 against brep-rs at `reshape-cad`. 93 cases.

| status | n |
|---|---|
| FACES | 5 |
| MATCH | 61 |
| MATCH-EXACT | 1 |
| NO-CONSTRUCT | 16 |
| REFUSED | 10 |

## By family

| family | result |
|---|---|
| pad-mode | MATCH 6, NO-CONSTRUCT 2 |
| pocket-mode | MATCH 5, NO-CONSTRUCT 1 |
| groove | MATCH 3, FACES 2 |
| revolution-mode | NO-CONSTRUCT 1 |
| dress-mode | NO-CONSTRUCT 2, MATCH 6, REFUSED 2 |
| hole-mode | NO-CONSTRUCT 4, MATCH 1 |
| thickness | MATCH 2, NO-CONSTRUCT 2, FACES 1 |
| draft | MATCH 2, NO-CONSTRUCT 1 |
| loft | MATCH 2, REFUSED 2 |
| pipe-helix | NO-CONSTRUCT 2 |
| primitive | MATCH 9, REFUSED 1, NO-CONSTRUCT 1 |
| boolean | MATCH 10, FACES 2, REFUSED 2, MATCH-EXACT 1 |
| sketch-on-face | MATCH 3, REFUSED 1 |
| dress-chain | REFUSED 2, MATCH 12 |

## Every case

| case | status | detail |
|---|---|---|
| pad-mode__taper-5 | MATCH | vol 6447.6490, 6 faces |
| pad-mode__taper-negative | MATCH | vol 5323.6315, 6 faces |
| pad-mode__two-sides | MATCH | vol 8400.0000, 6 faces |
| pad-mode__direction-45 | MATCH | vol 6000.0000, 6 faces |
| pad-mode__direction-along-vector | MATCH | vol 4242.6407, 6 faces |
| pad-mode__start-offset | MATCH | vol 6000.0000, 6 faces |
| pad-mode__up-to-first | NO-CONSTRUCT | pull() has no up-to option |
| pad-mode__up-to-face | NO-CONSTRUCT | pull() has no up-to option |
| pocket-mode__symmetric | MATCH | vol 11760.0000, 11 faces |
| pocket-mode__two-sides | MATCH | vol 11600.0000, 11 faces |
| pocket-mode__taper-10 | MATCH | vol 11396.7858, 11 faces |
| pocket-mode__direction-slanted | MATCH | vol 11520.0000, 11 faces |
| pocket-mode__through-taper | MATCH | vol 11032.3147, 10 faces |
| pocket-mode__up-to-first | NO-CONSTRUCT | pocket() has no up-to option |
| groove__ring-360 | MATCH | vol 19933.4054, 7 faces |
| groove__half-180 | FACES | vol 20569.5779 vs 20569.5779, faces 12 vs 8, bbox d 0.0e+0 |
| groove__quarter-90 | FACES | vol 20887.6642 vs 20887.6642, faces 12 vs 8, bbox d 0.0e+0 |
| groove__v-notch | MATCH | vol 20845.5145, 6 faces |
| groove__at-the-end | MATCH | vol 19933.4054, 5 faces |
| revolution-mode__symmetric-120 | NO-CONSTRUCT | spin() takes an angle only (no symmetric option) |
| dress-mode__chamfer-two-distances | NO-CONSTRUCT | bevel() takes one size |
| dress-mode__chamfer-distance-angle | NO-CONSTRUCT | bevel() takes one size |
| dress-mode__fillet-all-edges | MATCH | vol 5804.6961, 26 faces |
| dress-mode__fillet-two-adjacent | REFUSED | brep-rs can only round a straight edge between two flat faces whose ends are plain flat faces square to it, with nothing else within reach of the cut -- round2  |
| dress-mode__fillet-top-loop | REFUSED | brep-rs can only round a straight edge between two flat faces whose ends are plain flat faces square to it, with nothing else within reach of the cut -- round2  |
| dress-mode__fillet-after-pocket | MATCH | vol 11666.5266, 9 faces |
| dress-mode__chamfer-after-pocket | MATCH | vol 11640.8407, 9 faces |
| hole-mode__drill-point-118 | NO-CONSTRUCT | hole() has no drill point option |
| hole-mode__drill-point-for-depth | NO-CONSTRUCT | hole() has no drill point option |
| hole-mode__tapered-5 | NO-CONSTRUCT | hole() has no taper option |
| hole-mode__counterdrill | NO-CONSTRUCT | hole() has no counterdrill option |
| hole-mode__two-holes-one-sketch | MATCH | vol 11604.1593, 10 faces |
| thickness__box-open-top-2 | MATCH | vol 2672.0000, 11 faces |
| thickness__box-open-top-intersection | MATCH | vol 2672.0000, 11 faces |
| thickness__box-outward | NO-CONSTRUCT | hollow() has no outward option |
| thickness__cylinder-open-top | FACES | vol 4580.4421 vs 4580.4421, faces 6 vs 5, bbox d 0.0e+0 |
| thickness__box-two-open | NO-CONSTRUCT | hollow() opens one face |
| draft__right-face-5 | MATCH | vol 5912.5113, 6 faces |
| draft__all-sides-3 | MATCH | vol 5741.6232, 6 faces |
| draft__neutral-mid | NO-CONSTRUCT | draft() neutral plane only at a primitive extreme or an offset |
| loft__rect-to-rect-ruled | MATCH | vol 4280.0000, 6 faces |
| loft__rect-to-rect-smooth | MATCH | vol 4280.0000, 6 faces |
| loft__circle-to-circle | REFUSED | brep-rs can only blend two matching straight outlines yet -- bl1 is shown without it. |
| loft__rect-to-circle | REFUSED | brep-rs can only blend two matching straight outlines yet -- bl1 is shown without it. |
| pipe__straight | NO-CONSTRUCT | there is no pipe() |
| helix__coil | NO-CONSTRUCT | there is no helix() |
| primitive__add-box | MATCH | vol 6750.0000, 12 faces |
| primitive__add-cylinder | MATCH | vol 7696.4600, 8 faces |
| primitive__add-sphere | MATCH | vol 6718.3775, 7 faces |
| primitive__add-cone | MATCH | vol 6527.7876, 7 faces |
| primitive__add-torus | REFUSED | combine op1: brep-rs cannot boolean these two solids (an unsupported surface pair, or a surface/orientation combination its face-by-face boolean does not inters |
| primitive__sub-cylinder-through | MATCH | vol 5497.3452, 7 faces |
| primitive__sub-sphere-corner | MATCH | vol 5731.9174, 7 faces |
| primitive__sub-cone | MATCH | vol 5698.4071, 7 faces |
| primitive__add-wedge | MATCH | vol 6240.0000, 10 faces |
| primitive__add-prism | MATCH | vol 6748.2459, 13 faces |
| primitive__add-ellipsoid | NO-CONSTRUCT | there is no ellipsoid() |
| boolean__fuse-box-box | MATCH | vol 6300.0000, 8 faces |
| boolean__cut-box-box | MATCH | vol 5300.0000, 8 faces |
| boolean__common-box-box | MATCH | vol 700.0000, 6 faces |
| boolean__cut-cylinder-through | MATCH | vol 5497.3452, 7 faces |
| boolean__cut-cylinder-off-axis-edge | MATCH | vol 5199.0349, 8 faces |
| boolean__fuse-cylinder-standing | MATCH | vol 7696.4600, 8 faces |
| boolean__common-cylinder | FACES | vol 3141.5927 vs 3141.5927, faces 4 vs 3, bbox d 1.0e-7 |
| boolean__cut-sphere-top | MATCH | vol 5281.6225, 7 faces |
| boolean__fuse-sphere | MATCH | vol 6718.3775, 7 faces |
| boolean__common-sphere | FACES | vol 3992.1676 vs 3992.1676, faces 5 vs 7, bbox d 3.6e-15 |
| boolean__cut-cone | MATCH | vol 5698.4071, 7 faces |
| boolean__fuse-cone | MATCH | vol 6527.7876, 7 faces |
| boolean__cut-torus | REFUSED | combine op1: brep-rs cannot boolean these two solids (an unsupported surface pair, or a surface/orientation combination its face-by-face boolean does not inters |
| boolean__fuse-cylinder-cylinder-cross | REFUSED | combine op1: brep-rs cannot boolean these two solids (an unsupported surface pair, or a surface/orientation combination its face-by-face boolean does not inters |
| boolean__fuse-cylinder-cylinder-cross-unequal | MATCH-EXACT | vol 4003.195681 is the closed-form 4003.195682; FreeCAD says 4003.218390 (rel 5.7e-6) |
| sketch-face__pad-on-top-face | MATCH | vol 6400.0000, 11 faces |
| sketch-face__pocket-on-side-face | MATCH | vol 5773.8053, 8 faces |
| sketch-face__datum-tilted-pad | MATCH | vol 1200.0000, 6 faces |
| sketch-face__pocket-from-tilted-face | REFUSED | pocket pocket1: brep-rs cannot cut this pocket yet (the tool is not fully enclosed by pull1, or its surface pair is unsupported) -- pocket1 is shown without it. |
| dress-mode__chamfer-top-loop | MATCH | vol 5810.6667, 10 faces |
| dress-mode__chamfer-two-adjacent | MATCH | vol 5902.6667, 8 faces |
| dress-mode__fillet-vertical-edges | MATCH | vol 5922.7433, 10 faces |
| dress-chain__three-at-corner | REFUSED | brep-rs cannot chamfer an edge whose end touches more than three faces -- bevel3 is shown without it. |
| dress-chain__u-shape | MATCH | vol 5845.3333, 9 faces |
| dress-chain__two-sequential-sizes | MATCH | vol 5829.6667, 8 faces |
| dress-chain__top-and-bottom-loops | MATCH | vol 5621.3333, 14 faces |
| dress-chain__top-front-and-vertical | MATCH | vol 5922.6667, 8 faces |
| dress-chain__opposite-corners | MATCH | vol 5880.0000, 8 faces |
| dress-chain__two-adjacent-big | MATCH | vol 5621.3333, 8 faces |
| dress-chain__pentagon-front-right | MATCH | vol 9696.2226, 9 faces |
| dress-chain__pentagon-left-front | MATCH | vol 9696.2226, 9 faces |
| dress-chain__pentagon-single | MATCH | vol 9495.7778, 8 faces |
| dress-chain__pentagon-big | MATCH | vol 8901.7479, 9 faces |
| dress-chain__sequential-3-then-2 | MATCH | vol 5854.6667, 8 faces |
| dress-chain__sequential-three-edges | MATCH | vol 5845.3333, 9 faces |
| dress-chain__chain-then-fillet | REFUSED | brep-rs can only round a straight edge between two flat faces whose ends are plain flat faces square to it, with nothing else within reach of the cut -- round1  |
