# Holes rows: 0.9.0 (round 3) against 0.21.0 (round 4), row by row

Generated from the committed `contract/holes.json` and the new `contract/measured-0.21.0/holes.json` (built by `contract/holes4-rows-0.21.0.mjs` from `holes4-results.json`). Matching is by the exact `feature` text.

## Read this first
- The OLD file (`contract/holes.json`, 91 rows) is the **round-3 translator on SolidCraft 0.9.0**. The NEW file (94 rows) is the **round-4 translator on SolidCraft v0.21.0**. Every difference below therefore mixes a kernel change and a translator change (new guards in round 4). The attribution column repeats only what `holes4-FINDINGS.md` says; where it says nothing the cell says "NOT EXPLAINED", it is not guessed.
- The new rows were re-baselined from the 0.21.0 numbers by owner decision (sections A, B and C of `holes4-ROW-CHANGES.md` applied as written). Nothing was promoted to supported.
- The new file has +3 rows against the old one: three old rows were SPLIT because their cases no longer share a status (see "Rows only in one file").
- Status counts are of rows, not of cases. The 407 cases: 199 built, 158 refused, 50 script errors (FINDINGS).

## Counts by status
| status | old (0.9.0, round 3) | new (0.21.0, round 4) |
|---|---|---|
| supported | 39 | 39 |
| refused | 47 | 53 |
| unsupported | 5 | 2 |
| wrong | 0 | 0 |
| total | 91 | 94 |

## Statuses that differ (same feature text)
| # | feature (old text) | old | new | kernel / time / guard |
|---|---|---|---|---|
| 1 | countersink with a nearly flat cone (included angle 179: cone 0.03 deep) | unsupported | refused | GUARD ADDED IN ROUND 4 (G-CSFLAT); not a kernel change (FINDINGS) |
| 2 | countersink whose cone leaves through the bottom of the plate (cone 3 deep, tool 3.3 deep, plate 2 to 5 thick; mouth wider than the plate) | supported | refused | GUARD ADDED IN ROUND 4 (G-CSEDGE); not a kernel change (FINDINGS: "round-4 GUARDS that round 3 did not have") |
| 3 | countersink whose cone breaks out of a side face (mouth 12 across centred 4 from the x=0 edge of the plate) | unsupported | refused | GUARD ADDED IN ROUND 4 (G-CSEDGE); not a kernel change (FINDINGS) |
| 4 | holes() with counterbore or countersink: four recesses, overlapping or not, through and blind | supported | refused | TIME (G-BUDGET): 46.6 s of computing against a 45 s budget, 24.8 s in round 3; the data cannot say whether the kernel or this box is slower (FINDINGS) |
| 5 | hole on a cylinder lying along y (turned 90 about x), bore along z | unsupported | refused | GUARD ADDED IN ROUND 4 (G-CURVED); not a kernel change (FINDINGS) |
| 6 | hole on a cross-bore through a cylinder (bore along x through a z cylinder) and a through bore in a box with all edges rounded r2 reaching the rims (37 across) | unsupported | refused | GUARD ADDED IN ROUND 4 (G-CURVED); not a kernel change (FINDINGS) |

Rows in the old file whose feature text also exists in the new one with the SAME status: 85 of 91.

## Rows only in one file
### Only in the OLD file (0)
- none

### Only in the NEW file (3)
- (supported) countersink whose cone leaves through the bottom of the plate with the mouth inside the plate (cone 3 deep, tool 3.3 deep, plate 2 to 5 thick; split out of the round-3 row of the same name on the 0.21.0 re-baseline)
- (supported) holes() with counterbore: four recesses, overlapping or not, through and blind (counterbore only; split out of the round-3 row of the same name on the 0.21.0 re-baseline)
- (unsupported) hole through a box with all edges rounded r2 reaching the rims (37 across; split out of the round-3 cross-bore row on the 0.21.0 re-baseline)

### The three splits (the new rows that have no old counterpart come from these)
1. Old "countersink whose cone leaves through the bottom of the plate ..." (supported, 9 cases). New: the same feature text with only `cs-wide-mouth-wider-than-plate`, **refused** (G-CSEDGE, round-4 guard); the other 8 cases form a new supported row.
2. Old "holes() with counterbore or countersink: four recesses ..." (supported, 6 cases). New: the same feature text with only `holes-countersink` and `holes-cs-blind`, **refused** (G-BUDGET, time); the 4 counterbore cases form a new supported row.
3. Old "hole on a cross-bore through a cylinder ... and a through bore in a box with all edges rounded r2 ... (37 across)" (unsupported, 2 cases). New: the same feature text with only `cross-bore-through-cylinder`, **refused** (G-CURVED, round-4 guard); `round-box-hole-37` becomes its own row, **unsupported**: it now BUILDS inside the 45 s budget (33.8 s) and matches OCCT, so the old claim that it is too slow is false on 0.21.0. It stays unsupported only because the owner chose to promote nothing. That is a measured-better result held back by decision, not a failure.

## Rows with the same status but different evidence (guard or reason changed, proposal section A, plus section C)
| feature | status | what changed |
|---|---|---|
| deep given: blind into a sphere | refused | G-TOP -> G-BUDGET (47.9 s of computing). TIME-dependent: it might build on a faster box. Kernel or box slower: not told by the data |
| counterbore or countersink where the part is not flat ... | refused | only `cb-revolve-wall` changed: G-TOP -> G-REVOLVE (round-4 guard). The other seven ids unchanged |
| the same counterbored hole drilled twice | refused | G-NOOP -> G-NEST (round-4 guard) |
| hole on a cone turned to lie along x | refused | G-ENGINE -> G-CURVED (round-4 guard) |
| hole on a revolve (spin) result: blind | refused | G-TOP -> G-REVOLVE (round-4 guard) |
| hole through a closed hollow() | refused | status same. The shell sentence contains the word "undefined" (a real sentence defect, flagged by the group's lint as "engine jargon"; `SHELL_SENTENCE.closed` is called with one argument and takes two). Already true in round 4, not new on 0.21.0. NOT FIXED, and the old note's quotation of the shell sentence was false and is corrected in the new row |
| 7 rows whose sentence is an interpreter script-error text | refused | the sentence lint complains (they name code such as `hole()` and `{ across: 6 }`). Now RECORDED in each row's evidence instead of failing the build; the sentences are unedited and the lint is unchanged for every other sentence |

## Every row, side by side
| feature | old | new |
|---|---|---|
| hole(shape,{across}): through bore on a box, pad, prism, cylinder or moved box, centred and offset (HoleFeature diameter, depth, center, axis z) | supported | supported |
| across: diameter, widest bore that still fits (29.9 across on a 30 deep plate, 38 across on a 40 x 40 box, 29 across on a 30 cylinder) | supported | supported |
| across wider than the part's narrowest side (31, 30.5, 35, 60 across on a 30 deep plate; 41 across on a 40 x 40 box): the bore would split the part into several pieces | refused | refused |
| across equal to the narrowest side of the part (30 across on the 30 deep plate, 40 across on the 40 x 40 x 20 box): tangent to the sides | refused | refused |
| across as wide as or wider than a cylinder host (cylinder 30 x 20 with 30 or 40 across) | refused | refused |
| bore tangent to the part's side or to another bore along a line (10 across with its centre 5 from the x=40 face; holes() at +-17 with 6 across on a 40 wide plate; holes() 6 across 6 apart) | refused | refused |
| across: 0, negative, non-numeric or NaN | refused | refused |
| across/size omitted (hole(shape) and hole(shape,{})) | refused | refused |
| unknown option name; missing shape argument | refused | refused |
| size: 'M3' (clearance 3.4 mm) | supported | supported |
| size: 'M4' (clearance 4.5 mm) | supported | supported |
| size: 'M5' (clearance 5.5 mm) | supported | supported |
| size: 'M6' (clearance 6.6 mm) | supported | supported |
| size: 'M8' (clearance 9 mm) | supported | supported |
| size: 'M10' (clearance 11 mm) | supported | supported |
| size: 'M12' (clearance 13.5 mm) | supported | supported |
| size name is case-insensitive and trimmed ('m6', '  M6 ') | supported | supported |
| size: unknown name text ('M7', 'M2') | refused | refused |
| size: a number instead of a name (6) | refused | refused |
| across and size together | refused | refused |
| deep omitted: through hole on a cylinder and a cone (depth = thickness along axis + 2) | supported | supported |
| deep omitted: through hole on a sphere | supported | supported |
| deep omitted: through hole in a ring (torus), through the tube or down its empty centre | refused | refused |
| deep omitted: refused when the thickness cannot be found (intersect, polar pattern of a wedge, shape after turn step, turned hexagonal prism) | refused | refused |
| deep given: blind from the drilled face (axial offset set from the exact thickness): box, pad, hexagonal prism, moved box, L-shaped pad, cylinder | supported | supported |
| deep given: blind into a sphere | refused | refused |
| deep >= thickness (deep equals or exceeds the part) is a through hole | supported | supported |
| deep given on a result that only has an upper bound on its thickness (pocket result, subtract result): refused | refused | refused |
| deep given where the thickness is unknown (intersect result, turned wedge): the tool is centred and would leave a sealed cavity | refused | refused |
| deep: 0, negative, non-numeric or NaN | refused | refused |
| along: 'x' \| 'y' \| 'z' drill axis (default z), through and blind, at default and explicit | supported | supported |
| along: any other value ('w', 'Z') | refused | refused |
| at:[a,b] in-plane position for z, y and x drills (z: x,y; y: x,z; x: y,z) | supported | supported |
| at with a wrong number of values ([1], [1,2,3]) | refused | refused |
| at: non-finite value (NaN, Infinity) | refused | refused |
| at: position off the part, the bore touches no material | refused | refused |
| hole whose centre lies in empty space of the host (L-shaped pad, bbox centre in the notch) | refused | refused |
| counterbore:{across,deep}: recess diameter and depth - through, blind, along x and y, with size, on a box, pad, hexagonal prism and cylinder | supported | supported |
| counterbore whose ring breaks out of the part side, or is wider than the plate (ring cut clean across the top) | supported | supported |
| counterbore geometric degeneracy: narrower than or equal to the bore, deeper than the blind hole, equal to it, deeper than the part (21, 30 in a 20 thick box), deeper than the 10 plate | refused | refused |
| counterbore with a missing or zero parameter | refused | refused |
| counterbore or countersink where the part is not flat and level under the bore: over a pocket floor, on the low step of a join, on a tilted slab, over the open cavity of a hollow, twice on the same spot | refused | refused |
| counterbore on the high step of a join (top of the part is the bbox top) and beside a pocket (axis on the full-height top, recess ring reaching over the pocket) | supported | supported |
| the same counterbored hole drilled twice | refused | refused |
| countersink:{across,angle}: mouth diameter and INCLUDED cone angle < 180 - 60, 90, 120 and 179 degrees, through, blind, along y, in a cylinder, with size | supported | supported |
| countersink with a nearly flat cone (included angle 179: cone 0.03 deep) | unsupported | refused |
| countersink whose cone leaves through the bottom of the plate (cone 3 deep, tool 3.3 deep, plate 2 to 5 thick; mouth wider than the plate) | supported | refused |
| countersink whose cone breaks out of a side face (mouth 12 across centred 4 from the x=0 edge of the plate) | unsupported | refused |
| countersink cone deeper than, equal to, or within the cone TOOL depth (R - 0.9 r)/tan(half) + 0.05 of a blind hole (12/90 over a 6 bore: blind 1 to 3.34; 12/120: blind 1.5 to 1.95; 20/90 over 10: blind 5 to 5.5; 6/60 over 3: blind 2.7, 2.9; holes() 8/90 over 4, blind 2.1) | refused | refused |
| countersink on a blind hole just deeper than the cone tool depth (12/90: blind 3.36, 3.5, 4, 6, 10; 12/120: 1.96, 2, 3; 20/90: 5.56, 6, 9; 6/60: 2.95, 3.5) | supported | supported |
| countersink tangent rim (30 across mouth on a 30 deep plate; 10 across mouth on a 10 high plate along y) | refused | refused |
| counterbore ring tangent to the part side or as wide as the plate (rim tangent to the x=0 edge; 30 across on the 30 deep plate) | refused | refused |
| countersink degeneracy (narrower than the bore, equal to the bore) | refused | refused |
| countersink included angle >= 180, <= 0, negative, or missing across/angle | refused | refused |
| counterbore and countersink together | refused | refused |
| holes(shape,{apart:[dx,dy],...same options}): four-corner holes along z (HoleFeature.corners dx,dy = apart/2): plate, size, at, blind, cylinder | supported | supported |
| holes(): bores that overlap pairwise, break out of the sides, coincide (apart 0 or one axis 0), or a negative apart (read as its absolute value) | supported | supported |
| holes(): every bore misses the part (apart larger than the plate) | refused | refused |
| holes(): along 'x' or 'y' (also blind, with at, with recesses) | refused | refused |
| holes() with counterbore or countersink: four recesses, overlapping or not, through and blind | supported | refused |
| holes() whose recess circles touch each other (12 across recess, 12 apart) | refused | refused |
| holes() without apart or without across | refused | refused |
| holes(): apart with the wrong length, text, or NaN | refused | refused |
| hole on a pocket result: clear of the pocket, through the pocket floor, half in the pocket wall, two holes in sequence, through-with-bound deep | supported | supported |
| bore tangent to the wall of a pocket or of a notch (an interior face: G-TANGENT only looks at the part sides, sibling bores and earlier bores) | supported | supported |
| hole on a pad: L-shaped pad with the bore in the leg (through and blind), circle pad, side and offset front planes | supported | supported |
| hole on a rotated shape: box turned about z 30 (through and blind), box on its edge (x 90), moved box | supported | supported |
| hole through a box tilted 45 degrees about y or 30 degrees about x | supported | supported |
| blind hole on a tilted shape (45 degrees about y, 30 about x, 20 about y) | refused | refused |
| hole on a cylinder lying along y (turned 90 about x), bore along z | unsupported | refused |
| hole on a cone turned to lie along x (bore across the axis) | refused | refused |
| hole on a cross-bore through a cylinder (bore along x through a z cylinder) and a through bore in a box with all edges rounded r2 reaching the rims (37 across) | unsupported | refused |
| hole on a round()ed box (all edges r2): 6 across through | supported | supported |
| hole on a subtract (cut) result: through, and bore centred on the cut wall | supported | supported |
| hole on a join (union) result: blind, flat-topped (abutting boxes of equal height), blind on the high step of a stepped join, and through on its low step | supported | supported |
| hole on a join result, blind, on the LOW step of a stepped part (the layer treats the extent as exact and starts the bore at the high step's top, in air) | refused | refused |
| hole on a repeat() result: copies that touch (one fused block) | supported | supported |
| hole on a repeat() result whose copies do not touch (3 boxes 20 x 20 x 10, step 30) | refused | refused |
| hole on a hollow() result (box 40 x 30 x 20, wall 2, open top): through the floor, and along x through both side walls | supported | supported |
| blind hole from the top of a hollow() with the top open (over the cavity) | refused | refused |
| hole through a closed hollow() (no open side) | refused | refused |
| hole on a revolve (spin) result: through (deep omitted) | refused | refused |
| hole on a revolve (spin) result: blind | refused | refused |
| hole on a mirror() result when the hole targets the mirror (const m = mirror(a, ...); hole(m, ...)): through and blind across the seam | supported | supported |
| hole on the ORIGINAL name after a mirror (mirror(a, ...); hole(a, ...)) | refused | refused |
| successive holes: second/third bore on the earlier hole result (stacked blind bores, overlapping bore, narrower bore continuing below an earlier blind bore, holes() then hole(), two holes in sequence) | supported | supported |
| second bore centred on the wall of an earlier blind bore (hole across 10 deep 10, then hole across 4 at [5,0], through or blind 15) | supported | supported |
| second bore WIDER than the first, centred on its wall (hole across 10 deep 10, then hole across 18 at [5,0]) | unsupported | unsupported |
| redundant hole: the same through hole twice, the same blind bore twice, a narrower shallower bore inside an earlier one | refused | refused |
| crossing bores in a prismatic host (z bore then an x bore that meets it: through/through, blind/through, blind/blind) | refused | refused |
| perpendicular bores that do not meet (z bore at y=12, x bore at y=-12) | supported | supported |
| countersink whose cone leaves through the bottom of the plate with the mouth inside the plate (cone 3 deep, tool 3.3 deep, plate 2 to 5 thick; split out of the round-3 row of the same name on the 0.21.0 re-baseline) | (not in old file) | supported |
| holes() with counterbore: four recesses, overlapping or not, through and blind (counterbore only; split out of the round-3 row of the same name on the 0.21.0 re-baseline) | (not in old file) | supported |
| hole through a box with all edges rounded r2 reaching the rims (37 across; split out of the round-3 cross-bore row on the 0.21.0 re-baseline) | (not in old file) | unsupported |
