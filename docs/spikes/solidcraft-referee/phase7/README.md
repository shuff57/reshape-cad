# Phase 7: the two solidcraft fixes inside the web app build, example tables re-run

**SPIKE. solidcraft is a separate product (DECISION.md on origin/spike/solidcraft-referee); this is not an engine, adapter or fallback of
reSHape CAD, which keeps ONE kernel (brep-rs). Nothing under packages/, scripts/, CI or config changed. No upstream post, no GitHub action.**
The patch is kept as a file only (fixes live under docs/spikes first).

## What is in the combined build
`solidcraft-combined.patch` (2103 lines, 16 files, `git diff --cached --full-index` against fe3717f of the tree after the three patches; regenerated with the FINAL fixes/shell-stub/shell-stub.patch: rim refusal with an exact 2t threshold, hole-ligament refusal, and the exact-closed-form pins) applies cleanly to solidcraft fe3717f2e400010a4cd0e7dd4f294e7091c25625
(`git apply --check` passes on a fresh clone of ~/solidcraft at fe3717f and on a clone of the build tree; the build tree `src-p7`, reset to fe3717f and patched, has a staged diff identical to the patch, so the built tree equals the patch). It is, in order, with no conflict and no hand edit:
1. `phase6/solidcraft-pane.patch`: bridge, script pane hooks, ribbon hide, doc-bound stash/restore (the phase 6 app).
2. `fixes/sketch-solver/sketch-solver.patch`: coincident+tangent joints hold in the stored points, DoF/redundancy no longer depend on the start
   state, a tangent is never reported failing while the sketch says solved (acceptance bar item 2).
3. `fixes/shell-stub/shell-stub.patch`: shell of a body with material standing on the open face uses plane-offset semantics (no truncated tube);
   a stub that would be left floating is refused in a plain sentence (acceptance bar item 1). Includes its tests and robustness goldens edits.

**Which tree each test number came from.** All numbers in this paragraph were run by me, once, on the FINAL combined tree (`~/.cache/solidcraft-bridge/src-p7`, staged diff byte-equal to `solidcraft-combined.patch`, which is also the tree the app was built from), each under `systemd-run --user --collect --wait -p MemoryMax=16G -p MemorySwapMax=0`, one at a time, `cargo test --release`:
* sketch crate (`-p solidcraft-sketch`): 198 passed, 0 failed, 3 ignored.
* kernel (`-p solidcraft-kernel --lib shell`): 34 passed; whole kernel lib: 433 passed, 0 failed, 26 ignored.
* engine (`-p solidcraft-engine --lib shell`): 27 passed.
Earlier numbers in older notes belong to OTHER trees and are not the final ones: sketch 198 / kernel `shell` 31 / engine `shell` 25 = the first combined tree (shell patch before the rim check); kernel 431 / engine shell 25 = the shell patch tree d9df6230; fixes/shell-stub/NOTES.md also records kernel `--lib shell` 32 (an intermediate commit).
NOT run by me: clippy, rustfmt, and the robustness goldens. Those were run by the shell-patch owner on the shell patch tree (kernel 433, engine shell 27, goldens all_0, all_1, all_3 pass). For `all_2` the owner's final gate reported failing only on seed 18 (the shell builder's note calls it pre-existing), while an earlier gate run passed seed 18: this difference is unexplained and I did not investigate it. Seeds 48 and 53 stay PROVISIONAL (re-recorded goldens, verified on fe3717f only, upstream bisect not done).

Not addressed by this phase (decision items 3, 4): chamfer corner convention; real bridge authentication (the token is still a switch, not authentication).

## Launch (one command, one URL)
```sh
sh docs/spikes/solidcraft-referee/phase7/run.sh
```
Prints `http://127.0.0.1:8801/?webgl&pane=on`. First run builds the combined app into `~/.cache/solidcraft-bridge/dist-p7` (about 3.5 min; rebuilt only if
the patch changes; phase 6 and phase 4 builds untouched). Same server as phase 6: loopback only, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
sandboxed runner iframe with CSP `default-src 'none'`. Needs `npm run build` once per checkout (the pane bundle reads packages/*/dist).

## What changed versus phase 6 (live-measured, same scripts, same references)
Before = the phase 6 build (dist-p6) driven by the same verifier, `browser-results-p6rerun.json`. After = `browser-results.json`.
Of 56 gallery examples, 9 changed; the other 47 are identical in volume, bbox, dof and verdict class.

| example | before (phase 6) | after (phase 7) | reference |
|---|---|---|---|
| 2d-slot-tangent | solved, dof 4, redundant k3 k5 k7 k9 | dof 0, nothing redundant, residual 1.1e-15 mm | brep-rs / FreeCAD slot anchored dof 0 |
| fr-slot-tangent | same (dof 4) | dof 0 | same |
| fr-bracket-rounded | dof 8, 8 redundant tangents | dof 0, nothing redundant, residual 0 | hand count 0 |
| stub-centre | built 2644.346, red DIVERGES | REFUSED s1, plain sentence; union 12800 still built | P 2776 / union 12800 |
| stub-offset-x | built 2644.346, red DIVERGES | REFUSED s1; union 12800 | same |
| stub-tall | built 3182.356, red DIVERGES | REFUSED s1; union 13920 | P 3300 / union 13920 |
| stub-low | built 2524.000, red DIVERGES | REFUSED s1; union 12288 | P 2612 / union 12288 |
| stub-corner | built 2713.830, red DIVERGES | built 2776.000, VERIFIED = P | P 2776.000 (OCCT boxes, voxel) |
| stub-edge-flush | built 2680.916, red DIVERGES | built 2776.000, VERIFIED = P | P 2776.000 |

Refusal sentence (all four): "Shell: not supported yet: something stands on the open face (a boss, a rim or a pocket's walls) and the 1.0000 mm shell would leave part of it free of the rest of the part ..."
Shell scope (this is the same text as the page's Limits box; every figure is in the probe table below). The shell is the plane-offset convention (P) only; the L convention (connected erosion) differs (corner 2812, edge-flush 2832 vs P 2776), so VERIFIED means "against P only", and P is a convention, not a claim about which one a user expects. "Exact" is scoped: bodies of planes only match the closed form to about 1e-15 relative (0 to 4.8e-16 in the probes); bodies with cylinders match to 3.0e-6 .. 7.4e-6 relative (0.01 to 0.02 mm3) in the probes, which is the cylinder facet error. Refused in a plain sentence: (1) a wall or rim standing on the open face that is not thicker than 2t (threshold exact: with t = 1, w = 2.002 and 2.006 build, 2.0 / 1.95 / 1.5 are refused); (2) a hole whose ligament to a side face or to another hole is under 2t (builds at exactly 2.0 to a wall, 2.1, 3.0; refused at 1.0, 1.5, 1.9; two holes with edge gap 2.1 build, 1.0 and 1.9 refused); (3) a pocket wall under 2t with the pocket floor open (all-round pocket: 2.05 builds; 2.0 to 1.4 refused with the wall sentence; 1.2 and below refused with a boolean Cut sentence that does not name the wall); (4) a boss or wall that would be left floating, that stands on the open face of a body with round faces, or that is not taller than the shell is thick. Not covered: a boss touching the open face at one corner point only (builds as a separate hollow piece, 2720).
Volumes of the three sketch examples are unchanged (11141.1768 / 18500.373, the facet bar 3e-4 against brep-rs); only the report changed. Named-pick shell
examples (named-shell-open-top 8672.000, named-hole-then-shell 2656.464, refuse-name-two-faces, refuse-shell-closed) are unchanged.
Error paths and the Run-vs-manual-work checks are identical to phase 6. No regression found, with one unresolved instability: the regress suite (pixel-clicked tab close, Restore) gave 20/24, 19/24 and one hang on three attempts made while other jobs loaded the machine, then 24/24 on a clean session at lower load; see VERIFY.md section 1. The cause is not established.

## Sketch limit (measured on the final build, browser probes, `probe-sketch-limit.mjs`, `probe-sketch-limit-results.json`)
A line tangent to a locked R5 circle or arc (the arc: centre locked, radius 5, ends free, so dof 4; the open arc cannot be extruded, which the probe ignores because it reads the stored sketch), contact (the line end) pinned only by a distance or only through a Symmetric. 8 starts each (nominal start + 7 jittered), measured from the points solidcraft stored: distance from the line end to the true tangent point (the foot of the centre on the line).
| probe | contact error (mm) | solver status / dof / warnings | residual shown |
|---|---|---|---|
| circle, distance-pinned contact | 6.66e-5 .. 1.08e-4 on 8 of 8 starts | solved, dof 2 on all 8, nothing failing or redundant, no warning | 3.3e-10 .. 9.9e-10 |
| ARC, distance-pinned contact | 6.29e-5 .. 1.14e-4 on 8 of 8 starts (the critic measured up to 1.28e-4 on an arc; this probe did not reach it) | solved, dof 4 on all 8, nothing failing or redundant, no warning | 2.6e-10 .. 9.6e-10 |
| circle, Symmetric-tied contact | 7.57e-5 .. 1.16e-4 on 8 of 8 starts | solved, dof 2 on all 8, nothing failing or redundant | 4.2e-10 .. 7.5e-10 |
| circle, distance-pinned, exactly tangent start | REFUSED: "that dimension is already determined by k2 (RadialDimension), k3 (Tangent); add it as a driven (reference) dimension" | refused | - |
| ARC, distance-pinned, exactly tangent start | 2.2e-5 | NOT refused: solved, dof 4 | 1.1e-10 |
| circle, Symmetric-tied, exactly tangent start | 5.7e-7 (the start is already the solution) | solved, dof 2 | 8.1e-10 |
| two circles, tangent, distance pin between the two centres (5 jittered starts + the exact one) | refused every time: "that dimension is already determined by k2 (RadialDimension), k3 (RadialDimension), k4 (Tangent)" | refused | - |
| Symmetric pin, partner fully locked | refused: "neither entity can move to satisfy it (they are fixed or fully constrained)" | refused | - |
So: a line-to-round (circle or arc) contact held only by a distance or a Symmetric lands about 1e-4 mm off, reported "solved" with no warning; the residual shown (touch-free tangent form, a double root at the solution) cannot see it. "Solved, no warning" holds for those line-to-round contacts. A circle-to-circle distance pin is refused, and an exactly tangent start is refused for the distance pin on a circle but not on an arc. The earlier Phase 7 sentence "not reproduced" was false and is removed. Treat the contact and the dof of such sketches as unverified. These shapes only; other routes are not measured.

## Shell probes through the app (`probe-shell-rim.mjs` -> `probe-shell-rim-results.json`; `probe-pocket-walls.mjs` -> `probe-pocket-walls-results.json`)
Run on the final build with the page's own bridge (`window.__host.bridge.execute`, the path the pane uses). Shell 1 mm, plate 40 x 30 x 10, opened at the top unless noted. Rim = 10 x 10 x 6 mm flush in the corner, P(w) = 2872 - 48 (w - 2). Holes: vertical through holes r2; web = gap from the hole edge to the side wall, or between two hole edges; clear P = 2424 + 41 pi = 2552.8053 (two clear holes 2424 + 82 pi = 2681.6106), which are my closed forms; the P figures for refused rows are the critic's / the notes' and are listed only for context. "rel" = |app - P| / P.
| case | app result | reference P | rel |
|---|---|---|---|
| rim w 3 / 2.5 | 2824.0000 / 2848.0000 | 2824 / 2848 | 0 / 0 |
| rim w 2.05 | 2869.6000 | 2869.6 | 4.8e-16 |
| rim w 2.006 | 2871.7120 | 2871.712 | 1.6e-16 |
| rim w 2.002 | 2871.9040 | 2871.904 | 0 |
| rim w 2.0 / 1.95 / 1.5 | REFUSED ("a wall standing on the open face is only 2.0000 mm thick and the shell is 1.0000 mm, so its two sides would cross (a wall needs more than twice the shell thickness ...)") | - | - |
| hole web 1.0 east / 1.0 north / 1.5 / 1.9 | REFUSED ("a ligament between a hole and a wall (or another hole) is only 1.0000 mm thick; its two offset sides would cross (it needs at least twice the shell thickness, 2.0000 mm)") | 2524.93 / 2524.87 / - / 2551.88 | - |
| hole web 2.0 (exactly 2t) | 2552.7962 | 2552.8053 | 3.6e-6 |
| hole web 2.1 / 3.0 / hole clear at the centre | 2552.7953 each | 2552.8053 | 3.9e-6 |
| two holes, edge gap 1.0 / 1.9 | REFUSED (same ligament sentence) | 2661.10 / - | - |
| two holes, edge gap 2.1 | 2681.5906 | 2681.6106 | 7.4e-6 |
| counterbore plate (r2 hole at (-8,-6), r4 x 2 counterbore), open top | 2628.1884 | 2628.2035 (2424 + 65 pi) | 5.8e-6 |
| n7 8x8x8 boss touching the open face at one vertex | 2720.0000 | 2720 | 3.3e-16 (a sealed hollow boss; a policy choice, not a measured error) |
| n6 rounded-corner plate, wall-flush boss | 2729.6377 | 2729.646 (notes) | 3.0e-6 |
| n9 corner boss with a hole through it | 3002.1774 | 3002.195 (notes) | 5.9e-6 |
| n10 round boss r4 | REFUSED ("a boss or wall stands on the open face of a body with round faces ...") | - | - |
| n11 round pocket floor open | REFUSED (same sentence) | - | - |
| n13 bottom-rounded box, corner boss | 2686.8835 (MY reconstruction: box 40x30x10, the four bottom edges filleted r2, boss 10x10x8 centred at [15,10,9]; the critic script is not in the repo; r2 was chosen because the notes' hand estimate of the rounding loss fits it, and the result equals the notes' figure 2686.883) | none: the notes say this figure is NOT independently verified | - |
| n8b pad 0.5 mm | REFUSED ("only 0.5000 mm tall and the shell is 1.0000 mm thick") | - | - |
| control: plain open top | 2424.0000 | 2424 | 0 |
Pocket walls (pocket 6 mm deep, wall w all round, opened at the pocket floor, `probe-pocket-walls.mjs`): w 3 builds (3152.000), 2.05 builds (3068.590), 2.0 / 1.95 / 1.5 / 1.4 are refused with the wall sentence, and 1.2 / 1.1 / 1.0 / 0.5 are refused with a sentence that begins "boolean Cut: the operation failed: no result; ..." and does not name the wall. No closed-form volume was computed for the two builds. A divider wall between two pockets with the plate top opened is NOT refused below 2t (volumes 4128 at w 2.0, 4122 at 1.95, 4068 at 1.5, 4008 at 1.0: a slope of 120 mm3 per mm, = 20 x 6, which is a solid divider); not independently referenced.
Where the numbers come from: n6, n9 and their P figures are from fixes/shell-stub/NOTES.md (OCCT box compositions), not re-derived here; every app number is measured here. For comparison, the previous build (before the hole-ligament refusal and the exact 2t threshold), run with the same probe, built hole web 1.0 east as 2549.090, web 1.0 north as 2548.580, web 1.5 as 2551.229 and web 1.9 as 2552.772 (the new build refuses all four), and refused rim 2.002 (the new build builds it). The previous build's two-hole rows are not comparable: that first draft of the probe placed the holes at the wrong spacing (edge gaps of 2.0 and 3.9 instead of 1.0 and 1.9), so they built clear-hole values; the probe was fixed before the final run, which is the one tabled.

## Example data updated (never loosened)
* The six stub examples moved from group `diverge` (ids `diverge-stub-*`) to a new group `stub` (ids `stub-*`). The four refused ones now declare
  `expectRefused: [{id: s1, contains: "something stands on the open face"}]` and `ref.builtVolume` = the union volume live-measured by OCCT
  (phase4/stub-reference-results.json `outer`); the two built ones carry `divergence.refs = [P]` only, so the pane says VERIFIED only on a match to P
  within the 1e-9 planar bar, and DIVERGES (red) on anything else. The distance-erosion alternative was dropped as a reference because solidcraft's
  own shell semantics (and the fix NOTES) are plane-offset; the choice is stated in each example's Expect text.
* slot and bracket Expect texts no longer describe the dof limit; the pane's dof line now reads a mismatch as a MISMATCH, not "a known limit".
* `reference-results.json` was regenerated live (brep-rs wasm + OCCT) for the renamed examples.
* The group `diverge` and its red-verdict code path stay in the pane (nothing in the gallery uses it now), so a future divergence cannot show green.

## Files
solidcraft-combined.patch, probe-sketch-limit.mjs, probe-shell-rim.mjs, probe-pocket-walls.mjs (+ their -results.json), ribbon-results-run1..3.json, run.sh, serve.mjs, pane/ (pane.js, examples.json, lib, src, bundle), verify-*.mjs (copied from phase 6; port 8801, patch name,
`--examples/--out/--examples-only` flags and dof capture added), *-results.json, screenshots/, VERIFY.md, PROGRESS.md.
