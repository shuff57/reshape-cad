# SPEC — brep-rs feature provenance: the reference-kernel decision, and the counterbore dispatch

Written 2026-09-29. Parent: `docs/specs/SPEC-brep-kernel-rs.md`.

This spec records a **decision** (do not adopt an external kernel; borrow its design
instead) and the **one feature** that decision makes worth building next. Hole, shell,
fillet and blend are already dispatched in `SPEC-brep-hole.md`, `SPEC-brep-shell.md`,
`SPEC-brep-fillet.md` and `SPEC-brep-blend.md` — this spec does not re-spec them.

---

## Verdict up front

| Question | Answer |
|---|---|
| Do we adopt `mmiscool/next.BREP.io_RUST_BREP_KERNEL`? | **No.** Its licence requires every modification to be PR'd back with irrevocable copyright assignment, or bought commercially. Failure to contribute back **voids all permissions**. Not adoptable, not forkable, not vendorable |
| Do we read it? | **Yes, as a design reference.** Reading is unrestricted. Copying code is not — see the licence section |
| Is it a real B-rep kernel? | **Yes.** NURBS surfaces, p-curves, exact booleans with typed refusals, fillet networks, offset shells, STEP both ways. Not a CSG engine in disguise |
| Does it work? | **Unverifiable from outside.** Zero runnable tests, zero CI, private development history, 0 issues. The parts that would prove quality are the parts withheld |
| Are we ahead or behind? | **Split.** They are further on feature breadth. We are ahead on architecture discipline, dependency modelling, wasm boundary, and — decisively — on having a runnable independent oracle |
| Scale | Their kernel **248,560 lines**. Ours **11,031** across six layers (`geom` 1013, `topo` 242, `ops` 4876, `build` 3242, `mesh` 1335, `history` 323) |
| Next feature to build | **Counterbore + countersink.** Absent from the kernel entirely; one revolved profile and one subtract |
| Is counterbore blocked on the coaxial-boolean defect? | **No, and this reverses an earlier assumption.** The construction makes the defect unreachable by design, not by repair |
| Test corpus gap found | **No gate fixture places two holes on one axis.** That is why 70/72 was green while a silent wrong solid shipped |

---

## 1. The licence — why adoption is closed

`LICENSE.md` in that repo, clause 1, verbatim:

> Any modifications made to the Software must be submitted to Autodrop3d LLC with an
> irrevocable assignment of the copyright via git pull request. … Failure to contribute
> back modifications without a commercial license purchased from Autodrop3d LLC voids all
> permissions granted by this license.

`BREP_kernel/Cargo.toml` declares `license-file` rather than an SPDX identifier, because
it is not OSI-approved. The crate is published on crates.io at 7 versions, so the
dual-licensing is live, not aspirational.

Consequence: forking, vendoring, or modifying requires a commercial purchase. A pull
request does not help us — it surrenders the copyright. **Read the design; do not
vendor the code.** Everything in §3–§5 is a description of an approach, reimplemented in
our own terms.

Secondary blocker, for the record: their browser app is `egui` compiled to wasm — the
whole UI in Rust — not a JS-callable kernel API. Even under a permissive licence,
embedding that in a React app would be a rewrite.

## 2. What is knowable about their kernel, and what is not

MEASURED from the public repository 2026-09-29:

- GitHub repo created **2026-09-28**, **2 commits**, **1 contributor**, 3 stars, **0 issues**,
  **0 PRs**, 0 releases, **0 CI workflows**.
- `CONTRIBUTING.md`: *"This publishing repository does not contain the internal test
  suite, datasets, plans or specifications."* It is a snapshot of a private repo.
- **Zero `#[test]` functions in the public tree.** The only visible verification is
  `audit_step_manifold` — a self-audit. Internal consistency, not an independent oracle.
- crates.io: 7 versions since 2026-08-25, 253 total downloads.

Their own source concedes the gaps: the blend network's remaining corner closures
(*"mixed-convexity torus sectors and the N≥4 no-common-ball Coons fill … Both are on
their way out"*), and *"analytic and fitted geometry coexist, so successful construction
is not a promise of zero approximation."*

**This is why we do not adopt even setting the licence aside.** A B-rep kernel is the
class of software where "looks right" is not "is right". Every hard-won fact in this
project — the 6/6 successive-bore floor loss, void-wall detection, the coplanar-chamfer
spike — came from a *runnable* measurement. Theirs is not publicly runnable.

## 3. What is worth taking

### 3.1 The single highest-value idea, and it is already half-built here

`boolean_result_is_sound` at `packages/brep-rs/src/ops.rs:3491` is the architecture
pattern their kernel implies and their docs never state: **cross-check the result
against the operation's own semantics, and refuse on disagreement.** It probes either
side of every face and verifies the classification matches the result solid.

Keep this. It is the right idea and it is ours. §4 records the defect that made it
ineffective, and it was found by the method the pattern prescribes.

Their `ConservativeEmptyOverlap` and the internal-tangency pinch gate
(`csg/boolean/mod.rs:191-202`) are the same instinct made specific: a subtract whose
operands touch tangentially with co-directed normals pinches to zero thickness, and is
**refused rather than returned as a perturbed sliver**.

### 3.2 Partial results as a return value

Their history is halt-on-error, but the errored `FeatureResult` sits in `results`
alongside every success (`feature_pipeline/mod.rs:2055`), and a *successful* feature that
applied only part of its selection reports a typed `Fulfilment{requested, applied}`.
This is the per-feature refusal contract this project already has, independently
designed. No change needed — worth knowing ours is the same shape.

### 3.3 Tolerance taxonomy

`geometry/tolerance.rs` classifies every tolerance as identity/coincidence (may
size-couple, but only at a named site) or fit-accuracy (must stay tight — the doc
records that coupling them *"was tried and REJECTED"* and broke booleans). A single
spatial base tolerance beats scattered epsilons. Candidate for a later pass, not this one.

### 3.4 Kernel-source-hash stamping of cached geometry

FNV-1a over kernel sources at build time, compared at cache-read time, with "no stamp =
disable invalidation" as the failure mode (`build.rs`, `parts_library.rs:139`,
`assembly_component.rs:112`). Trivial, and it would protect `bench/record.json` and any
future incremental cache against "the wasm changed but the cache did not."

## 4. Defect found while comparing — the coaxial-hole wrong solid

This was found by probing, not by reading, and it is the reason this spec exists.

### 4.1 Measured

40×40×20 box, `depth: 22` (through), axis z. Analytic expectation for a through bore of
diameter *d* is `32000 − π(d/2)²·20`. HEAD = `4dd1e58`; working tree = HEAD plus the
uncommitted `history.rs` / `wasm.rs` / `ops.rs` changes.

| Case | HEAD | Working tree |
|---|---|---|
| single `d12` through | ok | ok |
| `d6` + `d12`, small first | ok | **WRONG** −60π |
| `d6` + `d12`, **large first** | **WRONG** = `d6`-alone volume | **WRONG** −60π |
| `d6` + `d6` identical | ok | **WRONG** +60π |
| `d6` through + `d12` blind | **WRONG, silently** | refused, honestly |
| `d6` blind + `d12` through | ok | refused, honestly |
| `d4` + `d8` + `d12` through | ok | **WRONG** −418.9 |

Every failure is ±60π — a volume error located entirely on a **cylindrical bore wall**.

### 4.2 Root cause, and it is not what it first looks like

Three candidate explanations were tested and two are wrong:

- **Not the tool-fuse loop** (`wasm.rs:927-978`). That loop only runs when one hole
  feature yields multiple tools, which only happens via `corners` (`wasm.rs:893-913`).
  Two separate coaxial hole features never enter it.
- **Not a regression from the uncommitted change.** The change is correct and should be
  kept: it adds the PartDesign cumulative-cut convention (`History::heads`,
  `head_of`, `advance_head`) consistently across pocket, hole and groove, and it repairs
  the stacked-bores composition.

What is actually true, in two parts:

1. **At HEAD every cut starts from the original body.** There is no `heads` map, so
   `hist.shapes.get(&target)` returns the body, not the previous cut. Two coaxial holes
   each cut from the original box and the last one wins — hence HEAD's large-first case
   returning the `d6`-alone volume. This is invisible for non-coaxial holes, because
   disjoint tools give the same answer either way. That is why 244 tests and 70/72 gates
   never saw it.
2. **The uncommitted change fixes that, and exposes a latent boolean defect.** Cuts now
   accumulate, so the boolean is asked to subtract a tool that overlaps material already
   removed. Both directions fail — tool-inside-void and void-inside-tool — which is the
   signature of a degenerate boolean, not of a tracking error.

3. **The boolean's own soundness guard is blind to it.** `ops.rs:3416`:

       let Surface::Plane(plane) = &fb.surface else { return Vec::new() };

   `planar_face_samples` returns an empty vec for every non-planar face.
   `boolean_result_is_sound` therefore never inspects a bore wall, and returns `true`
   having verified nothing relevant. The intent was already there — the `plain` closure
   at ~3497 states the check is *"trusted on planar and cylindrical operands"*. The
   predicate allows cylinders through; the sampler cannot sample them.

**Lesson worth more than the fix:** the uncommitted work did not break anything. It asked
a question the referee had never been asked, and the referee was looking at the wrong
place. Had it been reverted on suspicion, a real defect would have stayed buried under a
regression that was never there.

### 4.3 Status: FIXED in §4.3f. The trail below is kept because the wrong turns are the useful part.

Three attempts went into the wrong place. The measurements below are what is
actually known; the reasoning that produced them was wrong twice, and is recorded so
the next attempt does not repeat it.

**Attempt 1** blamed the tool-fuse loop at `wasm.rs:927-978`. Wrong: that loop only
runs when one hole feature yields several tools, which only happens via `corners`.

**Attempt 2** extended `planar_face_samples` to sample cylindrical faces — full
cylinder (no `arc`), no inner wires, radial normal `cross(-e1*sin u + e2*cos u, axis)` per
the convention at `ops.rs:2367`, eight samples at mid-v, abstaining on a degenerate
frame. This **works as intended** and is kept: MEASURED, the bore wall reports
`cyl-full wires=1 samples=8`. It changed the probe by nothing, which prompted:

**Attempt 3** hypothesised that `boolean()`'s three early returns —
`subtract_enclosed`, `cylinder_pair_boolean`, `cylinder_open_hollow` — return before the
guard runs. **MEASURED FALSE.** Trace markers were placed in all three; none fired.
The coaxial subtract takes the **general path** and `boolean_result_is_sound` *is*
called.

So the situation is narrower and stranger than "the guard is bypassed":

- the guard runs;
- it samples the bore wall (8 samples, confirmed);
- and it returns `true` on a result that is wrong by exactly 60*pi.

Also MEASURED: the result has **7 faces both before and after** the second bore — same topology, different volume. Removed volume is 780*pi where 720*pi is correct, an excess of exactly 60*pi.

### 4.3a FALSIFIED: it is NOT a misplaced wall

An earlier draft of this section claimed the result's bore wall was built in the wrong place — `vmin=1.0, vmax=21.0` "instead of `[-10,10]`", offset by +11. **That was wrong**, and it is recorded here because the arithmetic that produced it looked sound.

MEASURED, comparing the operand `a` (correct) with the result `r` (wrong):

    a face 6: r=6.0000 origin_z=-11.0000 vmin=1.0000 vmax=21.0000 world_z=-10.0000..10.0000 wires=1
    r face 6: r=6.0000 origin_z=-11.0000 vmin=1.0000 vmax=21.0000 world_z=-10.0000..10.0000 wires=1

**The bore walls are identical and correct in both.** `v` on a `Cylinder` is local to `origin`; `origin_z = -11` makes `[1, 21]` exactly world `z` in `[-10, 10]`. The mistake was reading a local parameter range as a world one. The same slip produced a second false claim — that the guard's probes at world `z = 0` "land where the defect is not expressed" because the wall sat at `z` in `[1, 21]`. World `z = 0` is well inside the correct wall.

A corollary worth keeping: `780*pi` removed does **not** imply a wall radius of `sqrt(39) = 6.245`. The radius is 6.0. That was arithmetic with no measurement behind it.

### 4.3b ROOT CAUSE CONFIRMED: the tool's circle is added as a spurious inner wire

MEASURED, per-face signed-volume terms for `a` (correct) against `r` (wrong). Built with a temporary `#[cfg(test)]` helper inside `build.rs` mirroring `signed_volume`'s math exactly — it has to live there because `face_edges` (`build.rs:758`) is private, so the planar term cannot be recomputed from `ops.rs`. The helper has since been removed:

    face 0: a[plane term= 14869.026645 w=2 e=5]  r[plane term= 14586.283306 w=3 e=6]  DELTA= -282.743339
    face 1: a[plane term= 14869.026645 w=2 e=5]  r[plane term= 14586.283306 w=3 e=6]  DELTA= -282.743339
    face 2: a[plane term= 16000.000000 w=1 e=4]  r[plane term= 16000.000000 w=1 e=4]  DELTA=   0.000000
    face 3: a[plane term= 16000.000000 w=1 e=4]  r[plane term= 16000.000000 w=1 e=4]  DELTA=   0.000000
    face 4: a[plane term= 16000.000000 w=1 e=4]  r[plane term= 16000.000000 w=1 e=4]  DELTA=   0.000000
    face 5: a[plane term= 16000.000000 w=1 e=4]  r[plane term= 16000.000000 w=1 e=4]  DELTA=   0.000000
    face 6: a[cyl   term= -4523.893421 w=1 e=4]  r[cyl   term= -4523.893421 w=1 e=4]  DELTA=   0.000000

Only faces 0 and 1 — the box's top and bottom — change, and only in their **boundary**: wire count goes 2 to 3, edge count 5 to 6. The bore wall (face 6) is untouched, confirming §4.3a.

The arithmetic closes exactly, which is what makes this a diagnosis rather than a correlation:

- the d6 tool's circle has area `pi * 3^2 = 28.274334`;
- a planar face's term is `area * dot(plane.n, centroid)`, and the top/bottom centroid sits 10 from the origin, so `28.274334 * 10 = 282.743339` — the measured delta, to all six decimals;
- two such faces: `2 * 282.743339 = 565.486678`;
- `signed_volume` divides the face sum by 3: `565.486678 / 3 = 188.495559` = **60*pi**, the exact volume discrepancy.

**So the d6 circle is being added as a third inner wire on a face that already carries the d12 hole.** The d6 lies wholly inside the existing void, where the correct answer is that it removes nothing at all: `a - b = a` when `b` is entirely inside the void. Instead it is trimmed as if it were real material, subtracting its area from the face.

Note `build.rs` already has a refusal for precisely this shape on another path — a test asserts `"an island inside a hole must refuse"`. The planar trim here does not consult it.

**The fix, in order:**

1. In the planar-face trim inside the general path, detect a tool circle falling entirely within an existing inner wire of that face, and skip it — it is inside the void, so it must contribute no new wire and no area change.
2. Guard the new inner wire against landing exactly on an existing one (a concentric duplicate is the degenerate case of the same bug — and it is what a counterbore would produce if built as two cylinders, a further reason to build counterbore as one revolved profile instead).
3. Then re-measure. If the geometry is right, check whether `boolean_result_is_sound` catches anything on these cases; do not harden the guard speculatively. Eight mid-v probes on a correct wall agreeing perfectly is the guard working, not failing.

Four wrong guesses are recorded in this section — the fuse loop, the heads change, the three early returns, and the misplaced wall — and a fifth, `sqrt(39) = 6.245` as an implied wall radius, was arithmetic with nothing behind it. **Instrument before theorising, and print `origin` alongside any local parameter range.**

### 4.3c A fix at that choke point WORKS on the coaxial case, and regresses one gate fixture

Implemented and measured, then reverted. Recorded because it bounds the remaining work tightly.

`face_with_hole` (ops.rs:1294) is the single choke point all six planar-hole call sites funnel through. An outcome enum there — `AlreadyVoid` / `Swallow(Vec<usize>)` / `Append`, deciding circle-vs-circle analytically — gave:

| probe row | before | with fix |
|---|---|---|
| B d6+d12 | −60π | **exact** |
| C d6+d12 | −60π | **exact** |
| D d6+d6 | +60π | **exact** (−3.6e-12) |
| G d4+d8+d12 | −418.9 | **exact** |
| E, F | refused | refused (unchanged, still honest) |

So the root cause is confirmed fixable exactly where §4.3b says, with no fudge factor.

**But it regressed `ops::y2_bench_final_exact`**, taking cargo test from 244/1 to 243/2. MEASURED failure: `volume 59941.240188500735 vs exact 59901.97021656914`, i.e. `+39.269971931595` = exactly `2 * pi * 2.5^2` — two of the flange's four r=2.5 holes, the ones at x = ±18.

Those span x ∈ [15.5, 20.5]. The union's standing cylinder bites an r=20 disk spanning [0, 20]. The two holes therefore **straddle** that boundary: 15.5 < 20 < 20.5. Neither wholly inside (so not `AlreadyVoid`) nor wholly containing (so not `Swallow`). The correct treatment is an arc notch on the bitten boundary — the `keep_disk_two_arcs` path — not a full inner wire.

So the remaining work is the straddle case, and it is a THIRD distinct geometry mode, not a harder version of the first two:

1. hole wholly inside an inner wire → skip it (already-void)
2. hole wholly containing an inner wire → drop that wire
3. hole crossing an inner wire's boundary → rebuild as arcs

Only 1 and 2 are needed for the coaxial bug. Mode 3 is what a correct union needs, and it is NOT a wiring job. `keep_disk_two_arcs` (`ops.rs:2179`, called from exactly one place, the outer-disk path) takes a single `(center, radius)` pair — the face's OUTER disk — and emits arcs for that one disk against one other disk. It has no notion of inner wires at all. Generalising it to emit arcs for an arbitrary inner wire, coexisting with the face's other inner wires, is new construction. Budget mode 3 as a build, not an adaptation.

A first attempt at 2 was wrong in its own right: `Swallow(usize)` returned on the FIRST contained wire, so a bite covering several holes dropped one and left the rest as phantom voids. It must collect every contained wire. Worth knowing before anyone retries.

Reverted, because trading four silent wrong solids for one is not a win, and a green fixture is evidence the project does not get to spend.

### 4.3d LANDED: mode 1 only. Two of the four rows fixed, zero regressions.

The decisive fact that made a safe subset possible: `geom::planar_measure` (`geom.rs:336`) sums each wire loop's **signed** area via Green's theorem and does NOT collapse nested wires. Two nested holes both wind as holes, so both subtract and the inner one double-counts. That is exactly the coaxial defect — a d12 wire gives −36*pi and a concentric d6 wire inside it another −9*pi, where the void is only −36*pi. Area short by 9*pi = 28.274334 per face, matching the measured per-face term loss of 282.743339 at the face's 10mm offset.

So mode 1 alone is provably correct, and — the part that makes it safe — **mode 1 cannot fire in the Y2 fixture**: the r=20 bite is far larger than the r=2.5 wires, and the four small holes sit at distinct centres. That is a falsifiable prediction, and it held.

`hole_wholly_inside_inner`, called at the top of `face_with_hole` (`ops.rs:1294`), returns the face unchanged when the new hole lies wholly inside an existing inner wire. Circle-vs-circle is decided analytically, so a duplicate (concentric and equal) is caught too. A hole that merely CROSSES a wire is neither inside nor containing and takes the old path.

MEASURED after landing:

| check | before | after |
|---|---|---|
| probe C d12-then-d6 | −60*pi | **exact** |
| probe D d6 + d6 identical | +60*pi | **exact** (−3.6e-12) |
| probe B d6-then-d12 | −60*pi | −60*pi (needs mode 2) |
| probe G d4+d8+d12 | −418.9 | −418.9 (needs mode 2) |
| probe E, F | refused | refused (unchanged, still honest) |
| `cargo test --release` | 244 pass / 1 fail | 244 pass / 1 fail |
| `brep-parity-gate.mjs` | 70 / 2 | 70 / 2 |
| `brep-mesh-gate.mjs` | 70 / 2 | 70 / 2 |

Two silent wrong solids eliminated, nothing regressed. (Superseded — mode 2 landed too; see §4.3f.)

### 4.3e WHY mode 2 regressed Y2 — now measured, not unexplained

Every `face_with_hole` call in the Y2 fixture was traced. The decisive one, verbatim:

    plane_o=(32.00,0.00,3.00) wires=[r32.00 r2.50@(0,-50) r2.50@(0,-38)
                                      r2.50@(0,-26) r2.50@(0,-14)] <- Circle(c=(0,-32) r=20)

This is the union's standing cylinder biting an r=20 disk out of the flange's top cap. The bite is centred at v = −32 with r = 20, so it spans v ∈ [−52, −12]. Of the four existing r=2.5 hole wires:

| wire | distance from bite centre | spans | relation to the bite |
|---|---|---|---|
| v = −50 | 18 | 15.5 … 20.5 | **straddles** the bite edge at 20 |
| v = −38 | 6 | 3.5 … 8.5 | wholly inside |
| v = −26 | 6 | 3.5 … 8.5 | wholly inside |
| v = −14 | 18 | 15.5 … 20.5 | **straddles** the bite edge at 20 |

Mode 2's `Swallow` drops exactly the two wholly-inside wires. Their combined area is `2 * pi * 2.5^2 = 39.269971931595` — **bit-for-bit the Y2 regression** reported in §4.3c. The two straddling wires are correctly left alone, because neither containment test fires on them.

So the regression is fully accounted for, and it is NOT a bug in the containment test: on that face the two interior holes are *supposed* to keep contributing. The face is the flange top at z = 3 with an outer wire of r=32 (not 35 — the r=3 rim round shrinks it), and the closed form the fixture asserts is `flange_volume + pi*20^2*30`. Adding the bite and dropping the two interior holes changes the cap's area by exactly those two hole areas, and the fixture's expected volume moves with the face count, so the assertion fails by precisely that amount.

**What this means, and how it was resolved:** mode 2 is only safe on a face where the new hole is the LAST word on that region — true for the coaxial case, false for Y2. §4.3e framed that as an open design question. It is not: the distinguishing test is simply **whether any wire straddles the new hole's boundary**. If one does, the region is not fully consumed and nothing may be dropped; if none does, the contained wires are genuinely interior and go. That is the whole rule, and it is measured, not guessed.

### 4.3f LANDED: modes 1 and 2. The coaxial wrong solid is fixed.

Two guards now sit at the top of `face_with_hole` (`ops.rs:1346`), both keyed off inner wires only — `boundary[0]` is the outer loop and never qualifies:

- **`hole_wholly_inside_inner`** — the new hole already lies inside an existing inner wire. It removes nothing, so the face is returned unchanged. Circle-vs-circle is decided analytically, which also catches a duplicate.
- **`wires_consumed_by_hole`** — returns `None` if ANY inner wire straddles the new hole's boundary, and otherwise the indices of the wires the new hole wholly contains, which are dropped as now-interior.

MEASURED, all 2026-09-29:

| probe row | before any fix | after |
|---|---|---|
| B d6 then d12 | −60*pi | **exact** |
| C d12 then d6 | −60*pi | **exact** |
| D d6 + d6 identical | +60*pi | **exact** (−3.6e-12) |
| G d4+d8+d12 | −418.9 | **exact** |
| E, F | refused | refused (unchanged, still honest) |
| `cargo test --release` | 244 pass / 1 fail | **245 pass / 1 fail** (one new pin) |
| `brep-parity-gate.mjs` | 70 / 2 | 70 / 2 |
| `brep-mesh-gate.mjs` | 70 / 2 | 70 / 2 |
| `brep-step-gate.mjs` | same honest cone/sphere/torus refusals | unchanged |

The one failure is the deliberately-pinned `spike_coplanar_chamfer_on_a_boolean_result_is_exact`, untouched throughout. `coaxial_bores_of_differing_diameter_are_exact` (`ops.rs`, test module) now pins all four orderings, so this cannot silently return.

**Still open, and deliberately so:** mode 3, a hole crossing an inner wire's boundary, is *skipped* rather than solved — the straddling wire is left as a full circle rather than notched with arcs. Instrumenting the bail-out and running the whole suite shows it fires exactly once, in `ops::y2_bench_final_exact`. So the path has one live guard, and no coverage at all beyond it.

**The guard is weaker than an earlier draft of this line claimed.** That draft called `flange_volume + pi*20^2*30` an independent closed form and treated the fixture's pass as evidence the bail-out is right. Dumping every face of the Y2 union (temporary instrumentation, since removed) does not support that. MEASURED:

- the union has **no face covering the r=20 disc at z=3** — the standing cylinder's bottom cap is simply absent, so where a flange hole sits under the cylinder, void below meets solid above with no boundary face at all;
- the flange's top cap (r=32) keeps **all four** hole circles, including the two at x = ±6 that lie wholly inside the removed r=20 region, giving `599*pi` where the true annulus would subtract only the two straddlers' lunes;
- the total volume nevertheless comes out at `59901.970280`, matching the fixture's expected value exactly.

So a boundary that appears to be missing a face, plus an over-trimmed face, lands on the expected total. **The independence question is now settled, and it came out clean.** An independent derivation of the flange (barrel `pi*35^2*3` plus the filleted cap integrated as a solid of revolution, `r(z) = 32 + sqrt(9 - z^2)`, minus `4*pi*2.5^2*6`) gives `22202.858435` against the fixture's `22202.858373` — a relative difference of `2.767e-9`, which is the Simpson error of that derivation, not a discrepancy. So `22202.858373491622` IS a genuine closed form, and Y2 really is an independent oracle for total volume.

What the face dump leaves unexplained, then, is the reconciliation itself: the total lands on the independent closed form while the face list looks wrong. Either my reading of the dump is mistaken — most likely, since I may be misidentifying which face is the cylinder's bottom cap — or the divergence sum compensates in a way I have not identified. **Not established either way.**

**And that is the sharper reason to defer mode 3, better than coverage alone: the fixture asserts a total volume and nothing else.** It cannot distinguish a correct face decomposition from a compensating one. A mode-3 change that left the total at 59901.970 while making the faces correct would pass; so would one that made them differently wrong. There is no fixture that inspects the interface's face structure, so there is no way to tell progress from noise on exactly the thing mode 3 changes.

Verified state of the working tree, all measured 2026-09-29:

| Check | Result |
|---|---|
| `cargo test --release` | 245 passed, 1 failed (the pinned coplanar spike only; +1 is the new coaxial pin) |
| `scripts/brep-parity-gate.mjs` | 70 passed, 2 failed — baseline, no new failures |
| `scripts/brep-mesh-gate.mjs` | 70 passed, 2 failed — baseline, no new failures |
| `scripts/brep-step-gate.mjs` | refused the same known cone/sphere/torus faces; no recorded baseline count to compare against |
| coaxial probe, 7 cases | **A, B, C, D, G all exact. E, F still refuse honestly.** Fixed by §4.3f. |
| temporary instrumentation | none left in the tree; class-2 doc comment byte-identical to HEAD |

False-refusal risk, if the guard ever does start seeing bore walls: a 1e-4 radial probe
near a seam or trimmed edge landing on the wrong side and refusing a currently-correct
solid. Per the code's own stated philosophy at ~3498 — *"an unreliable check must abstain
rather than refuse a correct solid"* — a face that cannot be sampled reliably must yield
an empty vec, not a guess. That is why the sampling is restricted to full cylinders
with no inner wires.

### 4.4 Gate corpus gap

`bores-blind-stacked` and `bore-through-then-blind` both space their holes at
x = −12, 0, 12. **No fixture places two holes on one axis.** The referee is sound; the
corpus never asked it this question.

Fixture to add when the lead claims `scripts/brep-parity-fixtures.mjs` (LEAD-OWNED — a
builder must not edit it): coaxial through-holes of differing diameter in **both**
orderings, plus the identical-pair case. That single fixture would have caught HEAD's
large-first failure and all four working-tree failures.

## 5. Next dispatch — counterbore and countersink

**Not currently implemented.** The strings appear nowhere in `packages/brep-rs/src/` or
`packages/script/src/model-types.ts`. `SPEC-brep-hole.md:40` defers it: *"fusing
overlapping bores is a later dispatch."*

### 5.1 The construction — one profile, one revolve, one subtract

Counterbore is **not** a boolean of two cylinders. It is a single revolved stepped
profile, subtracted once. The two-diameter geometry lives in the profile, so **the boolean
never sees two coaxial cylinders at all.**

The reference kernel builds exactly this: one closed 2D profile in the (radial, axial)
half-plane — bore radius out to `bore_depth`, a shoulder step out to the hole radius, then
the straight hole down to `straight_depth` — revolved full turn into a single cutter, then
one `boolean_operation(target, cutter, Subtract)`. Described, not copied; the licence
forbids the latter.

Countersink is identical with one slanted segment, sink height derived from the included
angle.

### 5.2 Why this is the cheapest feature on the list

- We already have `revolve` and a sound single-tool subtract — the single-`d12` control
  case in §4.1 is exact to 0.0.
- **It makes the §4 defect unreachable by construction** rather than depending on its
  repair. This reverses the earlier assumption in this spec's own history that counterbore
  was blocked on the boolean fix.
- It is a listed teaching requirement and students use it constantly.

### 5.2a BUILT BUT NOT CUTTABLE — the blocker is in the boolean, not the tool

> **Superseded by §5.2b.** Kept as the trail. Three things below are wrong and are corrected
> there: where the refusal was, both closed forms, and the claim that the recess was already
> measured from the face (the code read the tool's end).

Implemented and measured 2026-09-29, and left as two deliberately-failing spikes
(`spike_counterbore_cuts_the_analytic_volume`, `spike_countersink_cuts_a_cone_not_a_cylinder`),

following the existing `spike_coplanar_chamfer_on_a_boolean_result_is_exact` convention so the
suite reads as a known gap rather than a broken build.

What landed:

- `HoleFeature` gains optional `counterbore: {diameter, depth}` and `countersink:
  {diameter, angleDeg}` in `packages/script/src/model-types.ts`. Additive: a plain `hole`
  takes neither and is untouched, and the four existing hole fixtures still pass at
  parity 70/2 and mesh 70/2.
- `hole_tool` in `packages/brep-rs/src/wasm.rs` builds the tool as ONE revolved stepped
  profile through `build::revolve_profile`, exactly as §5.1 specifies. A plain hole still
  goes through `cylinder_solid`, so the existing path is unchanged rather than merely
  equivalent.
- Degenerate recesses refuse in a plain sentence: deeper than the bore, no wider than the
  bore, zero deep, and both recesses on one mouth. `degenerate_recesses_refuse` passes.
- The recess is measured from the TARGET'S FACE, not from the tool's end, so a "d12 6
  deep" counterbore is 6 deep in material however far the bore overshoots. Pinned by the
  oracle: measuring from the tool's end would give 30869.03 against an exact 30755.929.

**The blocker, and it is NOT the two radii.** `ops::boolean` refuses the subtract and the
hole comes back "brep-rs cannot cut this hole yet". `hole_tool` returns `Some`, so the tool is
well formed. MEASURED, by building the shapes directly and subtracting each from a
40x40x20 box (instrumentation since removed):

| tool | result |
|---|---|
| plain cylinder r=3 through | **subtracts** |
| revolved stepped tool, 2 radii, 5 faces, crossing both target faces | **refused** |
| the SAME stepped tool, shoulder at z=-2 instead of z=+4 | **refused** |
| the SAME stepped tool lying entirely INSIDE the box, touching no face | **subtracts** |

So the two-radius revolved tool is fine on its own. What the boolean cannot do is a tool
whose wall PIERCES a target face. Two earlier guesses are now excluded by measurement,
not by argument: it is not coplanarity (overshooting the mouth past the face did not help),
and it is not the shoulder annulus or the radius step (the interior case has both and works).
Shoulder position is irrelevant too — z=4 and z=-2 behave identically.

Corroborating, and probably the same defect: the kernel's OWN
`cylinder_pair_boolean("union", d6-through, d12-blind)` also returns `None`. Those two
coaxial cylinders differ in radius AND depth, so neither contains the other — the same
"coaxial but not nested" shape the counterbore tool presents. One defect, not two.

**Still not established: the CODE.** The four measurements localise the CONDITION
exactly; they do not localise where the refusal happens. Two corrections to the obvious
hypothesis, because both are wrong and would waste the next attempt:

- **Not** "the region is a single disk, so a stepped tool cannot be expressed". `Clamped`
  (`ops.rs:759`) already has `Annulus(centre, r, hole_centre, hole_r)` -- a disk
  with one subtractive hole -- and a `Mixed(pieces, centre, r)`. The representation is
  there. What is missing is handling: `Annulus` and `Mixed` are produced (1204, 1790) and
  matched (1895, 1900), yet both `return None` at **1977-1978** on one arm. Read those
  lines first; the shape is representable and something declines to use it.
- The "entirely inside the box" row is WEAKER evidence than it looks. A tool touching no face
  never makes `process_face` compute a face region at all, so that case does not exercise
  the region code. It shows the condition (a wall crossing a face) is necessary for the
  refusal; it does not show the region logic is what refuses.

**FALSIFIED: the refusal is NOT the documented `Annulus`/`Mixed` deferral.** An earlier draft of
this line named `ops.rs:1977-1978` as the blocker, on the strength of a real deliberate
deferral sitting right there:

    // A mixed-shaped hole (arc-bounded cut into a face) isn't built
    // yet -- no fixture needs it, and a wrong hole is worse than a
    // refusal (SPEC constraint 4).
    Clamped::Annulus(_, _, _, _) => return None,
    Clamped::Mixed(_, _, _) => return None,

That deferral is genuine and is still an unimplemented capability. It is simply not this bug.
MEASURED by putting an `eprintln!` in each of those two arms and running
`spike_counterbore_cuts_the_analytic_volume`: **neither arm fired.** The instrumentation has
been removed and the arms restored to their original one-line form. So the counterbore tool
never classifies as `Annulus` or `Mixed` on this path, and the refusal comes from somewhere
else that this investigation did not reach.

This is a useful negative result, not a dead end: it removes the most obvious suspect and the
next person should NOT start there. What is still established is the CONDITION from the four
measurements above — a tool whose wall pierces a target face is refused, the same tool wholly
inside the box is not — and the corroboration that `cylinder_pair_boolean` also refuses two
coaxial cylinders differing in both radius and depth. Where in the boolean that refusal is
emitted remains **undiagnosed**, and `ops::boolean` has many `return None` paths, so locating it
means instrumenting the boolean's own exits rather than reading for a shape.

**A second negative result, and an incidental one about the primitive.** The obvious way to
discriminate "two coaxial radii" from "a planar face strictly inside the target" is a
frustum: two radii, a slanted wall crossing both target faces, and no planar face inside the
material. MEASURED, and it could not be run: `revolve_profile` **returns `None` for a plain
r=3 -> r=6 frustum**, while it builds the 5-face stepped tool without trouble. So the
control shape does not exist, the discriminator did not run, and the "internal planar
face" hypothesis is **still untested** -- it is a guess, not a finding, and should not be acted on.

The frustum failure is worth recording on its own: `hole_tool` depends on
`revolve_profile` to build stepped tools, and that primitive will not build a two-radius
conical wall at all. Any future work here should establish what profile shapes it accepts
before assuming a frustum is available as a simpler alternative to a stepped tool.

**Narrowed to four exits inside `keep_polygon` (`ops.rs:1686-1982`).** The Plane arm
dispatches on `circle_boundary`: a face with a single `Curve::Circle` boundary goes to
`keep_disk`, and everything else — which is every face of a box — goes to `keep_polygon`.
So the counterbore's target faces are the `keep_polygon` path, and that function has
exactly four `return None` sites:

| line | documented reason | status |
|---|---|---|
| 1773 | "Partial overlap of two circles is W8's lens/lune work: refuse honestly rather than guess" | **falsified — instrumented, did not fire** |
| 1880 | a coplanar-rescue variant reaching a keep-inside op, which the comment calls "a logic error" | **falsified — instrumented, did not fire** |
| 1977 | `Clamped::Annulus` deferral | falsified by instrumentation |
| 1978 | `Clamped::Mixed` deferral | falsified by instrumentation |

**All four `keep_polygon` exits are now falsified** — each was instrumented with an
`eprintln!` and none printed when `spike_counterbore_cuts_the_analytic_volume` ran. The
instrumentation has been removed. So the refusal is NOT one of these four, which means one of
two things, and neither has been checked:

- the face is dispatched to `keep_disk` rather than `keep_polygon` — `circle_boundary`
  returns `Some` for a face with a single `Curve::Circle` boundary, and a boolean result can
  produce circular faces, so "every box face is a polygon" is an assumption, not a measurement;
- or the refusal comes from a `return None` in `keep_polygon` **before** line 1773, or from a
  `?` on a call inside it that the four-site search did not cover.

The cheap way to settle which: print the dispatch decision itself (which callee the Plane arm
chose, and the face's wire count) before instrumenting further. **Do not assume the 1773
W8 lens/lune deferral is the answer** — it looks right, it is the obvious candidate, and it is
wrong. That is the third plausible-looking lead falsified by measurement in this
investigation, alongside `Annulus`/`Mixed` and the frustum control.
so this either names the line or eliminates 1773 and 1880 together.

**WHERE the refusal is: `process_face`, on a planar face of the TARGET.** The two shape-based
hypotheses above are both spent, so the boolean's own exits were instrumented instead (temporary,
since removed, `ops::boolean`'s two `process_face` loops restored to their original `?` form).
MEASURED, running `spike_counterbore_cuts_the_analytic_volume`:

    ZZEXIT process_face on face 1 of a returned None

So the refusal is not in `subtract_enclosed`, not in `cylinder_pair_boolean` or
`cylinder_open_hollow`, not in the manifold guard, and not in `boolean_result_is_sound`. It
is `process_face` declining one of the box's own planar faces when the tool's wall pierces it.
That is consistent with every measurement above: a plain cylinder crossing a face is fine, the
same stepped tool inside the box is fine, and it is the wall-crossing-a-planar-face case that dies.

**The next step is inside `process_face`'s `Surface::Plane` arm** -- specifically the path that
classifies what the tool does to that face and returns `None` when it cannot decide. That is a
function-local question now, not a whole-boolean one, and it is where I would resume.

The two closed forms first recorded here (30755.929 and 31236.593) were WRONG: both count
the bore's core twice. The OCCT-measured values are in §5.2b.

### 5.2b RESOLVED 2026-09-29 — counterbore cuts; countersink refuses honestly

**Where the refusal was: two sites, and neither was a `return None` the search covered.**
MEASURED by running each face through `process_face` on its own:

- Box face 1 (the bottom, z=-10): `region_inside(tool)` carried the constant `[0,0,15]` from
  the tool's SHOULDER plane. `region_inside` reads every parallel planar face as a global
  half-space, which holds only for a convex `other`, and a stepped tool is not convex.
  `clamp` returned `None`, then `keep_polygon`'s rescue
  `region.disk.filter(|_| region.hs.is_empty())?` refused. It is a `?`, which is why
  instrumenting the four `return None` sites found nothing.
- Tool face 2 (the shoulder annulus): the lens/lune `return None` (old line 1773). It IS on the
  path. It never printed because the boolean exited at box face 1 first.

**Fixes, `ops.rs`:**

- `region_inside` drops an unsatisfied parallel-face constant when some face of `other` has
  vertices strictly on both sides of the probe plane (`crosses_probe_plane`). `other` then has
  material on that plane, so "nothing here" is false. Separate lumps stacked with a gap cross
  nothing at the gap, so their caps still empty it. Vertices only: a curved face bulging past
  its vertices is under-read, which keeps the old behaviour. Edge adjacency was tried first
  and cannot work, because `revolve_profile`'s faces share no edge handles.
- `keep_polygon`'s disk-with-inner-wires path gains two exact cases ahead of the lens/lune
  refusal. WHOLE: the outer circle clears every half-plane by its radius and sits in the
  region's disk. CLEAR: it lies outside the region's disk, or wholly past one half-plane. The
  second is what a second counterbore needs against the first one's shoulder. Both must also
  hold POINT BY POINT (`inside_solid` on rings over the face, outside its circular holes),
  because the region is exact only for a convex `other`. MEASURED without that check: a
  shoulder crossing a prior pocket read CLEAR (the pocket's walls push x<=4 and x>=8) and
  was dropped, and only the soundness check's sample placement caught it. It now refuses at
  the face. Pinned by `counterbore_shoulder_across_a_pocket_is_never_dropped` (OCCT cuts it
  to 30810.862; brep-rs refuses, both orders).

**The spikes' closed forms were wrong.** Both counted the bore's core twice inside the recess,
the §4.3 coaxial double-subtraction pinned as the oracle. OCCT (replicad, `BRepGProp`, box
and tools rebuilt directly, both as fused cylinders and as one revolved profile) measured:

| case | OCCT | old spike |
|---|---|---|
| counterbore d12 x 6, measured from the face | 30925.575312 = 32000 - 342pi | 30755.929 |
| 90 degree countersink to d12, a real cone | 31321.415987 = 32000 - 216pi | 31236.593 |

Both are corrected in place, with the tolerance unchanged at 1e-6.

**`hole_tool` carried three defects the refusal had masked.** Each became a silent wrong solid
the moment the boolean cut:

1. The shoulder sat at `v_mouth - cd`, measured from the tool's end; `v_face` was passed in
   and never read. The spike's 22-deep bore got a 5-deep recess: 31010.398, which OCCT
   matches to 1e-11 for that tool.
2. `revolve_profile` spins about the WORLD axis, and the tool was never moved onto the hole's.
   An off-centre counterbore was cut on the world axis, and `corners` collapsed four tools
   into one: 30925.575 for a four-hole part, with no refusal.
3. `v_face` came from the hole's centre, not the target's bbox, so an axial `center` offset
   moved the face.

The countersink built the SAME stepped, cylindrical profile, i.e. a counterbore under a
countersink's name. It now refuses: `revolve_profile` builds no slanted wall, and
`boolean_result_is_sound` abstains on cones, so a cone tool would ship with no backstop.

**Measured after landing:** cargo 249 pass / 2 fail (the pre-existing chamfer spike, and the
countersink spike refusing honestly); parity 70/2 and mesh 70/2, the same two
(boolean-rounded-corner-cap, chamfer-on-boolean-result); STEP 62/0/8; gate:occt 17/0; kernel
`bun test` 36/0. Pinned by `counterbore_cuts_the_analytic_volume` (renamed from `spike_`) and
`counterbore_variants_are_exact`: blind with an axial offset, drilled along x, four corners,
each OCCT-refereed to 1e-11. The gates carry no counterbore fixture, because OCCT's builder has
no counterbore.

**Still open:**

- countersink: needs cones in `revolve_profile`, then a soundness check that can vouch for one;
- a counterbore as deep as the part refuses with the generic "cannot cut this hole yet", not
  a sentence naming the recess;
- by reading only, not measured: `keep_polygon`'s `de_facto_empty` arm keeps a keep-inside
  face (flipped) that it should drop. It is latent, and the soundness check would catch a
  face that bounds nothing.

### 5.3 Scope

In: `counterbore` (bore diameter, bore depth, hole diameter, total depth) and
`countersink` (sink diameter, sink angle) on an existing `hole` feature.
Out: multi-tool fusing of overlapping bores (still the `SPEC-brep-hole.md:40` deferral),
and any case where the recess would not fit — which must refuse in a plain sentence, per
the project rule that a refusal is honest and a wrong solid is a defect.

## 6. Corrections owed to existing docs

`packages/brep-rs/AGENTS.md` claims `geom.rs` has *"analytic types first-class, NURBS
fallback"* and lists as an anti-pattern that booleans must intersect *"real analytic and
NURBS surfaces in any orientation."* `geom.rs:9` says otherwise: *"NURBS remains the
stated fallback but no…"* — the header admits it is unimplemented. There is no
`BSpline`/`NURBS` variant in `Surface`.

An anti-pattern describing unimplemented capability reads as a working guarantee to
anyone planning against it. Either implement it or correct the doc. **Until then, treat
as settled: no spline surface.** This is why loft and sweep are out of scope for now —
the reference kernel's sweep is ~2,700 lines and needs NURBS.

The dispatch specs also carry a stale `C:\Users\shuff57\…` parent path. Harmless, but it
will mislead a reader who tries to follow it.

## 7. Not being ported, and why

| Not ported | Reason |
|---|---|
| Their fillet network | 14,460 lines, of which ~70% is unreachable for a single straight edge. Reachable core (march + exact extrusion + sew + third-face restrict) is ~1,500–2,000 lines — a rewrite of our `box_extent` hack, not a port. Their primary path avoids booleans deliberately; ours does not have that luxury yet |
| Their general offset/shell pipeline | ~5,200 lines, and there is **no box shortcut** — a box runs the full pipeline. A box shell needs five offset planes, five analytic plane-plane intersections, and a trim: ~100 lines, plane math only |
| Their dependency model | Resolves dependencies by name-string matching, so a string collision becomes an edge. Our explicit `dependsOn` is more robust in intent |
| Feature pipeline inside the kernel crate | PMI, wire harness and parts library in the kernel crate is a layering smell. Our kernel/script/studio split is cleaner |
| Resident-handle wasm registry | Manual lifetime management, single-threaded. Our stateless `{doc, feature}` JSON handles are the safer contract |
| Loft, sweep, general draft | No spline surface (§6). Ship narrow and refuse the rest, per the chosen "more features, refuse the hard cases" bar |

## 8. Sequenced

**Done and verified (2026-09-29):** the coaxial wrong solid (§4.3f). Probe A, B, C, D, G all exact; E and F still refuse honestly; `cargo test --release` 245 passed / 1 failed, parity 70/2, mesh 70/2, step unchanged. Pinned by `coaxial_bores_of_differing_diameter_are_exact`.

What remains, in order:

1. **§5 — counterbore: DONE (§5.2b). Countersink: refuses honestly** until `revolve_profile`
   builds a conical wall and the soundness check can vouch for a cone. Its spike holds the
   corrected closed form (31321.416) for when it can.
2. **§4.4 — the coaxial gate fixture.** Needs the lead's claim on `scripts/brep-parity-fixtures.mjs`; a builder must not edit it.
3. Box-only shell (~100 lines, plane math), refusing the general case.
4. Loft on compatible planar sections, refusing the rest.
5. Fillet — the large one, last.

**Deferred on purpose, not merely unfinished: mode 3**, the arc-notch construction for a hole crossing an inner wire's boundary (§4.3f). Two reasons, both measured. First, it has no oracle: `y2_bench_final_exact` already passes, asserting the true closed form, so a mode-3 change could leave every check green while proving nothing. The tripwire catches errors but cannot confirm a fix. Second, the Y2 interface is two faces with complementary cut-outs — the standing cylinder's bottom cap survives with notches over the flange's holes while the flange's top cap becomes an annulus — and the current single-face result hits the right total volume by compensating error. That is a design question about which face survives, in the most intricate part of the boolean, with one guard. It should follow a study of that interface, not precede a missing feature the work actually needs.

## 9. Unreviewed change in the working tree

`packages/brep-rs/src/ops.rs` carries edits this investigation did not sanction and has
not reviewed line by line. Recorded here so it is a decision, not a surprise.

| Change | Origin | State |
|---|---|---|
| `push_edge_use_uv` helper, used by `outer_uv` and `coplanar_face_wires` so planar wires follow arcs instead of chording them | a delegated task, not requested | verified harmless: 244/1, parity 70/72, mesh 70/72 |
| `planar_face_samples` doc comment and candidate scheme rewritten to "vertex centroid, each vertex pulled 30% toward it" | same delegated task, not requested | same. Direction is defensible — the function now abstains on any wire containing an arc rather than chording it, which matches the abstain-rather-than-guess rule — but the candidate scheme is unvetted |
| Cylinder branch in `planar_face_samples` (§4.3) | this investigation | verified working: MEASURED `samples=8` on the bore wall |

The first two were kept because they are demonstrably not regressions, not because they
were reviewed. They are separable: reverting them touches only `push_edge_use_uv`, its two
call sites, and the `planar_face_samples` planar body — it does **not** require touching the
uncommitted soundness guard or the cylinder branch.
