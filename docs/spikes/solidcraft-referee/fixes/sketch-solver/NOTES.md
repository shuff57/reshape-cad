# solidcraft sketch-solver: tangency residual + dof/redundant (spike notes, not filed, not pushed)

Base fe3717f2e400010a4cd0e7dd4f294e7091c25625. Clone: scratchpad `fix-sketch`, branch `fix/sketch-solver`, one local
commit (4061ad3). Patch: `sketch-solver.patch` (`git diff fe3717f..HEAD`: solver.rs, redundancy.rs, lib.rs,
new coincident_tangent_tests.rs). `/home/shuff57/solidcraft` untouched.

## Claim supported
A Tangent between a line and an arc/circle, or between two round curves, whose contact is tied through Coincident and
PointOnCurve (direct, chained, via ends or a free point) or through a line Midpoint is evaluated at the contact. It
then holds in the stored points to <1e-9 mm, with dof and redundancy start-independent. NOT fixed: contacts pinned by
Symmetric or by distance alone (see below). A tangent on a round curve of radius under 1e-6 fails.

## Root cause
`touch_point` (crates/sketch/src/solver.rs) only found a contact when the curves SHARE an end point or a line end is in
a PointOnCurve pair. `sketch.constraint.coincident` adds `Coincident{p,q}` between two distinct points, and a contact
can be a free point. With no touch point the Tangent became `Block::User`, residual `|dist(centre,line)| - r`. When
the contact is pinned by Coincident / PointOnCurve / Midpoint that form is a DOUBLE ROOT at the solution.
- Defect 1: stored points are what the residual is evaluated on (no post-solve move). Residual e gives a contact
  error of sqrt(2*R*e); e = 5e-10 (LM stop TOL 1e-9), R = 5 -> 7e-5 mm = the measured 5e-5..1.1e-4.
- Defect 2: singular values at the exact start (rows arc, coincident x2, tangent): 2.59, 1.81, 1.41, 1e-8, ... ->
  rank 3 (tangent row = n . coincident rows). Jittered start before solve sv4 = 1.7e-2; after the solve sv4 = 1.8e-5,
  above the 1e-7 tolerance only by luck: dof 6 from a rough start was itself near-singular.
Shared root cause holds for the routes: (a) ends tied by Coincident (direct/chained); (b) line end Coincident with a
free point that is PointOnCurve of the circle (S10); (c) free point on both curves (S2b); (d) line Midpoint on the
circle. Routes (b)-(d) were not fixed in the first version of this patch; they are now.

## Change
1. `touch_point` -> `contact_through_coincident`: union-find over non-driven `Coincident` pairs; contact = a point
   lying on curve a (its end, a PointOnCurve of it, or for a line, a point that is its Midpoint) in the same class as
   one lying on curve b. Free-form curves count only their ends. Returns the member on the round curve (line+round)
   or the free-form end. Only runs when no shared end / direct point-on-curve exists.
2. `constraint_residual` (redundancy.rs) returns the larger of the TangentAt residual and the touch-free residual, so
   a violated tying constraint still shows.
3. Attribution: a Tangent solved at its contact is also named in `failing` when its touch-free form is violated, but
   only when the sketch is Failed anyway (status rule unchanged: max_residual < 1e-6 is Solved). A sketch is
   therefore never Solved with the tangent in `failing` (case f: tangent error 1.7e-6 vs max_residual 8.3e-7 stays
   Solved and the tangent is NOT named; the 1e-6 acceptance applies to rows, not to the touch-free derived error).
   No extra Jacobian rows.
4. Radius guard (final state only): after the solve, a Tangent with a non-line, non-free-form curve of radius < 1e-6
   mm (= ACCEPT, the solver's own acceptance tolerance; the threshold is arbitrary) is named failing and the solve is
   Failed. It does not look at the start: a start radius of 1e-7 that expands to 5 solves (R=5.00000000000014).
   Legitimate tangent radii: R=1e-7 and 5e-7 now Fail (baseline panics on a rank assertion); R>=2e-6 solves.
No change to LM, rank test or tolerances.

## Every caller of touch_point (grep)
| caller | before | now |
|---|---|---|
| solver.rs build_blocks (~l.1409) | no touch point for Coincident/free-point/Midpoint contacts -> Block::User | Block::TangentAt at the contact (the fix) |
| redundancy.rs constraint_residual (l.128, public, used by engine `redundancy()`) | User residual (true distance error, e.g. 2.0 in c2_t6) | TangentAt residual would return 0.0 while the Coincident is violated; now max(TangentAt, touch-free) = 2.0 again (test `constraint_residual_still_shows_a_violated_tying_constraint`, fails without the redundancy.rs change; baseline value 2.0) |
| loci.rs construct seed (l.899) | no Tie::Normal for these tangents | Tie::Normal{centre, contact, line} is emitted: a CHANGED seed input, only for line+round Tangents with such a contact |
(solver.rs:666 and tests.rs:289 only mention the name in docs/test names.)

## Seed input change: what was verified
All sketch tests incl. construct/loci/continuation pass; seed on/off differential over 40 jittered line+arc joints
(0.05..2 mm): identical status/dof/redundant/tangency in 40/40; phase2 (seed on) improved, none regressed. Not
verified: large sketches with many coincident-tied tangents beyond phase2's 43 fixtures and the critic's rounded
rectangle.

## Tests (coincident_tangent_tests.rs, 11 tests)
Fail on baseline (6 of 8 before this round; the redundancy/midpoint ones below also fail without their code):
tangent holds in stored points over 12 jitters; dof start-independent; coincident chain; free-point contact S10/S2b
(exact + jittered, dof 4/5, redundant [], contact < 1e-8); collapsed-radius tangent fails; duplicate Length still
redundant (baseline flags ['k2','k4'], also spuriously the tangent, so this one FAILS on baseline); midpoint contact
(dof 5, redundant [], contact < 1e-8, amp 0/0.05/0.5; fails with the Midpoint arm disabled: dof 6, redundant k3);
constraint_residual regression (fails without redundancy.rs fix); never failing while Solved (60 starts).
Pass on baseline (guards only): conflicting Lengths still Failed; infeasible joint names the tangent.

## Not fixed (repro)
- Contact pinned by PointOnCurve on the LINE plus a Distance with no circle membership (critic row c2): the contact is
  not a point on the round curve, so there is no touch point; touch-free double root remains (dof {5,6}, redundant
  k4, ~1e-4 mm contact error, silently).
- Symmetric contacts and other chains: same.
- Collapsed-radius guard fails any tangent on a round curve < 1e-6 mm that previously Solved.
- Cost: union-find over all points per Tangent without a direct contact.
- `failing` gains the tangent on infeasible sketches (one more entry).

## Results
Final tree (commit 4061ad3), run sequentially, -j4:
- `cargo test --release -p solidcraft-sketch`: 198 passed, 0 failed, 3 ignored. rustfmt --check, clippy
  --all-targets: clean.
- Engine `-- sketch constraint dimension profile pattern robustness` (2 threads): 349 passed, 0 failed, 2 ignored
  (includes robustness goldens; 1394 s under load). The full engine suite was not re-run after the last change.
- phase2 stored/rough: base stored PASS 20 FAIL 1 MISREPORTED 4 / rough PASS 19 FAIL 5; fixed stored PASS 24 FAIL 0 /
  rough PASS 23 FAIL 1 (pre-existing own-l-shape-dims 1.11e-9 bbox delta). Logs: phase2-base/, phase2-fixed/.
- 12 jitters + exact (tangent-probe-before-after.txt): exact dof 7/redundant -> dof 6/[]; perp 5e-5..1.1e-4 -> <=2e-12
  mm, 12/12 dof 6.
- Critic S-series (critic-probes-after.txt, their checker independent of solver code): every feasible sketch has
  tan_dist_err <= 7.3e-10; S10/S2b 36 runs dof 5 or 6 (true values), redundant [], contact_perp <= 5.5e-10.

| probe | baseline | fixed |
|---|---|---|
| line+arc coincident+tangent, exact | dof 7, redundant [k2] | dof 6, [] |
| same, 12 jitters perp (mm) | 5e-5..1.1e-4 | <=2e-12 |
| S10 exact / jittered | dof 6 [k3] / perp 5e-5..1.3e-4 | dof 5 [] / perp <=5e-10 |
| S2b exact / jittered | dof 7 [k3] / perp 6e-5..1e-4 | dof 6 [] / perp <=5.5e-10 |
| Midpoint contact (row b) | dof 6, redundant k3 | dof 5, [], contact <1e-8 (test) |
| c2: PointOnCurve on line + distance | dof {5,6}, k4, 1e-4 | NOT fixed |
| S7 tangent + centre on line | Solved, radius collapsed | Failed [k2] |
| S7b/c infeasible failing | [k2,k3,k4] | [k1,k3,k4,k2] |
| constraint_residual c2_t6 | 2.0 | 2.0 (0.0 without the redundancy.rs fix) |
(S10/S2b/Midpoint baseline values are the critic's; not re-run here.)
