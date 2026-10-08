# SPEC: cone bores parallel to the axis, off it (loop spec, 2026-10-08)

Goal: a hole drilled parallel to a cone's axis, off the axis, that meets the sloping wall builds exactly (today it refuses: "this bore meets the wall in a curve brep-rs cannot carry exactly"). The census has about 304 such scripts of 525 cone-hole refusals: plain 73, blind 137, counterbore 64, countersink 30. Across-axis bores (about 221) are out of scope.

The curve has a closed form. Cone: base centre origin, axis +z, base radius R, height h. Bore of radius rho, centre offset e from the axis. At angle t round the bore the wall point is

    p(t) = (e + rho cos t, rho sin t, h (1 - d(t)/R)),   d(t) = sqrt(e^2 + rho^2 + 2 e rho cos t)

Standing method (unchanged): measure first, build only what is exact and provably correct, never return a wrong solid (refuse in a sentence), commit with explicit paths, leave the two untracked PNGs alone.

## Slices

| # | Slice | Done when |
|---|-------|-----------|
| B0 | Pre-check: classify the ~304 scripts by geometry against the kernel (clear of tip, rim, far wall; through vs blind; bore wholly inside the cone's footprint) and by what OpenCascade builds | counts written into the status table: exact / touches tip / touches rim / bore leaves the cone / OpenCascade refuses. Slices B1+ are sized by these numbers; if fewer than 40 are exact, stop and ask |
| B1 | `Curve` variant for p(t) (analytic point, tangent, bounds), transform, and the places that match on `Curve` (as `Hyperbola` was added) | unit tests: p(t) on both surfaces to 1e-12, tangent by finite difference, survives a rigid move |
| B2 | Plain through-bore in a cone: cone face with one inner loop (the curve), bore wall as a cylinder face bounded by the curve above and the base circle below, base face with its hole | volume against the closed form (cone volume less the integral over the bore circle of the wall height) to 1e-9; against OpenCascade where it builds; closed shell, `edge_use_counts` all 2; translation-invariant volume; refusals for tip / rim / far-wall contact |
| B3 | Mesh: the bounded-cone mesher takes the inner loop; the bore wall meshes between the curve and its base circle | mesh closed at two tolerances, mesh volume within deflection of the exact one, extent within the tolerance (the lattice refinement of `5a7d813` must hold) |
| B4 | STEP: the curve as a fitted open spline (as the hyperbola), the cone face from its wires, the seam logic with the new loop | STEP read back in OpenCascade as a valid solid with relative volume delta under 1e-6 on a 500-script sweep; a refusal sentence where the seam cannot be placed |
| B5 | Blind bore: floor plane inside the cone (the wall curve above, floor circle below) | as B2 to B4, plus the floor must lie inside the cone at every point of its circle, else refuse |
| B6 | Counterbore and countersink on top of B2/B5, only if B2 and B5 landed with 0 wrong | as B2 to B4 on the counterbore (a second cylinder, a ring plane) and the countersink (a cone coaxial with the bore); otherwise left refused with their present sentence |
| B7 | Hook into the `hole` handler so the present refusal fires only for what is not built; update the refusal sentence to say what now builds; docs (this spec's status, the plan's W-table, the reshape-docs page) | census: cone-hole refusals drop by the B0 exact count (+- 5%), WRONG 0 |

## One iteration

1. Pick the first slice not DONE or REJECTED below. Stop if none.
2. Write the failing test or probe first and show it fails (B0 is the probe).
3. Build the smallest change that makes it pass. Refuse in a sentence rather than guess.
4. Verify in order, stopping at the first red: `cargo test --release` (packages/brep-rs); `wasm-pack build --release --target web --out-dir pkg`; the new and touched JS tests; the four gates (`scripts/brep-parity-gate.mjs`, `brep-mesh-gate.mjs`, `brep-step-gate.mjs`, `npm run gate:occt`, expect 78/78/78/17); the full kernel suite `bun test --timeout 900000 test/*.test.mjs` (expect 0 fail).
5. Census gate after B2, B4, B5, B6 and B7: `docs/specs/prototypes/census/run-sweep.sh OUTDIR`, run alone with the machine idle (OpenCascade hangs under load; baseline is 6 hangs). WRONG must be 0 and AGREE must not drop below 5,350.
6. Commit with explicit paths, message states the measured result, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Fill the status table with the hash.
7. Report one line: slice, result, next slice. Do not rebuild the wasm while a census is running.

## Referees and oracles

- Closed form: volume = V(cone) - integral over t in [0, 2 pi] of (rho(rho + e cos t)) z(t) dt, the bore measured to the base plane (a through bore); a blind bore adds the floor term. Check the integral by an independent numerical quadrature in the test, not the kernel's own surface integrals.
- OpenCascade: volume and bounding box where it builds. It is no referee where it hands back the part unhollowed or hangs.
- Mesh watertight at two tolerances; STEP read back by OpenCascade.

## Stop rules

- A gate or suite goes red and the cause is not found in one pass: revert the slice, mark BLOCKED with the evidence, move to the next independent slice.
- Census WRONG above 0: stop the whole loop and report.
- B0 finds fewer than 40 exact scripts: stop and ask.
- Two BLOCKED or REJECTED slices in a row: stop and ask.
- A slice needs more than one iteration of effort (B4 STEP, B6): stop and ask before starting it.
- Never edit lead-owned gate scripts.

## Out of scope

Bores across the axis (x or y), several bores meeting each other inside the cone, a bore that cuts the tip, a bore wider than the cone at its height, a cone that is already cut by a box (`has_cut_cone` parts stay refused).

## Status

| Slice | Status | Commit | Measured |
|-------|--------|--------|----------|
| B0 | open | | |
| B1 | open | | |
| B2 | open | | |
| B3 | open | | |
| B4 | open | | |
| B5 | open | | |
| B6 | open | | |
| B7 | open | | |
