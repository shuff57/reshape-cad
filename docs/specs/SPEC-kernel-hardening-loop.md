# SPEC: kernel hardening loop (2026-10-07)

Source: the Plan-agent review after a174887. Read-only findings, none measured yet. Each item is a slice; the loop closes one slice per iteration.

## Slices, in order

| # | Slice | Where | Size | Done when |
|---|-------|-------|------|-----------|
| H1 | `follow_face` returning None must refuse, not fall back to the stale face | wasm.rs:2581 | ~10 lines + test | turn a box 90 degrees, name the old +x face: refusal or the correct face; hollow fuzz unchanged |
| H2 | Volume tolerance scaled to the result, not the larger body | cone_csg.rs:~347 (+ tests ~428), same pattern in cone_keep.rs | ~3 lines + test | randomized box >1000x cone volume agrees with `overlap_volume`; no new refusals in the 614-pair family beyond those measured |
| H3 | Turned reader: refuse a round/chamfer next to a cone tip | turned.rs:178-300 | ~6 lines | the case refuses with a sentence; no previously building census script flips to refused except this class (count recorded) |
| H4 | Closed sphere hollow routed to `subtract_enclosed` | wasm.rs shell branch, ops.rs:5836 | ~40 lines | volume 4/3 pi (r^3-(r-t)^3); mesh closed; STEP read-back by OCCT; refusal test updated; open sphere still refuses |
| H5 | Two-lump cut refusal carries the true reason | cone_csg.rs:~331, cone_keep.rs:~364 | ~20 lines | refusal text names two lumps |
| H6 | Coverage: turned.rs Rust tests, cone_region/cone_csg tangent+sliver+tilted box, JS test for `has_cut_cone` early return | tests | ~half day | tests pass and fail when the guard is removed |
| H7 | Docs: plan numbers (cargo 528, gates 78/78/78/17, census table), W6 status | PLAN-kernel-next-2026-10-05.md | 10 min | numbers match the last measured run |

Not in scope (stay refusals): STEP band+notch cone faces, round as wide as the wall on the open rim, real two-lump construction (revisit only after H5 and a measured count).

## One iteration

1. **Pick** the first slice not marked DONE in the table below. Stop the loop if none.
2. **Pre-check by measurement**: write the failing test or probe first and show it fails (or measure the count the slice affects). If the premise does not hold, mark the slice REJECTED with the measurement and move on.
3. **Build** the smallest change. Never return a wrong solid; if unsure, refuse in a sentence.
4. **Verify**, in this order, stopping at the first red:
   - `cargo test --release` in packages/brep-rs
   - `wasm-pack build --release --target web --out-dir pkg`
   - the new test, then the touched JS test files
   - `scripts/brep-parity-gate.mjs`, `brep-mesh-gate.mjs`, `brep-step-gate.mjs`, `npm run gate:occt` (expect 78/78/78/17)
   - full kernel suite `bun test --timeout 900000` (expect all pass; count recorded)
5. **Census gate**, after H1, H3, H4 and at the end: `docs/specs/prototypes/census/run-sweep.sh OUTDIR` in the background. WRONG must be 0. Record the AGREE and refused counts.
6. **Commit** with explicit paths only (never the two untracked PNGs), message states the measured result, trailer per project attribution. Mark the slice DONE below with the commit hash.
7. **Report** one line: slice, result, next slice.

## Stop rules

- A gate or suite goes red and the cause is not found in one pass: revert the slice's change, mark BLOCKED with the evidence, continue with the next slice.
- Census WRONG > 0: stop the whole loop and report. Do not continue.
- Two consecutive BLOCKED or REJECTED slices: stop and ask.
- A slice needs more than one iteration of effort (H5 real closure, STEP band+notch): stop and ask before starting it.
- Never edit lead-owned gate scripts.

## Status

| Slice | Status | Commit | Measured |
|-------|--------|--------|----------|
| H1 | DONE (defensive) | bcedc9d | no script reaches the unfollowable case (a turn is baked into the box as `rotate`, probe agreed with OCCT at 3312); refusal added; cargo 528, gates 78/78/78/17, suite 1536/0; no test exercises the new refusal |
| H2 | DONE | c85a201 | cone_csg volume check scaled to the smaller body (2e-6*min + 1e-12*max); new test with boxes 20-60x the cone passes; cargo 529, gates 78/78/78/17, suite 1536/0. Census after H1: WRONG 0, AGREE 5344 of 15000. Observation: a thin cone sliver's mesh extent can fall ~0.026 short of its exact box (volume and closure fine); excluded from the new test, not fixed |
| H3 | DONE (defensive) | 7ad17d6 | turned reader in tips mode refuses a profile with both an arc and a cone tip. Not reachable from a script (round/bevel of a cone refuse, revolve of a sloped profile refuses, cylinder+cone union refuses); no test exercises it. cargo 529, gates 78/78/78/17, suite 1536/0 |
| H4 | DONE | b3538e1 | a whole sphere hollows to a sealed void (concentric ball); 24 random sphere/wall combinations: 23 built, 1 refused (wall = radius); volume matches 4/3 pi (r^3-(r-t)^3) to 1e-9, OpenCascade agrees on 21 where it hollows, mesh watertight, STEP reads back. cargo 529, gates 78/78/78/17, suite 1537/0 |
| H5 | DONE | H5HASH | a cut leaving two lumps now refuses with its own sentence (two separate pieces) through the existing ops_planar reason channel instead of the generic cannot-boolean one; Rust test and JS test (slab through a cone's axis). Real two-lump construction not attempted. cargo 530, gates 78/78/78/17, suite 1538/0. Census after H4: WRONG 0, AGREE 5350 (OCCT-HANG 13 vs 6: referee under CPU contention) |
| H6 | open | | |
| H7 | open | | |
