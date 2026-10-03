# SPEC — brep-rs: soundness guards (2026-10-03)

Parent: `SPEC-brep-kernel-rs.md` §4.5. Status: DRAFT for owner review. No code changes in this document.

## Why

With no fallback engine, the only thing between a student and a wrong part is the guard set in
`ops::boolean` (`packages/brep-rs/src/ops.rs:4702`). A kernel review (2026-10-03) found three holes
that let a closed-looking wrong solid through, in the class `AGENTS.md` ranks above refusals.

| # | Hole | Evidence |
|---|---|---|
| G1 | The manifold guard accepts an edge used once, so it cannot see an open shell. Only `volume_is_translation_invariant` backstops it. | `ops.rs:~4727` (comment), `edge_use_counts` `:4801`, `once_used_edges` is `#[cfg(test)]` `:4819` |
| G2 | `boolean_result_is_sound` returns `true` (abstains) whenever either operand has a Sphere or Torus face. | `ops.rs:4967-4977` |
| G3 | No test proves every `match` on `Surface` has a Sphere/Torus/Cone arm in each operation. `flip_face` (I-1) and `region_inside` were both this class. | `PLAN-next.md` §7 row 12 (manual audit) |

Related, smaller: H7 (cross-trim guard scans string fields only, `wasm.rs:696-713`).

## G1 — closure guard

Goal: refuse a result whose shell has an unmatched edge, while still allowing the legal once-used
seam of a closed circle (a seam is one handle used twice by one face, or once per wire of two faces).

Design:
1. Classify once-used edges instead of banning them. An edge handle with count 1 is legal only if
   it is a closed curve (Circle, or an Arc/BSpline whose start vertex equals its end vertex) AND
   the same geometric curve appears on exactly one other face use (match by `same_edge_geometry`,
   `ops.rs`, not by handle). Every other count-1 edge is an open rim: refuse.
2. Promote `once_used_edges` out of `#[cfg(test)]` and have `boolean` call the refined check
   after `weld_shared_edges`.
3. Keep `volume_is_translation_invariant` as the second, independent line.

Acceptance:
- Unit test builds a known open shell (drop one face of a closed box result) and asserts refusal.
- All existing boolean tests still pass (cargo 337 + the one known K2b failure, unchanged).
- Gates unchanged: parity 76/2, mesh 76/2, step 69/0/7, occt 17/0. If any gate drops, the guard is
  rejecting a correct solid: STOP, measure which edge, do not loosen the guard to make it pass.
- Measure before merging: count how many currently-built fixtures contain a count-1 edge. Each
  one needs a named reason (seam) or it is a latent wrong solid and gets reported to the owner.

Effort: M. Risk: false refusals of correct curved results (seams). That is the safe direction.

## G2 — sphere/torus soundness

Goal: `boolean_result_is_sound` stops abstaining on Sphere and Torus operands.

Blocker: `inside_solid` is a parity ray test trusted only on Plane/Cylinder/Cone, and
`planar_face_samples` only samples planar faces.

Design:
1. Make `inside_solid` exact for Sphere and Torus faces: ray/sphere is a quadratic, ray/torus a
   quartic (solve with a bracketed root finder; reject near-tangent roots as "ambiguous" and retry
   with a perturbed ray, the same as the existing planar/cylinder handling).
2. Add `face_samples` for Sphere and Torus faces: a fixed (u,v) grid inside the trimmed domain,
   each with its outward normal. Reuse the point-in-trim test the mesher already has.
3. Remove the `plain()` abstention. Keep a narrower abstention: only when a face yields zero
   samples AND is not reachable by any other face check. Count abstentions and expose the count
   to tests so silent abstention is measurable.

Acceptance:
- Mutation tests, as `cone_soundness_rejects_wrong_half_angle` does for cones: a sphere-bore
  result with a wrong radius, and one with the tool's wall dropped, both fail the check while a
  correct one passes. At least four mutants (wrong radius, dropped wall, flipped wall, shifted
  floor) for sphere, and two for torus.
- `sphere_axial_bore` and rounded-box results still pass.
- Gate counts unchanged.

Effort: M. Depends on nothing. Do after G1.

## G3 — exhaustive-surface audit

Goal: adding a surface kind (or one more arm) cannot silently skip an operation.

Design:
1. Grep every `match` on `Surface` / `Curve` in `packages/brep-rs/src`. Replace `_ =>` wildcards
   on those matches with explicit arms, so a new variant is a compile error. Where an arm is
   deliberately unsupported it returns `None` (refusal) with a comment saying why.
2. Add one table-driven test: for each operation in {boolean subtract/union/intersect,
   flip_face, transform/mirror, measure, mesh, STEP write} x each Surface kind
   {Plane, Cylinder, Cone, Sphere, Torus}: build the smallest solid containing that kind, run the
   op, and assert the outcome is either a refusal or a result whose volume matches the closed
   form. A silently wrong volume fails. Table lives in `packages/brep-rs/tests/` or a `#[cfg(test)]`
   module.

Acceptance: table test green; the diff to wildcard arms changes no behaviour (all existing tests
and gates unchanged).

Effort: S-M.

## H7 — cross-trim guard coverage

`wasm.rs:696-713` scans only string-valued fields, so a `fillet` whose `edge` is a TopoName object
is skipped. Extend the scan to recurse into objects and arrays. Test: a fillet on a bored cylinder
via an object-valued `edge` refuses. Effort: S.

## Order and constraints

G1 -> G3 -> G2 -> H7. G1 and G3 are cheap and independent. G2 carries the real geometry.

Constraints from `AGENTS.md`: do not edit lead-owned gate scripts; any new fixture in a gate needs
the owner's named authorisation, so new tests live in `packages/*/test` or `#[cfg(test)]`. K2b's
single known cargo failure must stay at the same measured volume (15546.67 vs 15840); if it turns
green, stop and re-measure against the closed form before accepting.

## Not verified

This spec was written from reading the code; the cargo suite and gates were not run. Gate numbers
are quoted from `PLAN-next.md`. The count of fixtures with a legal count-1 edge is unmeasured and
decides G1's false-refusal risk.
