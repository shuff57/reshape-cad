# solid.shell with material standing on the opened face (draft 04) - fix notes

Clone: scratchpad/fix-shell, branch fix/shell-stub, commit 178110f on fe3717f. Patch: shell-stub.patch
(git diff fe3717f..HEAD; polyhedron.rs +63, tests.rs +76, tests/robustness/goldens.json). Not pushed, no PR.

## Root cause (measured)
polyhedron.rs shell_planar -> shell_opened builds the cavity by offset_planar with open faces moved OUT by
margin = thickness + 0.05*size (3.657 for the draft's body, size 53.14 = diagonal). offset_body puts each vertex where
its faces' moved planes meet, so the boss's foot corners, which lie on the open face, ride up with it: printed cavity
vertices (+-4,+-4,8.657) = 5 + margin. The Boolean cut then removes the boss's tube wall from z 5 to 8.657
((100-64)*3.657 = 131.65 mm3, the draft's missing volume). Control: margin forced to 0 gives 2776.000 (P) exactly.

## Semantics: plane offset (P)
solidcraft's own shell tests (shell_non_convex: cavity = every face moved in by t) and offset.rs's header imply P,
not connected erosion L. Under P a boss clear of every wall has a tube resting on nothing.

## Fix
1. If any non-open face has a vertex beyond the plane of an opened planar face (material stands on the opening),
   margin = 0. Plain bodies take the old code path unchanged.
2. In that case refuse (KernelError::Failed) if shelling splits a piece: per input piece, more than one output piece
   inside its bounding box, or more pieces than before. Sentence: "not supported yet: a boss or wall stands on the open
   face and the T mm shell would leave it free of the rest of the part: every face moves in by the thickness, so nothing
   is left under it (a thinner shell does not help unless it touches a wall; shell first and add the boss afterwards)".
3. Every other failure keeps the kernel's own text (an earlier relabel arm was removed after review: e.g. a 2 mm rib on
   the open top still says "the move is larger than a rim or ledge near [0,-14,9] is wide").

## 6 variants (native solidcraft-cli, fixed build)
| variant | before | after | P | L |
|---|---|---|---|---|
| centre | 2644.346 | refused (sentence above) | 2776 | 2856 |
| offset-x | 2644.346 | refused | 2776 | 2856 |
| corner | 2713.830 | 2776.000 | 2776 | 2812 |
| edge-flush | 2680.916 | 2776.000 | 2776 | 2832 |
| tall | 3182.356 | refused | 3300 | 3364 |
| low | 2524.000 | refused | 2612 | 2708 |
(Re-measured on the final commit.)

## Scope: the patch also changes non-boss cases (critic-verified against hand-derived P; baseline -> fixed vs P)
L-step open at top 15303 -> 15744; T tab 6799.5 -> 6927; pocket floor 3202 -> 3472; boss-top 3672 -> 3688;
cylindrical pocket-floor 4077 -> 4243.8 (4244.3); boss with through hole 2870.5 -> 3002.18 (3002.2). These are
the critic's measurements, not re-run by me. Plain bodies (nothing beyond the open plane): identical in the critic's battery.

## Round boss tangent to two walls
r4 at (16,11), h6, t1: shell 2586.148 vs P 2584.221 (+1.93 mm3, 7.5e-4). Not the measurer: the same part composed by
Boolean (body minus box cavity minus r3 cylinder) measures 2584.218 with the same measurer. Tangent to one wall (16,5)
2584.211; 0.1 mm off tangency 2584.212. So a real kernel error at a double tangency; claim exactness for planar-footed
bosses only. A round boss touching the cavity wall tangentially (15,10) is refused by the kernel ("shell boundaries
intersect or touch").

## Lump-rule gap
Count-only comparison would miss "one piece swallowed, another floats". Replaced by the per-piece check. Tests: one
attached + one free boss refused; free boss plus a separate plate in the same body refused. A swallowed-piece case could
not be built: swallowing needs faces to cross, which the offset already refuses.

## Robustness goldens (final, commits 3dbe11b + golden commit)
Only seed 48 is changed by the patch: volume 7044.773 -> 7141.547 (faces 28->33, edges 66->77); hand-worked cavity
gives 7141.39 (critic), baseline was 1.4% low. Seed 86 (the earlier edit) is NOT changed any more: with the narrowed
guard it takes the baseline route again (replay: same steps/failure as the stored golden); seeds 14, 40, 43, 83 reverted
earlier. Seed 18 fails identically on pristine fe3717f ('This wire is not simple' vs the stored text): a pre-existing
stale golden, untouched.
Shards on the final build, each under systemd-run MemoryMax=30G, one at a time: all_0 pass (260 s), all_1 pass (599 s),
all_3 pass (253 s), all_2 fails ONLY on seed 18 (pre-existing; 193 s). Seed 81 (in all_1): passes on the fixed build within the
cap; I did not measure its peak memory, nor run it on baseline, so whether it is a baseline memory hog is unverified.


## Memory runaway found and fixed (after commit 178110f)
Coordinator measurement: robustness seed 73 (extruded D-profile, fillet, box joined on the round wall, shell 1.5 opened at
the box underside) took 1.9 s / 108 MB on pristine fe3717f (shell refused: "offset: a corner whose faces don't meet the
same way after the move") but exceeded 40 GB (66 GB uncapped) on 178110f: with margin 0 the shell now succeeded on this
body and measuring/tessellating the result recursed without end (truck sub_parameter_division on a NURBS curve).
My capped reproduction: the engine regression test below, on the 178110f polyhedron.rs, did not finish in 150 s (8 GB cap).
Fix: the margin-0 path ("material stands on the open face") is now restricted to bodies whose faces are ALL planes
(polyhedron.rs `rises = all faces Plane && material_rises_from`). Bodies with any curved face take the old path and its
refusals. This narrows the verified scope: planar bosses/walls only (the cylinder-footed cases the critic verified
(round boss, pocket floor in a cylinder) now go through the old path again and are NOT claimed).
Tests added: kernel `shell_open_underside_of_a_box_on_a_round_wall_terminates` (a similar D-body; refused fast) and engine
`tests::robustness::shell_open_underside_on_a_round_wall_ends` (seed 73's exact commands: shell refused, < 60 s).
Fixed build, capped: engine test passes in 2 s.

### Memory runaway - final state (commit 3dbe11b)
A first narrowing to "all faces planar" fixed seed 73 but also dropped seed 48 (its hole cylinders), so the final rule is:
the margin-0 path runs only when every face is a plane or cylinder (offset::surf_of) AND no face standing on the open
plane shares an edge with a non-planar face (`faces_standing_on`, `meets_a_round`). Seed 73's body is plane/cylinder only
(a box joined on the round wall), so the first rule alone (planes+cylinders) still ran away (engine test >60 s, killed by
timeout); the adjacency rule is what stops it. Seed 48 (box on a flat top, holes elsewhere) still gets 7141.547.
The cause inside truck (why that cut yields a curve the tessellator recurses on) was NOT diagnosed; the guard is empirical
(two seeds), so other plane/cylinder bodies with a round meeting what stands on the open face are the residual risk, and
are exactly what the guard sends to the old path.
Tests: engine `shell_open_underside_on_a_round_wall_ends` (seed 73 exact commands; 1.6 s; shell refused),
`shell_open_top_with_a_box_on_it_keeps_the_wall` (seed 48, 7141.547 +-0.05); kernel
`shell_open_underside_of_a_box_on_a_round_wall_terminates`. Un-fixed commit 178110f: seed-73 engine test did not finish in 150 s.
Results on 3dbe11b (all runs under systemd-run MemoryMax caps): kernel lib 430 passed / 0 failed / 26 ignored; engine
`--lib shell` 23 passed / 0 failed; clippy -D warnings (kernel, engine, all targets) clean; cargo fmt --check clean;
6-variant table unchanged (centre/offset-x/tall/low refused, corner and edge-flush 2776.000).

## Claim allowed (final)
For planar-footed bosses and walls on an opened face (bodies of planes and cylinders where nothing standing on the open
plane meets a round wall), solid.shell uses the plane offset: exact on the 6 variants (2776.000 for the two that stay
attached), seed 48 7141.547 vs hand-worked 7141.39. Where the offset would leave a boss free of the part it refuses with
a plain sentence. Everything else (curved/standing-on-round bodies) keeps the old path unchanged. The scope list above of
cylindrical-pocket / round-boss improvements was the critic's measurement on 178110f and is NOT claimed for 3dbe11b.
Known: round boss tangent to two walls was +7.5e-4 off P on 178110f (real kernel error); on 3dbe11b a round boss has a
cylinder next to what stands, and the case was not re-measured.

## Truthful old path (commit d8c35a2; supersedes "Claim allowed" above)
Critic finding: when material stands on the open plane but the exact path was not taken (a round face beside it, a
torus, ...), the old path returned the boss cut short, silently (-1.7%..-5.5%). Now: if something stands on the open
plane and the exact path does not apply, the old path is still run so its own refusals keep their text, and a body it
would return is refused instead: "not supported yet: a boss or wall stands on the open face of a body with round faces (or
on a round wall); solid.shell would cut it short here, so it is not built (open a face nothing stands on, or shell before
adding the boss)". Also refused: what stands on the open face is not taller than the shell is thick (pads 0.5 and 0.01 mm,
t=1: baseline and the exact path gave +1.3%/+2.6% too heavy), and the floating-piece sentence now says "something stands on
the open face (a boss, a rim or a pocket's walls) ... would leave part of it free of the rest of the part".
Critic cases, before (silent number) -> now:
| case | ref P | before | now |
|---|---|---|---|
| n6 rounded-corner plate, wall-flush boss | 2729.646 | 2634.554 | refused |
| n9 corner boss with a hole through it | 3002.195 | 2940.007 | refused |
| n11 round pocket floor open | 3393.752 | 3233.572 | refused |
| n10 round boss r4 at (16,11) | 2584.221 | 2539.500 | refused |
| n13 bottom-rounded box, corner boss | 2776 | 2624.632 | refused |
| n8b pad 0.5 mm, t=1 | 2474 | 2497.5 (base) / 2506 (exact path) | refused |
Still exact on the verified path (engine tests): n19 step boss 4240.0, n5 L-body boss 5528.0, n2 two bosses 3128.0,
n6b rounded plate without boss 2377.638 (ref 2377.646). Tests: engine `shell_with_material_on_the_open_face_is_refused_where_not_exact`
(6 cases) and `..._keeps_the_exact_cases` (4 controls).
Plain-body identity (no material above the open plane), baseline fe3717f vs fixed, status and volume: box, L, T, cylinder,
box with through hole, pocket, boss on a different face (open bottom), open +x face, two open faces, rounded-edge box,
counterbore plate, sphere (both: same offset refusal) - 12 of 12 identical (volumes e.g. 2424.0, 4424.0, 1824.0, 3348.559,
2593.633, 2752.0, 2712.0, 3264.0, 1360.0, 2377.638, 2628.188). Faces/bbox were not compared (volume and status only).
Unrelated, pre-existing, NOT fixed and not caused by this patch (baseline = fixed): (a) counterbore+hole plate open top, no boss:
2628.188 vs a hand reference 2577.938 (+50.27 = pi*4^2*1); (b) cylinder with a box joined on its round wall, open = cylinder
top (n17b): 3760.8 vs P 4477.2 (-16%), nothing stands on the open plane so my rule does not see it.

## FINAL STATE (supersedes everything above where it differs)
Rule set in polyhedron.rs shell_planar:
1. "Standing" = a face (not an opened one) that meets an opened planar face along a CONCAVE edge (its outward normal there
   points back over the open face; the sign comes from the open face's own mesh). Earlier versions (any point beyond the
   plane; a triangle with two corners on the plane) over-flagged ring ends, plates and notch walls (existing engine tests and
   seeds 19 and 24 caught it) and were replaced.
2. Nothing standing: the old path, untouched.
3. Standing, every face a plane or cylinder, no standing face meeting a round face: margin 0 (exact plane offset), then
   refuse if a piece comes apart or what stands is not taller than the shell is thick.
4. Standing, otherwise: the old path is run so its own refusals keep their text; a body it returns is refused with the
   "round faces" sentence (never a truncated part).

Critic cases, final (ref P hand-derived by the critic):
| case | ref P | baseline | final |
|---|---|---|---|
| n10 round boss r4 tangent to two walls | 2584.221 | 2539.500 | refused |
| n11 round pocket floor open | 3393.752 | 3233.572 | refused |
| n6 rounded-corner plate, wall-flush boss | 2729.646 | 2634.554 | 2729.638 (exact path) |
| n9 corner boss with a hole through it | 3002.195 | 2940.007 | 3002.177 (exact path) |
| n13 bottom-rounded box, corner boss | 2776 (ignores the rounding) | 2624.632 | 2686.88 (exact path; my hand estimate ~2684 = 2776 minus the rounding loss; NOT independently verified) |
| n8b / n8c pads 0.5 / 0.01 mm, t=1 | 2474 / 2425 | 2497.5 / 2488.19 | refused (shorter than the shell is thick) |
| n4 pocket with a rim boss | 3160 | 3097.83 | refused (pocket walls would float) |
Exact path also: n19 4240.0, n5 5528.0, n2 3128.0, n2c 2856.0, n4b 3440.0, n12/n3 2945.633 (P 2945.646), n1/n1c within 2e-4.
Tests: engine `shell_with_material_on_the_open_face_is_refused_where_not_exact` (n10, n11, n8b) and `..._keeps_the_exact_cases`
(n6, n9, n6b, n19, n5, n2); kernel `shell_open_*`; engine seed 73 (ends, refused) and seed 48 (7141.547) tests.
Plain-body identity (volume and status, fixed vs baseline): box, L, T, cylinder, box with hole, pocket, boss on another face
(open bottom), open +x face, two open faces, rounded-edge box, counterbore plate, sphere: 12/12 identical. That battery was run
on the version before the concave-edge detection; the final detection only narrows what counts as standing and was not
re-run on the battery (the engine/kernel shell tests and all goldens do pass).

Residual silent-wrong cases I know of (all equal to baseline, none are new): n7 vertex-contact boss 2720 (touches the open face
at one vertex only, no shared edge, so it is not seen); n17b cylinder top open with a box joined on its wall 3760.8 vs P 4477.2;
counterbore+hole plate 2628.188 vs hand 2577.938 (n20 is that + 352).

Results (all runs capped with systemd-run MemoryMax): kernel lib 430 passed / 0 failed / 26 ignored; engine `--lib shell`
25 passed; clippy -D warnings (kernel, engine) clean. Goldens one shard at a time, 30 GB cap: all_0 pass (358 s), all_3 pass
(399 s), all_2 fails only on pre-existing seed 18 (252 s), all_1 differed only in seed 53 (1151 s), then recorded (re-run below).
Goldens changed by the patch: seed 48 (7044.773 -> 7141.547; hand-worked 7141.39) and seed 53 (16607.030 -> 16943.636, +336.6:
the open wall of a notched plate; the notch floor stands on it and the old margin cut a ~2 x 5.5 x 31 = ~341 mm3 lip off it).
Seeds 86, 14, 40, 43, 83, 19, 24, 45, 69 are unchanged. Seed 18: pre-existing stale golden (fails identically on fe3717f).
Seed 81 is independent of the patch (critic: 309 s/560 MB baseline vs 314 s/580 MB fixed). No runaway: seed 73 ends in 1.6 s.
all_1 re-run with seed 53 recorded: pass (869 s). cargo fmt --check clean.

## Thin standing wall (commit d9df6230 on top of 80c1e67; supersedes the exact-path claim for rims)
Critic finding, reproduced: a rim (outer 10x10, 6 mm tall, flush in a plate corner, shell t=1) thinner than 2t built on the
exact path with an artefact. The loop-crossing check in offset.rs (`crossed_loops`) never sees it, because the rim top's
inner loop grows past its outer loop without any edge crossing (the hole ends up enclosing the outer boundary).
Fix (polyhedron.rs, `thin_standing_wall`, only in the standing/exact path, offset.rs untouched): refuse when a standing
plane has an antiparallel overlapping plane behind it, or a convex standing cylinder a coaxial concave one inside it, with
a gap in (0, 2t + tol]. Sentence: "not supported yet: a wall standing on the open face is only W mm thick and the shell is
T mm, so its two sides would cross (a wall needs more than twice the shell thickness; use a thinner shell or a thicker wall)".
Rule for exactly 2t (w = 2.0): REFUSED. The cavity wall there has zero thickness, the cut meets coincident faces, and the
result carries a 3e-5 artefact (2872.087 vs 2872); refusing at <= 2t is consistent with the existing `<= 0` area test and
with the 5x5 boss at t=3. Walls above 2t stay exact.
| rim wall w | P = 2872 - 48 (w - 2) | baseline fe3717f | before this fix (80c1e67) | now |
|---|---|---|---|---|
| 3 | 2824 | 2762.377 | 2824.000 | 2824.000 |
| 2.5 | 2848 | 2786.377 | 2848.000 | 2848.000 |
| 2.2 | 2862.4 | 2800.777 | 2862.400 | 2862.400 |
| 2.05 | 2869.6 | 2807.977 | 2869.600 | 2869.600 |
| 2.0 | 2872 | 2810.377 | 2872.087 | refused |
| 1.95 | (2865.06 crossing) | 2807.410 | 2869.120 | refused |
| 1.8 | (2845.48 crossing) | 2798.110 | 2859.820 | refused |
| 1.5 | (2802.25 crossing) | 2777.710 | 2839.419 | refused |
(P(w) formula fitted to the critic's exact values: 2824, 2848, 2862.4, 2869.6, 2872.) Before/after numbers for 2.0..1.5 match the
critic's 2872.087 / 2869.120 / 2859.820 / 2839.419 exactly.
Regression test: kernel `shell_open_face_with_a_rim_thinner_than_two_walls_is_refused` (w 3, 2.5, 2.2, 2.05 exact to 1e-6;
w 2.0, 1.95, 1.8, 1.5 refused).
Re-run on d9df6230, one job at a time under systemd-run MemoryMax=16G: 19-body plain battery (plain/ + plain2/, volume, faces,
edges, bodies, bbox, status vs fe3717f): 19 same / 0 different. Critic cases unchanged vs 80c1e67: n6 2729.638, n9 3002.177,
n13 2686.883 (still not independently verified), n10 and n11 refused. Kernel `--lib shell` 32 passed; engine `--lib shell` 25 passed.
Not re-run on this commit: full kernel suite, clippy, robustness goldens (the change only adds a refusal inside the
standing path; seeds 48 and 53 take that path, and I did not check their wall thicknesses, so a golden could in principle move).
