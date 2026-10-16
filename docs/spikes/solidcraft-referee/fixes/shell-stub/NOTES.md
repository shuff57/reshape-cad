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
