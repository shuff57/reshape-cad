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

## Hole ligaments, exact thresholds, and three "wrong" bodies that are right (commits 1a3d78ef, a92f577b + tests commit)
Critic finding, reproduced on fe3717f and d9df6230 (identical): plate 40x30x10, shell t=1 from the top, vertical hole r=2.
Independent closed form (plane offset): cavity = 38x28 rectangle minus the hole discs of radius r+t = 3 (clipped to the
rectangle), height 9; outer = 12000 - hole. For a hole clear of the wall P = 2424 + 41 pi = 2552.795 (two holes 2424 + 82 pi
= 2681.591). For web 1.0 the disc r=3 pokes 1.0 past the offset wall at x=19: segment 9 acos(2/3) - 2 sqrt(5) = 3.0975 mm2, so
P = 2524.93 (critic's value reproduced). Cause: the topology-keeping offset moves the hole wall out by t and the side wall in
by t; where the web is under 2t they cross, nothing in offset.rs sees a cylinder crossing a plane, and the cavity comes out
too small. Refused in polyhedron.rs (`thin_web`): a concave cylinder and a plane parallel to its axis (or another parallel
hole) with material between them, a gap in (0, 2t), overlapping extents. A web of exactly 2t is fine (measured: 2552.7962 vs
2552.7953) and builds. The refusal only replaces a part the shell built: where the shell fails by itself its own message stands.
| case | closed-form P | fe3717f (= before) | now |
|---|---|---|---|
| hole web 1.0 east | 2524.93 | 2549.090 | refused |
| hole web 1.0 north | 2524.87 (critic) | 2548.580 | refused |
| hole web 1.5 | - | 2551.229 | refused |
| hole web 1.9 east | 2551.88 (critic) | 2552.772 | refused |
| hole web 2.0 east | 2552.795 | 2552.796 | 2552.796 (built) |
| hole web 2.1 / 3.0 | 2552.795 | 2552.795 | 2552.795 (built) |
| two holes 1.0 apart | 2661.10 (critic) | 2678.591 | refused |
| two holes 1.9 apart | - | 2681.494 | refused |
| two holes 2.1 apart | 2681.591 | 2681.591 | 2681.591 (built) |
Existing engine test `shell_with_a_hole_through_a_curved_side` had the hole 2.5 mm from the side wall at t=2 (under 2t = 4): it
only checked that the shell ran. The hole is moved to the plate's centre line (web 5) and the original geometry is a new test that
expects the refusal. NOT independently measured: that the old result of that body was wrong (inferred by analogy to the plate).

Exact rim threshold: the guard used `2t + 100*tol` (0.005 for these sizes), so rims of 2.002..2.005 (t=1) and 4.002..4.005 (t=2)
were refused though the cut is right there. It is now `2t + 1e-9*size`: w <= 2t refused, w > 2t built. Tests:
`shell_rim_threshold_is_exactly_twice_the_shell` (t=1: 2.0005, 2.002, 2.005, 2.006 equal 2872 - 48 (w-2) to 1e-6; t=2: 4.002,
4.005, 4.02 on the straight line through the volumes at 4.1 and 4.5 to 1e-6 - the t=2 line is a consistency check, not a
closed form; 2.0 and 4.0, 3.9 refused). The thin-wall refusal also now only replaces a built part.

Bodies the loop plan listed as silent wrong solids that are NOT wrong (independent closed forms; unchanged, pinned by
`shell_bodies_that_are_exact_stay_exact`):
- counterbore plate (r2 hole at (-8,-6), r4 x 2 counterbore), open top, t=1: cavity = 1064 x 9 - 129 pi, outer = 12000 - 64 pi,
  P = 2424 + 65 pi = 2628.2036; app 2628.1884 (6e-6). (My earlier "hand reference 2577.938" was wrong - that number is the OPEN
  BOTTOM variant, 2424 + 49 pi = 2577.9376; app 2577.927.) With the corner boss (n20): 2628.2036 + 352 = 2980.2036; app 2980.188.
  The critic's P 2929.938 for n20 does not match this calculation.
- n17b, cylinder r15 h30 with a 14x10x10 box joined on its wall, cylinder top open, t=1: outer 22334.0106; cavity = pi 196 x 29
  + the box's inner part outside the cylinder (integral over |y|<4 of (25 - sqrt(196 - y^2)) x 8 = 716.34); P = 3760.854; app
  3760.8355 (5e-6). The critic's 4477.198 equals outer minus the cylinder cavity alone, i.e. it leaves the box solid.
- n7, boss touching the open face at one vertex: a separate piece; the offset hollows it closed: plate 2424 + (8^3 - 6^3 = 296) =
  2720; app 2720.0. The critic's 2424 omits the boss. Caveat: the result has a sealed void inside a piece that touches the plate at
  a single vertex; if a different semantics is wanted (e.g. refuse such contact) that is a policy choice, not a measured error.

Gates on a92f577b + tests commit (capped systemd-run, one at a time): 19-body battery 19 same / 0 different vs fe3717f;
critic cases n6 2729.638, n9 3002.177, n13 2686.883 (unverified), n10 and n11 refused (unchanged); rim table: 3, 2.5, 2.2, 2.05
exact, 2.0, 1.95, 1.8, 1.5 refused; kernel lib 433 passed / 0 failed / 26 ignored; engine `--lib shell` 27 passed; clippy -D
warnings (kernel, engine) clean; fmt --check clean; goldens all_0, all_1, all_3 pass, all_2 fails only on pre-existing seed 18.
Seeds 48 and 53 are recorded as in the earlier commits and remain PROVISIONAL until the upstream bisect (LOOP-PLAN A6, B1); no
golden was added or changed in this step. One earlier version of the ligament refusal replaced a baseline failure message and
moved seed 69; that is why the new refusals only replace a built part.

## Round 5: one general check instead of family guards (commits 0d3f9927 .. 430f0ec9 on b23218e9)
Rule (polyhedron.rs `cavity_too_close`): after the cut, every face of the shell's cavity must stay at least the shell
thickness away from every face of the part other than the open ones. Samples: the cavity mesh (a grid over flat faces,
corners of curved ones, projected onto their surface), its corners and edge points; distance measured square to the part's
triangles (foot inside the triangle); feet within `t` above an open plane do not count (the open face extruded out by t
is solid for the cut); cavity above an open plane is not part. Tolerances: flat vs flat exact (1e-6 size, 0.2% of t);
a curved face on either side must fall short by 10% of t (edges where curved faces meet are rebuilt through moved
points and sit up to 5% of t off). Skipped when the cavity has fewer faces than the part (a round thinner than the shell
collapsed). It runs on the cut's cavity and on the closed-up cavity of the second way (`shell_by_opening`).
Like the earlier guards it only replaces a shell that would have been built; a shell that fails by itself keeps its message.
Also in this round:
- Cause of the countersink error (B): the open face is pushed out by the margin, a cone flares with it past the open plane
  and crosses the other offset walls there. Bodies with a cone now use a margin of 0.5% of the size (D=10, t=2: 3392.9 ->
  3474.6, oracle 3474.865). A countersink cone that reaches the opening in the closed-up way is refused (D=14 t=2 etc. were
  -2.7%..-3.9%); a convex chamfer-like cone is flagged the same way (a bore mouth chamfer is a countersink to the offset).
- n7 (boss touching at a vertex): refused ("two pieces of this part meet only at a point or along an edge ...").
- D: the shell's own failures no longer name internals. A failed cutting step -> "the kernel cannot build this shell yet:
  its inner wall meets the part's own faces in a way it cannot cut ...". The offset's size limit ("rim or ledge", "wall or
  step is thick") loses its "offset:" prefix; its corner message is unchanged (10 goldens carry it).
- Tests: engine `shell_refuses_material_thinner_than_twice_the_shell` (floors 1.5/1.2/1.2 t=1, pocket t=2.5 floor 4,
  opposed holes 1.5, pocket-wide, csink D=10 t=2.5 and D=18 t=1 - none may name boolean/fallback/offset:/coincident),
  `shell_builds_material_at_twice_the_shell_and_more` (floor 2.0 = 1656 + 49 pi, csink D=10 t=2 3474.865, D=8 t=1),
  `shell_of_pieces_that_touch_at_a_point_is_refused`; kernel rim threshold, ligament, rim tests accept both sentences.
  The n7 pin (2720) in `shell_bodies_that_are_exact_stay_exact` was removed (now refused).

### Data (c8 critic rows, 388 distinct cases rebuilt from cases.mjs + results.jsonl P values, CLI of the head commit)
Baseline fe3717f: 320 built, 94 built-mismatch >1e-3. b23218e9: 288 built, 43 mismatch. Head: 261 built, 127 refused,
16 built-mismatch, all 16 family f8 (plate chamfer/fillet) - see below; 0 internals in refusal sentences.
Every non-f8 mismatch row listed in the brief is now built within 1e-3 of P or refused: blind d8.5 floor 1.5 (1817.777 vs
1803.580) refused; slot d8.8 (2115.6 vs 2043.6) refused; pocket 10x8 d8.8 (2128 vs 2032) refused; pocket 20x16 d8.8
(2720.8 vs 2404) refused; pocket 10x8 t=2.5 d6 (4815 vs 4620) refused; opposed holes web 1.2/1.5/1.9 refused; pocket-wide
t=2.5 d5/d6 refused; csink t=2/2.5/3 and D=18 t=1 refused or exact (D=10 t=2 now 3474.567 vs 3474.865). Controls: floor 2.0
builds (1809.924 vs 1809.938 closed form), 2.1 builds.
f8 (not changed, not a defect I can show): plate chamfer rows differ from P by 1e-3..2.6e-3 and bottom-fillet rows by
+1.8%..+5.3%. For chamfer the critic's P is cube erosion, which shifts an inclined plane by t(|nx|+|nz|) instead of t; my
hand plane offset of "plate top-chamfer 1 t=0.5" is 884.3 and the app gives 884.258 (P 886.383). For the fillet rows I did
not compute a plane-offset closed form; the same cube-vs-Euclid argument applies to a convex round but is unverified.

### Fuzz (docs/spikes/solidcraft-referee/fuzz): the 932 cases with an oracle P that I could run (sweep seed 9 + first 500 of seed 1)
p7 (80c1e67): 303/1790 WRONG over the full 2000. Head, on these 932: MATCH 426, WRONG 0, REFUSED 506 (p7 on the same rows:
MATCH 453, WRONG 124, REFUSED 355). 29 rows p7 matched are refused now (webs/gaps in [t,2t) that happen to match
within 1e-3, e.g. web 1.9 t=1); 2 p7 WRONG rows now MATCH; 122 p7 WRONG rows are refused. The 10 repros (fuzz/repros): all
refused in plain sentences (s1-00031, s1-00038, s1-00201 (the lobes-dropped large form), s1-00501, sw-0164, sw-0177, sw-0195,
sw-0196, sw-0310) and the wall=2 rim (sw-0286). Rim w > 2t builds exact (2.05..3: 2869.6, 2862.4, 2848, 2824).
The remaining 1068 cases of the 2000 and cases needing other oracles were not run by me.

### Gates on 430f0ec9 (capped, one at a time)
19-body battery 19 same / 0 different; critic cases n6 2729.638, n9 3002.177, n13 2686.883 (unverified), n10/n11 refused;
rim table (2.05, 2.2, 2.5, 3 exact; 2.0, 1.95, 1.8, 1.5 refused); hole-web table (2.0, 2.1, 3.0 and two holes 2.1 build; 1.0,
1.5, 1.9 refuse); kernel lib 433 passed / 0 failed / 26 ignored; engine `--lib shell` 30 passed; clippy -D warnings and
`cargo fmt --check` clean.
Goldens (not re-recorded): all_2 fails only on pre-existing seed 18. all_0 FAILS on seed 24, all_1 on seed 61, all_3 on
seed 19: each built a shell before and is refused now, after which the fuzz run takes other steps. 53/48 pass as recorded
(provisional). No independent P exists for these three bodies. Why each is flagged: 61 (arc end plate with a r10 channel
cut, t=2) overlap 1.914 mm at [-10.47, 10.69, 7.48], the large-form hole/wall mechanism; 19 (270 deg ring with a r10
sphere bite, t=1) the cavity's sphere face reaches z=-4.98, 0.02 above the bottom plane that the offset puts at -4
(overlap 0.909); 24 a hollow cone (a chamfered bore mouth) reaches the opening in the closed-up shell, the countersink
class that was 2.7..3.9% wrong. These three goldens need the maintainer's decision (record the refusal, or keep the
built shell); I did not choose.
