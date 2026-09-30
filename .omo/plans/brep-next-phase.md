# brep-rs next phase: close a live wrong solid, then chamfer on boolean results, countersink, and an authorable counterbore

Drafted 2026-09-29 on `main @ 349e07b` (12 commits ahead of origin, unpushed). Revised
2026-09-30 after an Oracle review against the code (see "Review provenance" at the end).
Status: DRAFT for decision. Nothing here is started.

## Goal, in priority order

1. **Close a silent wrong solid students can reach today.** This is class (2), which
   AGENTS.md ranks above every refusal. A tool with a sphere, cone or torus face,
   subtracted from a box, can ADD volume.
2. Cut edges at the true plane, not the probe-shifted one. Every oblique trim today leaves an
   open shell.
3. Then the refusals, each already holding an oracle:
   - chamfer on a boolean result (`spike_coplanar_chamfer_on_a_boolean_result_is_exact`,
     15840);
   - countersink (`spike_countersink_cuts_a_cone_not_a_cylinder`, 31321.415987,
     OCCT-measured);
   - a counterbore a student can author: the kernel cuts it since `37c6091`, but `hole()`
     has no option for it.

Every slice ends exact or refusing in a sentence, and CLOSED (see "Exit checks").

## Where things stand (measured; corrected by the review)

- cargo 249 / 2 (the chamfer spike, and the countersink spike refusing). Parity and mesh
  70/2 with the lead's four uncommitted fixtures in the tree, failing
  `boolean-rounded-corner-cap` and `chamfer-on-boolean-result`, both as refusals. STEP
  62/0/8, gate:occt 17/0, bun kernel 36 / script 89 / studio 219.
- **The backstops have blind spots:**
  - `boolean_result_is_sound` never runs on `boolean`'s early returns: `subtract_enclosed`,
    `cylinder_pair_boolean`, `cylinder_open_hollow`.
  - Its `plain` gate skips any operand with a sphere, cone or torus face.
  - The manifold guard is `if *n != 1 && *n != 2`, so it admits once-used edges. It is not
    a closure check.
- `process_face` has Plane, Cylinder, Torus and Sphere arms, and no Cone arm. `flip_face`
  (`ops.rs`) has arms for none of Cone, Sphere or Torus: it falls through to
  `face.clone()`.
- **The W2a spike was misdiagnosed** (ledger, "W2a spike"):
  - The coplanar trims are CORRECT: z=5 comes out 320, x=10 comes out 120, y=±10 come out
    192.
  - The ledger's "correct" column (392/192/160) mixes the prism's 8 mm² cross-section into
    face areas.
  - The only fault is the dropped 45-degree bevel. `region_inside`'s Plane arm pushes a
    half-plane from the plate's top face (z=−5), which is valid only for a convex `other`,
    and the L-bracket is not convex. Against the block alone, the bevel survives at 80√2,
    and its volume term, 293.33, is exactly 15840 − 15546.67.
  - The result is an OPEN shell, with 12 open directed edges, not "closed and manifold".
- **Oblique trims crack.** Block − prism (convex, no L) measures 3840.0001 on 7 faces,
  with 10 once-used edges and `check_watertight` false. The top face's trim ends at
  x=6.000001 while the bevel's ends at 6.0. A cone's section radius comes out 10.500001 or
  10.499999 at ∓PROBE, against an exact 10.5.
- `holes()` reads only `across, apart, at, along`, yet `toScript` emits `deep:` for it. The
  regenerated `holes(b, { across: 6, apart: [20, 20], deep: 8 })` fails on re-run: "holes
  has no option called "deep"".

## Exit checks every Track K slice adds (the review's finding 4)

Volume alone cannot see an open shell. A face dropped on a plane through the origin changes
a divergence-theorem volume by zero, and the spike's open result looks plausible. So every
slice also asserts:

- **translation invariance:** |V(r) − V(r + t)| ≤ 1e-9·V for t = (37, −23, 11). Measured:
  t = (1000, 0, 0) moved the spike's open result by −4427, and moved a closed control by 0;
- **no once-used edges:** zero edges used only once after welding;
- **watertight:** `check_watertight(mesh_solid(r, 0.05))` (`ops.rs`, `mesh.rs`);
- **bbox:** the bounding box equals the closed form's.

## Track K: kernel, sequential (every slice edits `ops.rs`)

### K0a: the flip wrong solids refuse (FIRST; class 2; quick)

Measured through `wasm::build_doc` as a combine subtract. None of these refused:

| case | brep-rs | correct |
|---|---|---|
| 40³ box − sphere r5 cavity | 64523.599 | 63476.401 |
| − chamfered-cylinder cavity (cone faces) | 63583.215 | 63243.923 |
| − filleted-cylinder cavity (torus faces) | 63599.655 | 63227.483 |
| − rounded-box cavity (sphere corners) | 63585.339 | 63539.263 |
| 40×40×20 box − filleted cylinder r5 h14 at z=6, through the top face | 31253.19 | 31142.50 |
| plain-cylinder control | exact | exact |

Steps:
1. `subtract_enclosed` returns `None` when any tool face is not Plane or Cylinder.
2. The Torus arm of `process_face` refuses when `keep && reverse`.
3. Audit every other `flip_face` caller that can receive a Sphere or Cone face with
   `keep && reverse`. For each: refuse, or measure it exact.

Exit: the five cases refuse, and each is pinned as exact-or-refused with the closed forms
above. The fixture `boolean-sphere-minus-box` still passes: its sphere is `a`, so it is
never reversed. cargo and all gates are otherwise unchanged.

Later, and optional: real Cone, Sphere and Torus arms in `flip_face` and
`build::reversed_face` turn these refusals exact. For the cone arm, negate `e2`, as the
bottom band of `chamfer_cylinder` already does. The five closed forms are that change's
oracle.

### K0b: trims at the true plane; the probe only classifies (short)

Steps:
1. Evaluate the constants of non-parallel faces (`halfplane_of`) and the section radius of
   a cone (and of a sphere) at offset 0. Keep the probe for inside/outside decisions only:
   parallel-face constants and v-band membership.
2. Then count once-used edges across every boolean result in the cargo suite. If only the
   known-open cases have any, tighten the manifold guard to refuse an open shell, with the
   seam exception its own comment describes.

Exit:
- block − prism is exactly 3840 and closed: zero once-used edges, watertight;
- the cone section radius is exactly 10.5;
- `boolean-sphere-minus-box` still welds; its 3.8e-7 mismatch, the reason WELD_TOL exists,
  should shrink;
- cargo and all four gates are unchanged.

### K1: keep the bevel against a non-convex base (re-scoped; a DECISION)

The rule the first draft proposed ("a same-side coplanar tool face bounds nothing") already
holds for subtract, so it cannot make the spike pass. Applied to union, it would drop the
band `y1_box_join_exact` depends on (by reading). The real fix is a convexity fix, and that
fires the stop rule this plan set for itself: it would be the fifth convexity exception.

- **(a) Local, recommended.** Change only the general-path
  `region_inside(…, sign*PROBE)` call in `keep_polygon`, and only when `keeps_inside` is
  true:
  - build the region from the faces of `other` whose `face_reach_box` touches the face's
    box, as the cylinder arm of `process_face` already does;
  - check the result point by point with `inside_solid`, and refuse on disagreement.

  The reach filter alone is unsound; the veto is what makes this refusal-safe. Its worst
  case is an over-refusal, never a wrong solid. Do not touch `coplanar_face_wires`, the
  union rescue, or the parallel branch. Medium effort, not "a day". It unblocks K2.
- **(b) Stop.** Replace convex clamping of planar faces with arrangement plus parity:
  split the face where the faces of `other` cross its plane, then classify each cell by
  `inside_solid` at an interior point. This retires the exception list, but it does not
  reach tangency. Weeks, with regression risk.

Recommendation: (a) now. In parallel, write (b)'s design, using the five exceptions as its
requirements. Hold to the rule as written if you would rather pay for (b) first.

Exit (a):
- the spike passes: 15840, exactly 12 faces, exactly one 45-degree face. Rename it without
  `spike_`, and replace its stale `expect` text;
- the exit checks above;
- regression tests on THIS path: `flush_four_corner_bores_exact`,
  `four_disjoint_successive_cuts`, `coaxial_bores_of_differing_diameter_are_exact`,
  `counterbore_shoulder_across_a_pocket_is_never_dropped`,
  `second_cut_onto_a_boolean_result_is_exact_or_refused`, `y1_bench_final_exact`,
  `y1_box_join_exact`, and the `counterbore_*` tests in `wasm.rs`;
- parity and mesh 71/1 once the lead commits the fixture.

`successive_blind_bores…` and `through_bore_then_blind…` go through `subtract_enclosed`,
so they cannot catch a K1 regression.

### K2: chamfer any convex straight edge between two planar faces (needs K0b and K1)

Rebuild the discarded implementation the ledger describes (W2a, "The implementation that
got this far") as the fallback wherever the box path in `build_fillet` does not apply:
- outward normals from each face's `forward` flag;
- the into-face direction from the face's boundary points perpendicular to the edge;
- convexity tested with `inside_solid` one micron inside the corner;
- not the `f64::INFINITY` seeding bug.

Refuse a concave edge, a flat edge, and an end vertex on more than three faces.

Exit:
- the L-bracket's step-edge chamfer measures 15840 exact through the feature path;
- the box pins are unchanged: 31680, 31360, and 31040 + 160pi;
- the three refusals are pinned;
- the exit checks above, including a chamfer whose bevel plane passes through the origin;
- the OCCT number for the same doc, measured with a scratch referee (`occt-build.ts`
  chamfers a named edge via `BRepFilletAPI_MakeChamfer`), goes to the lead as a fixture
  request.

### K3: countersink cuts a cone (needs K0a and K0b; medium to large)

Order matters: once `revolve_profile` builds cones, cone tools reach `subtract_enclosed`,
which is K0a's bug. So K0a lands first.

1. **The frustum.** `revolve_profile` builds a slanted segment as a `Surface::Cone` face
   carrying BOTH rim circles plus the seam, as the `band_wire` of `chamfer_cylinder` does.
   `mesh_revolution_band` needs both rims on the face. With the seam alone it falls back to
   sampling at `base_radius`: 18 against 25 segments for r3/r6 at d=0.05, so one rim
   cracks (by reading).
   Exit: a frustum's volume equals pi*h/3*(R² + Rr + r²), and a revolved frustum is
   watertight.
2. **Orientation and the backstop.**
   - Cone arms in `flip_face` and `build::reversed_face`: negate `e2`.
   - A Cone arm in `crossings`.
   - A Cone arm in `planar_face_samples`: a mid-v ring of samples.
   - `plain` admits Cone.

   Exit: a CLOSED shell with the wrong half-angle is rejected by `boolean_result_is_sound`.
   Without the sampler arm, the check would pass it.
3. **The Cone arm of `process_face`.**
   - Split at planes perpendicular to the axis (the cylinder arm's v-breaks).
   - Copy the cylinder arm's distance test for parallel planes and its `face_reach_box`
     skip. Without them every countersink refuses, because a box's four side faces are
     parallel to the axis, and four corners need the skip too.
   - Give the Cone arm of `region_inside` the void-wall skip.
   - The split must narrow `v_range`, because `volume_term` and `area_centroid` ignore
     boundary wires. A cone trimmed around its circumference refuses.
   - `hole_tool` builds the real profile.
   - Measure `keep_polygon`'s `de_facto_empty` arm here (spec §5.2b): it runs only for
     faces with a circular outer wire.

   Exit:
   - the countersink spike passes with no change to its assertion;
   - variants (blind with an axial offset, along x, four corners) match an OCCT scratch
     referee to 1e-9, which holds only after K0b;
   - `degenerate_recesses_refuse` passes, and so do the exit checks above;
   - STEP export of a countersunk part refuses BY NAME (`step::face_bounds`: "a conical
     face"). Stating that here is deliberate, so nobody finds it later; exporting cones is
     its own slice (K3b).

## Track A: authoring, TypeScript only, parallel with K

- **A0:** `holes()` accepts `deep`. `toScript` already emits it, and the dead
  `extra.deep` read in `holes()` shows it was always meant to.
- **A1:** `hole()` and `holes()` accept a counterbore option, and `toScript` emits it.
  Exit: script text, then ModelDoc, then a brep-rs build equals 32000 − 342pi for d6
  through with d12x6. `toScript(runScript(src))` round-trips it, including a blind
  `holes()`. Degenerate recesses come back as refusals, not script errors.
- **A2:** the studio's hole editing gains the recess fields; that UI work goes to
  visual-engineering. Exit: studio tests, plus a real browser pass with a screenshot,
  because the brep sessions had no image input.
- **A3:** the countersink option lands WITH K3, never before it.

## Track D: docs and the lead (anytime)

- **Ledger, W2a spike.** Add a dated correction without deleting the original: the face
  table's "correct" column, "the shell is closed and manifold" (false: 12 open edges), and
  the diagnosis (non-convexity, not coplanar over-deletion).
- **Root `AGENTS.md` NOTES** still list counterbore as a refusal and say "no blind
  multi-bore fixture anywhere". The fillet/chamfer placement in `packages/brep-rs/AGENTS.md`
  is wrong (msgbox #384).
- **Lead requests,** through msgbox. Fixtures and gates are lead-owned; never edit them.
  - Commit the four fixtures, correcting two comments. First, `bores-blind-stacked` and
    `bore-through-then-blind` compose since `bfb211d` (46812.478), so "KNOWN DEFECT ... a
    GREEN HERE MEANS NOTHING" is stale. Second, `chamfer-on-boolean-result` repeats the
    wrong diagnosis and cites ops.rs:4319 and 4312, which have since moved.
  - The coaxial fixture (spec §4.4).
  - Whether `occt-build.ts` should build counterbore and countersink tools, so the gates can
    referee them. That changes what parity means, so it is the lead's call.
  - The K2 fixture, with its OCCT number.

## Decisions needed

1. **K1: (a) local with the `inside_solid` veto, or (b) stop and build arrangement plus
   parity.** Recommended: (a) now, and (b)'s design in parallel.
2. **Option names in `hole()`.** Recommended: `counterbore: { across, deep }` and
   `countersink: { across, angle }`. These reuse its student words and add no VOCABULARY
   word.
3. **After K1: K2 or K3 first.** K2 is the bigger student-visible win; K3 is independent
   of K1.

Order: K0a, then K0b, then K1, then K2 or K3. Track A (A0 first) and Track D run
alongside. Effort, from the review: K0a quick, K0b short, K1(a) medium, K3 medium to
large.

## Out of scope, named so nothing is silently dropped

Fillet on a boolean result (tangency; ledger option 3). Shell beyond axis-aligned boxes
(W3). Arc-bounded planar faces in a boolean (`boolean-rounded-corner-cap`; needs true-arc
emission). A counterbore into a pocketed part (refuses now, pinned). Mode 3 (spec §4.3f).

## Strategic note

**The convexity exceptions.** Every boolean fix from the last three sessions, and K1(a) if
chosen, is a local exception to one assumption, that `Region` is convex:

| exception | where it landed |
|---|---|
| void-wall skips | #329 |
| `subtract_enclosed`'s reach-box proof | `17ea12b` |
| `crosses_probe_plane` | `f597786` |
| WHOLE/CLEAR with a point-by-point veto | `f597786` |
| K1(a) | this plan, if chosen |

The veto pattern keeps them refusal-safe. Their cost is coverage and complexity, not
wrongness.

**The backstops need more urgent work than any new capability.** K0a and K0b exist
because the guards that were supposed to stop a wrong solid have blind spots: they skip
non-plain operands, they skip early returns, and they admit once-used edges. Closing
those gaps comes before new capability.

## Guardrails (every slice)

- **Build and test:** `export PATH="$HOME/.cargo/bin:$PATH"`, then `cargo test --release`,
  then rebuild the wasm before any gate. Run parity, mesh, step and gate:occt, and
  `bun test` per package (node is a bun shim here).
- **Referee new closed forms with OCCT before pinning them.** Both spikes this plan
  inherited counted a bore's core twice, and the W2a face table was wrong too.
- **Diff against HEAD after every structural edit.** The edit tool REPLACES its anchor
  line: `37c6091` had to restore a doc comment that an edit had eaten.
- **Housekeeping:** check msgbox owners before editing. Scratch goes under /tmp/opencode and
  is deleted when the slice ends. Each slice ends with a ledger entry.

## Review provenance

Oracle reviewed the 2026-09-29 draft read-only, measuring in a scratch copy of the crate
whose only difference from `349e07b` was appended tests.

Re-run by the planner (2026-09-30):
- finding 1: all five cases through `build_doc`;
- finding 2: the per-face areas, the dropped bevel, and the closed K1 target at 15840.0001;
- finding 3: x=6.000001 and the cone radius 10.500001;
- finding 4: translation invariance;
- finding 11: `holes()` `deep`.

Confirmed by grep: `step::face_bounds` refuses cones, and `holes()` reads options only
from its allow-list.

Taken on the review's reading, not measured: the mesh rim crack (K3 step 1), and the union
half of finding 2.
