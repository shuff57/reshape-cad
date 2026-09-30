# Handoff: brep-rs parity work — the two silent-composition bugs

**Date:** 2026-09-29 · **Repo:** `/home/shuff57/Documents/GitHub/reshape-cad` · **Kernel:** `packages/brep-rs` (Rust → wasm-bindgen)
**Status when written:** parity gate reads **70 passed, 2 failed**. The 2 failures are real defects, not broken fixtures.

## Absolute paths in this spec

- Repo: `/home/shuff57/Documents/GitHub/reshape-cad`
- Kernel: `/home/shuff57/Documents/GitHub/reshape-cad/packages/brep-rs`
- Fixtures: `/home/shuff57/Documents/GitHub/reshape-cad/scripts/brep-parity-fixtures.mjs`
- Gate: `/home/shuff57/Documents/GitHub/reshape-cad/scripts/brep-parity-gate.mjs`
- Campaign ledger: `/home/shuff57/Documents/GitHub/reshape-cad/docs/kernel-campaign.md`
- Throwaway probe (recreate if absent): `/tmp/opencode/probe.mjs`

**If any path above does not exist, STOP and say so. Do not invent a path, a filename, or a repo name.**

## What the project is, and the rule you must not break

Browser-first CAD. reSHape Script (2D sketch + 3D features, JS) in a sandboxed iframe, a 2D sketch constraint solver, a React + Three.js studio. **One kernel, no fallback** — a pinned decision; the OCCT fallback was deliberately removed. When brep-rs cannot build a feature it must **refuse per-feature with a plain sentence**, surfaced in the UI beside whatever did build.

The project's premise: **a wrong solid is worse than a refused feature.** A closed, manifold, plausible-looking solid that is quietly the wrong shape is the cardinal sin. `packages/brep-rs/AGENTS.md` states it. Read that file's ANTI-PATTERNS before you touch anything.

An independent OCCT referee (`replicad-opencascadejs`, a devDependency for that reason alone) builds every gate fixture a second time and compares. Three gates measure brep-rs against it.

## Build first, always

The wasm is gitignored and absent on a fresh checkout. **Rebuild before running any gate**, or you measure the old binary:

```bash
cd /home/shuff57/Documents/GitHub/reshape-cad/packages/brep-rs && wasm-pack build --release --target web --out-dir pkg
```

Then `node scripts/brep-parity-gate.mjs`. A full run is ~90 seconds. For fast iteration, `/tmp/opencode/probe.mjs` loads the same wasm and measures one doc directly — use it rather than paying 90s per experiment.

## Where this work came from

An external-kernel review concluded the parity bar was **measuring the fixture list, not the kernel**: no fixture drilled more than one blind bore, none booleans a body whose planar face mixes line and arc edges, and the W2a coplanar defect lived only in a deliberately-red unit test. Four fixtures were added to close those gaps. Doing so exposed the two bugs below — both of which had been invisible, not because the gates were weak, but because **no fixture exercised the shape**.

## The two bugs, with reproductions

All measured 2026-09-29 against the wasm built 2026-09-28. `probe.mjs <features-json> <measureId>` prints `volume= faces= bbox=`.

### Bug 1 — cut features do not compose (`wasm.rs:850`)

The `hole` branch resolves its target with `hist.shapes.get(target)`. A cut stores its result under **its own** id and never writes back to its target, so `hist.shapes["b1"]` is forever the pristine base. Three `hole` features all naming `b1` therefore each compute `b1 − holeN` independently, and all but the last are discarded.

```
box 40x40x30 = 48000.  Holes d6: depth 8 at x-12, depth 14 at x0, depth 20 at x12.
  each hole alone:  47773.805 / 47604.159 / 47434.513   all exact
  all three chained: 47434.513                          = h3 alone. Expected 46812.5.
```
Same with `bore-through-then-blind` (depth 40 then depth 12): measures 47660.707993, the blind bore being the one that vanishes.

**Explicit chaining composes correctly.** With `h2` targeting `h1` instead of `b1`, the same three holes give **47377.965** (correct, 12 faces). That difference is the proof of mechanism, and it is also why this is a live footgun rather than a design choice: under PartDesign convention every feature names the same body, which is exactly what a student writes.

### Bug 2 — a second boolean onto a boolean result vanishes (worse)

```
a  = box 40x40x30 ;  t = box 6x6x6 @[-12,0,10] ;  u = box 6x6x6 @[12,0,10]
  a − t                        = 47784  ✓        (primitive base)
  (a − t) − u                  = 47784  ✗        identical to a − t; expected 47568
union(plate,block) − t2        = 16000  ✗        identical to the union; expected 15784
                                 11 faces, the union's exact face count
```
Not a wrong cut — **no cut at all.** The result *is* the base.

**Localized to:** `ops.rs:3334-3379`, the general face-assembly path in `ops::boolean`, which emits the base's own untrimmed faces. That is a valid closed shell, so the manifold guard passes it. `subtract_enclosed` (`ops.rs:3643`) is **not** the culprit — it correctly returns `None` on failed checks and falls through.

**Not yet pinned:** the exact bail-out line. That is the first task.

**Important nuance, do not overclaim:** the Rust-level test `ops::successive_blind_bores_keep_every_floor` performs four sequential raw booleans and **passes**. So this is shape-dependent, not universal — a tool breaking through a face composes; a **fully enclosed** tool applied to a result that already has a cavity does not. Which shapes are safe is uncharacterised, and that boundary is worth more than the fix.

### Bug 3 — the chord bug is latent, not live

`ops.rs:1429-1441` (`outer_uv`) and `ops.rs:1528-1536` (`coplanar_face_wires`) push edge **endpoints only**, no arc sampling. A planar face mixing line and arc edges would collapse to a chord polygon. It does not happen today only because the boolean **refuses first**, in a plain sentence. It goes live the moment someone fixes arc-boolean. `boolean-rounded-corner-cap` is the tripwire for that day.

## The 4 fixtures added, and how to read them

`scripts/brep-parity-fixtures.mjs`, appended at the end. **Two of them are witnesses, not coverage — a green there means nothing**, and the file says so inline:

| Fixture | State | Meaning |
|---|---|---|
| `chamfer-on-boolean-result` | **FAIL**, rel delta 1.85e-2 | Real coverage. Reproduces the W2a coplanar defect through the ModelDoc path: brep-rs returns 15546.666766666667 on 11 faces with no bevel; OCCT and the closed form both give 15840. |
| `boolean-rounded-corner-cap` | **FAIL, refused** | Real coverage of an honest refusal. OCCT builds it. |
| `bores-blind-stacked` | passes, **vacuous** | Witness for bug 1. Passes at 1.5e-16 while measuring 47434.513322. |
| `bore-through-then-blind` | passes, **vacuous** | Witness for bug 1. |

`occt-build.ts` shares bug 1, which is why the differential gate is blind to it: **both sides make the same mistake and agree.** A parity gate cannot catch a shared assumption. Catching this class needs a closed-form assertion.

**Do not treat 70/2 as a regression baseline to "fix" by editing fixtures.** The 2 failures are the gate working.

## Work, in priority order

### 1. Pin the bail-out in `ops.rs:3334-3379`
Find where the general boolean path yields the base's untrimmed faces instead of `None`. Report the line and the condition. **Do not fix yet** — report first, so the fix is aimed.

### 2. Characterise the shape boundary for bug 2
Which operand/tool combinations compose and which silently no-op? At minimum: enclosed vs face-breaking tool; cavity-bearing vs convex base; primitive vs boolean-result first operand. A short table beats a guess. This tells us how much of a real part is silently wrong today, which is the number that should drive priority.

### 3. Fix bug 2, then bug 1
Bug 2 is higher severity: a student scripting two pockets gets one, with nothing in the UI saying so. For bug 1, the fix must make the **PartDesign convention** work — several features naming one body must apply cumulatively — without breaking the naming history, which relies on per-feature shapes being addressable. `history.rs` and the `carried`/`swept`/`cap` TopoName causes are load-bearing; do not break `W1`.

### 4. Fix the chord bug (`ops.rs:1429-1441`, `1528-1536`)
Sample arcs when building a planar face polygon. Ten lines. It is latent, so it will not show up in any gate until arc-boolean works — reason about it directly rather than waiting for a red test.

### 5. Make this class catchable
The differential gate is structurally blind to any bug OCCT shares. Options: closed-form volume assertions in the fixture set (the gate deliberately avoids hardcoded numbers — a design decision you should respect or explicitly overturn, not quietly erode), or a native `#[test]` per composition rule. **This is the one unpinned design decision I want your opinion on — see the reply section.**

## Constraints

- **Never edit `scripts/brep-*.mjs` for any reason other than adding coverage.** They are lead-owned; `packages/brep-rs/AGENTS.md` says a builder who can edit its own gate eventually will. The four fixtures above were added on explicit lead instruction. If you want to add more, say so in your reply and explain what class of bug each one pins — do not silently expand the gate, and never weaken a tolerance or remove a fixture.
- **Never suppress a type error.** No `as any`, no `@ts-ignore`.
- **Never make a wrong solid into a refusal to make a gate green**, and never widen a tolerance. A refusal is honest; a wrong solid is a defect; loosening the bar to hide either is worse than both.
- Do not edit `docs/kernel-campaign.md` to record progress without asking — the ledger is the lead's.
- Keep the fix inside one layer. `topo` and `geom` must not import each other (`lib.rs:20`).
- `cargo test` currently sits at **241 pass / 1 fail**. The 1 is `ops::spike_coplanar_chamfer_on_a_boolean_result_is_exact` (`ops.rs:4319`), deliberately red and **not** `#[ignore]`d. It is the measurable definition of done for W2a. Your fix to bug 2 should be checked against it: if it goes green, say so loudly.

## Corrections to the repo's own documentation

`packages/brep-rs/AGENTS.md` says `ops.rs` holds "Booleans, **fillet/chamfer**, shell, draft." **It holds zero fillet/chamfer implementation.** The blend code is `wasm.rs:4342-5031` (~690 lines) plus `build.rs` (~550). Anyone sent to `ops.rs` for blending will find only the failing spike test. Worth fixing — ask the lead rather than editing that file unasked.

Also stale: `docs/parity.md`'s checker (`scripts/check-freecad-parity.mjs`) and `parity/freecad-partdesign.json` were deleted in `d600093`, so the 30/46 FreeCAD bar is unmeasurable, and six specs still reference it. `bench/tasks/Y2-flanged.md` has an arithmetic defect (states 53703.00, derives 53074.68 — the fillet constant omits the perimeter factor).

## Blend parity: known gaps, not yet specced

From a survey of our side. **A comparison against an external reference kernel was still running when this spec was written and is deliberately not included — do not assume its conclusions.**

| Capability | Status | Where |
|---|---|---|
| Face-level blending | **absent entirely** | only `draft` has face resolution, `wasm.rs:1521` — a usable template |
| Variable / graded radius | **absent** | `size` is a scalar |
| Unequal-distance chamfer | **absent** | one `size` for both faces |
| Boolean-result blending | **blocked by NAMING, not by boolean power** — see the correction below | `between` naming exists (W1) but is not re-derived from a result's adjacency |
| General edge blending (prism/wedge/curved/concave) | **absent** | `box_extent`/`box_local_frame` are the 6-face gate |

| Trihedral corner blend (3 surfaces) | absent | not attempted |
| 4+-surface corner blend | absent | the reference REFUSES past N=4 too |
| Blend-on-a-blend (fillet a face a previous fillet made) | absent | untested in the reference as well |

## CORRECTION (2026-09-29, after the reference comparison landed) — the boolean-result block is NOT the convex `Region`

An earlier draft of this spec claimed the convex `Region` was "the root cause of the boolean-result blending block" and that the fix was a polygon ring set. **That is wrong, and acting on it would send you into a weeks-long rewrite that buys nothing.** The reference kernel was checked directly:

**It blends boolean results routinely, and does NOT track provenance through the boolean.** Its stated contract, from `feature_pipeline/features/boolean.rs:23-27`: *"`FACE` names propagate through `boolean_operation` automatically (`operand_face_names`) and stand. The derived `EDGE` names are re-stamped from the RESULT's own adjacency by `common::register_added`, exactly as every other feature registers its output."*

It assigns names at imprint time and then **deliberately throws them away**. `boolean.rs:29-37` explains why, and the reasoning applies to us directly: a coplanar tool cap names its rim after a face the result does not contain; a split face lends its pre-split name to both fragments; and *"anything that runs after this one re-stamps the same edges — so leaving them made an edge's identity depend on where the timeline was cut."* So it regenerates every edge name as `{faceA}|{faceB}[n]`, sorted, from the result's own face adjacency, after every feature (`common.rs:261-294`).

The blend then consumes **points, not IDs**: `fillet_edges(solid, edge_points: &[Vec3], edge_names: Option<&[String]>, radius, chamfer, name)`, resolved by `resolve_edge_by_point` to `nearest_edge` within 1e-3 (`blending/fillet/edges.rs:198-205`, `:149-165`).

**So the three things actually required are:**
1. Face names survive the boolean — we have `carried`; verify it holds for the faces a blend needs.
2. A naming pass that re-derives edge names from a result's own adjacency after each feature. *This is the missing piece, and it is a naming pass, not a boolean rewrite.*
3. The blend resolving its edge by a geometric point rather than an index.

Note how close this already is to us: `topo-name.ts` names an edge *by the two adjacent faces*, and W1 (`name_edge`, `between` + `carried`) is DONE. What is missing is steps 2 and 3.

**Keep the convex `Region` work, but for the right reason and as separate work.** `Region` limits what the boolean can *compute*; the coplanar defect in the spike (`ops.rs:4319`, 15546.67 against 15840) is a genuine boolean accuracy bug and does need the general region. But that is a *boolean accuracy* problem, not a *blend-on-boolean* problem. Do not conflate them, and do not let this correction soften the priority of the spike.

## What else the reference is worth, and what it is not

From reading its `blending/` tree directly. Sizes: `blend/edge/open.rs` 1245, `blend/edge/closed.rs` 968, `blend/corner/general_star.rs` 875, `blend/corner/ball.rs` 366, `law.rs` 587, `fillet.rs` 73, `blend/mod.rs` 94. The edge march alone is ~2200 lines before siblings; `corner/` is ~2300 across 8 files.

**Take these three, in this order:**

1. **`RadiusLaw`** (`law.rs`, 587 LOC, pure math, zero topology coupling). Variable radius, per-vertex radii, auto smooth transitions, constant radius as the degenerate case. Best value-per-line in the subsystem and trivially portable — it touches no topology. This is the answer to our absent "graded radius", and it is a standalone polynomial module, not a geometry problem.

2. **The refusal taxonomy** — `KernelRefusal` carrying a pipeline stage + a programmatic slug + a plain sentence, refuse-never-clamp. We already have the behaviour and the plain sentences; the slug is the addition, and it is what makes a refusal *matchable by a test* rather than only readable.

3. **The residual-as-verdict trick** (`corner/ball.rs:18-22`): for an N>=4 corner, the least-squares residual of the tangency system *is* the "does a common ball exist" test. Turning an unsatisfiable system into a number you can threshold is a generalisable idea, and it is how you get feasibility checks that need no closed form.

**Skip the corner solver beyond trihedral.** `ball.rs` genuinely solves N=3 via damped Gauss-Newton on the offset-tangency system (~150 LOC of real math, pure analytic surfaces). But `general_star.rs` is solved for **N=4 only** and refuses beyond: *"needs recursive fillet-of-fillet subdivision (Golovanov 6.9.7) which is not yet implemented."* The reference half-solves this too, so we are not behind.

**Skip the direct topology surgery** (`edge/open.rs` + `closed.rs` + the support/network machinery, multi-thousand LOC) and the `general_star` Coons patch, which needs fitted NURBS and Bezier pcurves — foreign to an analytic-only kernel. Notably **the reference itself keeps a cutter fallback** and treats the surgery path as experimental-adjacent, so its production route is closer to our cutter approach than to the surgery. We are not behind by choosing the cheaper construction.

## Reply requirements

Reply in the message log with `--re last`. Include:

1. **The pinned bail-out line** for bug 2, and the condition that triggers it.
2. **The shape-boundary table** for bug 2 — which combinations compose, which no-op.
3. What you fixed, and the gate reading before and after. If a defect is fixed but the gate is still red, say which line is red and why.
4. **The one unpinned design decision:** how to catch bugs that OCCT shares — closed-form assertions in the fixture set (overturning the gate's stated "no hardcoded numbers" rule), or native `#[test]`s per composition rule, or both. Give a recommendation and a cost, not a menu.
5. **Every check you could NOT perform, unasked.** Naming a lens you skipped is a complete answer; reporting it as passing is a false one. Concretely: did you rebuild the wasm, or measure the Sep 28 binary? Did you run `cargo test`? Did you run any gate other than parity? If you did not run something, say so.
6. Anything you found that contradicts this spec. **A spec that is wrong is worth more to the lead than a spec that is obeyed** — say so plainly if you find one.
