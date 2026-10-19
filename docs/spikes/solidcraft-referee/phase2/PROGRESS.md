# Phase 2: constrained sketches -> solidcraft's own solver

Spike, referee only; no engine mode, no product claim, policy undecided. Nothing under `packages/`, `scripts/`, phase0/phase1 or `~/solidcraft` was touched.

## What ran
`SOLIDCRAFT_REFEREE_PKG2=<pkg> node docs/spikes/solidcraft-referee/phase2/run-phase2.mjs` (needs `npm run build`, `packages/brep-rs/pkg`).
`<pkg>` is `wasm-bindgen --target nodejs` of `phase2/wrapper2` (phase0's wrapper returns only the final measure; wrapper2 returns every command's output, keeps going after a refused command, and adds an `@sketch` pseudo-command that dumps solidcraft's evaluated sketch: solved points/curves, full `SolveReport` (status, dof, failing, redundant, folded), profile list with interior points). Build: `CARGO_TARGET_DIR=<tmp> cargo build --release --target wasm32-unknown-unknown` in `wrapper2/`, then `wasm-bindgen`.

43 constrained sketches (11 own, 32 FreeCAD-gauntlet sketch variants) x 2 start modes = 86 cases:
- `stored`: the doc's own coordinates as solidcraft's start state.
- `rough`: every coordinate off by up to 3.5% of the sketch diagonal (deterministic per id; points a `lock` pins are kept), so the solver has to do the work in both solvers.
Each case: map -> solidcraft commands -> solve -> extrude (H=10) -> volume / bbox / COM / face types, scored against live brep-rs on the SAME doc and against closed forms (arithmetic in `fixtures-p2.mjs`) and the FreeCAD refs (dof / conflicting / redundant, read, not regenerated).
Bars inherited from phase0 and not tuned: volume/bbox rel 1e-9 planar / 3e-4 curved, COM x diagonal 1e-6 / 3e-5; rule residual 1e-6; solved geometry vs brep-rs 1e-6 abs mm (only where the reference says dof 0).
An independent rule checker (`rule-check.mjs`, no solver code) evaluates every rule on each solver's output, including tangency AT the joint.

## Numbers (final run, `last-run.txt`, `results.json`)
Geometry and diagnostics are tallied separately.

| outcome | stored | rough |
|---|---|---|
| PASS (geometry + dof agree) | 20 | 19 |
| FAIL | 1 | 5 |
| AGREE-UNDERDETERMINED (dof>0 in the reference, part identical, dof agrees) | 8 | 2 |
| DIVERGE-UNDERDETERMINED (dof>0, parts differ; both satisfy every rule) | 0 | 7 |
| GEOMETRY-OK-DOF-MISREPORTED (solid right, solidcraft dof/redundancy wrong) | 4 | 0 |
| AGREED-REFUSAL (reference conflicting, solidcraft refuses at command time) | 4 | 4 |
| SOLIDCRAFT-STRICTER (reference only redundant, brep-rs builds, solidcraft refuses: redundant-width, redundant-height, slot-extra-radius) | 2 | 2 |
| AGREED-NO-SOLID (open profile; brep-rs refuses too) | 3 | 3 |
| NO-REFERENCE | 1 | 1 |

How to read it: the stored-start PASS count (20) mostly shows that the mapper and the extrude are right, because the doc already satisfies its rules and the solver barely moves. The rough start (19 of 43 cases PASS, 5 FAIL, 7 DIVERGE-UNDERDETERMINED) is the real evidence about solidcraft's solver. Mapper refusals in the final set: 0 (earlier ones were mapper bugs, fixed).

Controls: 9 distinct controls, 12 runs, 11 rejected, 1 not rejected (below). Which signal rejects which:
| control | rejected by |
|---|---|
| swap width/height (rect), swap dx/dy (gauntlet) | bbox, COM, solved geometry (volume unchanged: equal area) |
| swap L-shape lengths, wrong angle value | volume, bbox, COM, geometry |
| radius used for diameter | volume, bbox, geometry |
| tangent cap flipped inward | volume, bbox (vs closed form; brep-rs refuses this slot) |
| circle-circle mode flipped | mapper refuses; with request stripped: volume, bbox, geometry |
| drop first tangent, STORED start | **not rejected**: volume 4730.793327 unchanged, geometry equal (the start already is tangent) |
| drop first tangent, ROUGH start | volume, bbox, geometry (2.0 mm) |
| slot length +1e-3 mm, stored and rough | solved-geometry check only (1.0e-3 / 1.2e-3 mm); volume and bbox pass inside the curved bar |
Consequence: a dropped constraint on an already-tangent doc is invisible to volume/bbox/COM; only a rough start or a geometry check sees it.

## What failed (all counted FAIL)
1. **Endpoint tangency is only ~1e-4 mm exact in solidcraft's output.** 5 cases (3 gauntlet slots rough + own-slot stored/rough): the joint radius is off perpendicular by 1.2e-4 to 1.5e-4 mm while the report says `solved`, `failing: []`, `max_residual` ~6e-10. brep-rs: 1e-11. Volume still passes the curved bar, so only geometry/rule checks see it.
2. `own-l-shape-dims` rough: truck vs brep-rs bbox delta 1.11e-9 vs bar 1e-9 (solver residual ~1e-9; rule bar passes). Reported as FAIL, not re-tuned.

## Open defect candidates for upstream (solidcraft), minimal repros
- **Tangency residual contradicts stored points.** Mapper-independent repro: 12 jittered starts (amplitude 0.05-2 mm) of a line + 3-point arc with coincident + tangent: status `solved`, `failing []`, `max_residual` 3e-10..9e-10, yet (a.start - a.center).dir/|r| is 1.0e-5..2.0e-5, i.e. 5e-5..8e-5 mm perpendicular at R=5, with the gap between l.end and a.start exactly 0. `solver.rs:654` defines the residual as `(pt - c).d/|d|`, so the reported residual disagrees with the stored points by ~5 orders. Root cause NOT found; a post-solve centre move is only a guess.
- **Redundancy flag depends on the start state.** Same minimal repro (line + 3-point arc, coincident + tangent, no mapper): an exactly-tangent start reports dof 7 with the tangent flagged redundant (hand count 9-2-1 = 6); a 0.05 mm jitter gives dof 6, redundant []. In this spike: stored slots report dof 4 / redundant [k3,k5,k7,k9] (floating slot 6 vs 2); the same docs from a rough start report dof 0. A saved (already tangent) doc therefore under-reports its constraints.

## Other findings
- **Profile-selection default (not a defect).** solidcraft models a plate with a hole correctly (profile 0 has `hole_curves:[["c1"]]`, area 321.46; profile 1 is the disc), and `profiles` defaults to `all` (features.rs:287,315), so both regions extrude by design (10000 vs our 9214.6). `profiles:[0]` or `[{point:[1,1]}]` selects the ring. The mapper already handles it (`docProfileIndices`: even-odd fill of the doc's loops).
- **brep-rs refuses where solidcraft builds**, scored against closed forms only: two externally tangent circles (2795.75, 2 bodies; brep-rs "cross or touch"), internal-tangent hole (1225.13; brep-rs "not fully inside"), line + circle (circle only). The gauntlet slots refuse on brep-rs at extrude on an edge-orientation condition ("meet in a point rather than running smoothly; reverse one of them", head-to-head joints). These show brep-rs's conditions, not a solidcraft capability claim.
- **brep-rs cannot solve symmetric about the built-in Y axis**: "line -3 has zero length; a mirror line has no direction" (own-symmetric-trapezoid; solidcraft solves it, closed form 1.8e-12).
- Angle dimension is undirected in solidcraft; distanceX/Y is `|d|` (`solver.rs:507`) vs brep-rs signed (`metric.rs:133`): the mapper maps them only when the start side agrees.
- brep-rs and solidcraft agree on dof for every non-tangent fixture.

## Diagnostics (key Phase 2 question) – see the table in the final report and `results.json` `.diagnostics`
Conflicting / redundant DIMENSIONS and conflicting constraints are refused AT COMMAND TIME (for a merely redundant dimension that brep-rs builds, that is stricter than the reference, not agreement) by solidcraft (stored sketch never contains them), with the sentence and the constraint ids; brep-rs and FreeCAD accept the row and report a bucket. A redundant non-dimension constraint is kept and listed in `report.redundant`. If the error is ignored, solidcraft produces the solid of the sketch WITHOUT the dropped constraint (e.g. width 30 instead of 35: 6000 mm3), so "refuses or builds" depends on the caller stopping at the first failed command. brep-rs refuses the build for conflicts.

## Open gaps
- No reference-dimension (`driving:false`), `active:false`, ellipse, or `point`-profile fixture ran; mapped but untested.
- Tangency residual root cause not found; only the effect (1e-4 mm) and the redundancy mis-count are measured.
- Faces: solidcraft face counts are merged counts; per-type compare only recorded, not gated.
- Perturbation is one amplitude (3.5%) and one seed per id; larger starts were not swept (basin escapes untested beyond the slot inward-cap control).
- FreeCAD was not re-run; dof/conflict refs are the committed ones (3 ref files are locally modified in git status, unrelated to this spike).
