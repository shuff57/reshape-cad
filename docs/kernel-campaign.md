# Kernel campaign ledger

One section per slice of the plan to finish brep-rs. Written at each slice
boundary by the builder session (opencode). The gate stays lead-owned; new
fixture requests and their OCCT reference numbers are recorded here rather than
edited into `scripts/brep-*.mjs`.

Definition of done for the campaign: every refusal reachable from a valid
`ModelDoc` the studio can author is either implemented or has a fixture proving
OCCT refuses it too; `name_edge` is real; history covers every op;
STEP export/import exists; all gates green.

## W0 — boolean seam weld — DONE (2026-09-15)

**Problem (FUTURE.md 2026-09-15).** `build_mixed_face` (wall arcs) and
`polar_hole_wire` (sphere hole arcs) each built their own `Rc` edge along the
same seam curve, so no SINGLE edge was used by both faces and a `between` name
on a seam could not resolve. Volume, area, bbox, face count and mesh were all
blind to it.

**Fix.** `ops::weld_shared_edges`, called from `boolean()` after
`dedupe`/`drop_degenerate_faces`: groups geometrically-equal edges (curve
equality + angular-span overlap for arcs), rewrites later uses to the canonical
handle with corrected `forward`, and welds coincident vertices.

**Tolerance finding.** The wall's clip disk is taken at the probe-offset plane
(`PROBE = 1e-6` inside the other solid) while `polar_hole_wire` uses the exact
sphere; the same corner differs by ~3.8e-7 (measured on sphere-minus-box). So
`WELD_TOL` is 1e-6: above the mesh gate's own 5e-7 vertex weld and 100x below
the parity gate's `approx` tolerance.

**Evidence.** `ops::boolean_seam_edges_are_shared_not_duplicated` — fails on
the pre-fix code by construction (duplicates existed), asserts zero duplicate
geometry and exactly 2 uses per arc seam. cargo 52/52, parity 61/0, mesh 61/61.

## W1 — edge naming (name_edge) — DONE (2026-09-15)

**W1a — `between` on named faces.** `wasm::name_edge` was a stub returning
`"null"`. It now mirrors OcctAdapter's `nameEdgeOnCurrentShape` exactly: the
edge's two adjacent faces are found by handle (`topo::same`, which W0's weld
makes correct for seams), both are named, and anything other than exactly two
faces — or a face with no name cause — returns null.

**W1b — `carried` through booleans.** `name_face` used the primitive heuristic
for EVERY feature, so a boolean's side wall named as `op1.face[+x]` (a name
that cannot resolve) and an extrude cap named as `e1.face[+z]` instead of
`e1.cap[top]`. Cause precedence is now: op record -> sweep record -> primitive.
New `carried_name` walks `face_fates` in reverse (the exact inverse of
`History::carried_face`) and answers `{cause: carried, feature: op, of: <name
of the input face>}`.

**Two pre-existing bugs found by the W1b test, both fixed:**
1. `same_surface`'s plane case used `|n·origin|`, so the +x and -x faces of a
   centered box tested "the same surface" and `carry_fate` pointed both inputs
   at one output face. Now requires component-wise equal normals. (A face
   flipped by a subtract therefore no longer matches its input — it answers
   null rather than returning the mirrored face.)
2. `resolve_face` (the helper `between` uses for its two face names) did not
   handle `carried`, only `resolve_name` did. Added.

**Evidence.** cargo 55/55; parity 61/0; mesh 61/61. Adapter wired
(`BrepRsEngineAdapter.nameEdge`) with a test in
`packages/kernel/test/brep-rs-engine-adapter.test.mjs`; kernel suite 98/98.

**Fixture request for the lead (gate never calls `name_edge` today — this is a
gate change, not just a fixture):** the gate's resolve comparison covers
`{cause: between}` names of primitives already (`name-between-edge`, fillet).
To gate W1, `scripts/brep-parity-gate.mjs` needs to call
`brep.name_edge(doc, feature, edgeIndex)` for a picked edge — e.g. on the
`boolean-sphere-minus-box` result or a box — compare against OCCT's
`nameEdgeOnCurrentShape`, then resolve on both. Proposed fixture:
`name-between-edge-after-cut`, combine subtract [box 40x40x20, cylinder r8 h40],
resolve `between` of the two carried box faces sharing the +z/+x edge.

**Design decision not pinned by any spec:** cylinder-wall faces of a boolean
have no name cause (`primitive` `side` is not implemented in brep-rs), so edges
between a carried face and a bore wall answer null rather than inventing a
`primitive side` name. Honest null over a wrong name.

## W11 — cylinder round chamfer — DONE (2026-09-15)

**Problem.** `dispatch_round_cylinder` refused `roundStyle: chamfer` in words
("Chamfering a cylinder is not supported by brep-rs yet"), so a student's
Chamfer on a cylinder silently fell back to OCCT for the session.

**OCCT reference (measured with the gate's own OCCT harness, r12 h30 rad3):**
volume **12949.644918**, 5 faces, bbox [-12,-12,-15]..[12,12,15]. Closed form
`pi*R^2*h - 2*pi*d^2*(R - d/3)` matches exactly (right-triangle ring by
Pappus), which is what makes this an analytic build, not a sampled one.

**Fix.** Each rim is a bounded 45-degree cone band between the shortened wall
(radius R at v=0) and the shrunken cap (radius R-d at v=d*sqrt(2)), with a
straight meridian seam -- the same 5-face topology as the fillet. `Cone` gained
a `v_range` field (the `TorusSurf` pattern) so the band is a real bounded
analytic surface. `mesh_torus_band` generalized to `mesh_revolution_band`,
handling the Cone arm (straight in v, so 2 rows, no v-refinement); the cone
AABB now respects `v_range` instead of always reaching the apex.

**Evidence.** cargo 57/57 (wasm + mesh tests both new); parity 61/0; mesh 61/61;
wasm 12949.644918 / 5 faces / 5 mesh ranges through the built artifact.

**Fixture request for the lead:** add `cylinder-round-chamfer` to the `round`
kind (fixture doc = the one in the test above; OCCT reference 12949.644918,
5 faces). The gate has no fixture for this today; the native test pins the
number.

## W6 — partial revolve — DONE (2026-09-15)

**Problem.** The `revolve` branch refused any angle other than 360 ("only a
360-degree revolve is supported by brep-rs yet") even though
`build::revolve_profile_partial` already existed and `groove` had used it all
along: the branch just never passed the angle through, and partial revolves
build two cap faces whose indices the naming history did not carry.

**OCCT reference (gate's own harness, annulus r10..20 h0..30):** 90° →
7068.583471 on 6 faces, bbox [0,0,0]..[20,20,30]; 180° → 14137.166941;
270° → 21205.750413. Closed form pi*(R^2-r^2)*h*(angle/360) matches all three.

**Fix.** Pass `angle` to `revolve_tool`; record `cap_bottom`/`cap_top` = the two
cap face indices for a partial sweep and `None` for a closed one
(`sweep_cap_index` already refused caps for `closed`). `resolve`'s `faceIndex`
enrichment was primitive-only, so a `cap`/`swept` name resolved to an area but
no handle — it now reports the sweep record's index for those causes too.

**Latent bug found by W6's 90-degree bbox, fixed:** in
`revolve_profile_partial`, an inward (hole) wall flips `e1` to point its normal
at the axis, which MIRRORS the frame — but the arc range stayed [0, angle], so
the hole wall sat on the opposite half of the circle (x reached -10 instead of
0). Volume is blind to this: a sector has the same volume wherever it sits, and
the only prior fixture was `groove-half` at 180°, which is mirror-symmetric.
The range is now reflected to [pi-angle, pi] with the frame, pcurves and
uv-domain together.

**Evidence.** cargo 58/58; parity 61/0; mesh 61/61 (groove re-verified, since
it shares `revolve_profile_partial`).

**Fixture request for the lead:** add `revolve-quarter` to the `revolve` kind
(same sketch as `revolve-on-xy`, angle 90; OCCT 7068.583471, 6 faces). Also
worth a groove fixture at an asymmetric angle (e.g. 90°) — the 180° one could
never catch the mirror bug.

## W4 — Body Draft (`whole: true`) — DONE (2026-09-15)

**Problem.** The branch refused every `whole` draft ("brep-rs can only draft
one face yet"). Measured against OCCT first, because its semantics turned out
to be non-obvious:

- `occt-build.ts`'s own whole branch applies the four side faces one at a time
  with handles taken from the ORIGINAL shape. OCCT rejects the two later stale
  handles -- **the app's OCCT path drafts only 2 of 4 walls** (29751.346645 for
  a 40x40x20 box at 8°, pull z, neutral -10).
- All four faces in ONE `BRepOffsetAPI_DraftAngle` drafts all four:
  **27713.378369**.
- Sequentially, re-taking each face handle from the CURRENT shape, gives the
  SAME 27713.378369 -- so the app's per-face design is right and only the
  handle source is wrong.

**The model, verified against OCCT one-op on the gate harness to ~1e-8** on all
three pull axes, both angle signs, and neutrals inside/on/below/above the box:
a cross-section at pull coordinate `u` has transverse half-extent
`h - (u - neutral) * tan(angle)`. Closed form
`∫ 4(a - t·u)² du` over the pull extent, `a = h + neutral·t`.

**Fix.** The `whole` branch builds the exact 8-corner hexahedron from that
model (`build::corner_solid`), refusing when a wall would collapse (transverse
half-extent <= 0 at either end), non-boxes, and non-finite angles, each keeping
the target and using the existing Tilting sentence.

**Evidence.** cargo 60/60; parity 61/0; mesh 61/61. References pinned in
`draft_whole_volume_faces_bbox`: neutral -10 → 27713.378369, 0 → 32052.671270,
10 → 36707.991790.

**BLOCKER FOR THE FIXTURE (lead action needed, in occt-build.ts, not brep-rs):**
a `draft-whole` gate fixture would compare brep-rs's honest 4-wall result
(27713.378369) against OCCT's own `buildDoc` output, which is the 2-wall
29751.346645 -- they would DISAGREE and the fixture would fail for the wrong
reason. `occt-build.ts`'s whole branch must re-resolve each face handle from
`cur` each iteration before that fixture is added. I did not edit it: it is the
gate's REFERENCE path, so changing it changes what parity means and belongs to
the lead. (Verified the fix shape: fresh-handle sequential == one-op ==
27713.378369.)

## V0 — visual QA harness (2026-09-15)

**Problem this closes.** Every report in this campaign has ended with "no image
input, nothing was visually inspected". Volume, bbox, face counts and
watertightness were the only lenses. This adds the missing one: a dependency-free
Node rasterizer (z-buffered shaded render) that turns `mesh_feature` output into
a PNG, plus an OCCT mode that runs the SAME rasterizer over OCCT's own
tessellation of the same doc -- the visual equivalent of the parity gate.

**Location.** Scratch script (not committed; it edits no repo file and needs no
new dependency): `%TEMP%\opencode\render.mjs`. Modes: a fixture by id, `--docs
<file.json>` for docs with no fixture (W4/W6), `--occt` for the reference view,
`--sheet out.png [kind...]` for a contact sheet with burned-in labels, `--onesided`
for an inside-out-normal check.

**What was looked at (61 fixtures + 8 custom docs, brep-rs vs OCCT):**
- Full contact sheet of all 61 fixtures: no structural anomalies.
- Full-size spot-checks of the two that looked suspicious at thumbnail scale
  (`boolean-intersect`, `pocket-G1-xy-slab`): both correct and identical to OCCT.
- Pairs rendered through the same camera/rasterizer, brep-rs vs OCCT:
  `box-round-fillet`, `boolean-sphere-minus-box`, `groove-half`,
  `boolean-nonconvex-l-minus-cylinder`, `pocket-G1-xy-slab`, `boolean-intersect`,
  `w6-revolve-quarter`, `w4-draft-whole`, `w11-cyl-chamfer`. All silhouettes and
  internal features match; pocket/groove externals match because the cuts are
  internal in both.
- One-sided render of `boolean-sphere-minus-box`: outward orientation confirmed
  visually (no black/inverted patches), corroborating the mesh gate.
- **Visual confirmation of the W4 reference defect**: OCCT's own `buildDoc` whole
  draft renders as a straight box (2 stale handles rejected) while brep-rs
  renders the 4-wall taper -- the numeric finding, seen.

**Renderer bugs found and fixed while building this (so they cannot be mistaken
for kernel defects):** (1) barycentric depth used `w1*A + w2*B` instead of
`w2*A + w1*B`, which produced structured false occlusion (green triangles
through the top face); (2) the OCCT polygon fan needed a running vertex base.

**Not a gate.** The lead's gates stay the verdict. This is an additional lens;
it asserts nothing on its own.

## S1 — sketch frames (sketch-on-a-face groundwork) — DONE (2026-09-15)

**What it adds.** `SketchFeature` gains an optional `frame: { origin, u, v }`
(model-types.ts) -- an arbitrary world frame a sketch can be laid in, used
INSTEAD of `plane`/`offset`. The three named planes are deliberately NOT
re-expressed through frames: routing xz through a u x v cross product flips its
`dir` and would change every existing doc. `sketchFrameOf()` is the single JS
resolver; `sketch_frame()` in wasm.rs and `sketchFrame()` in occt-build.ts are
its two kernel mirrors, all three agreeing on the named planes verbatim.

**Consumers rewired (additively):** brep-rs `extrude_prism`, `revolve_tool`,
the extrude/pocket branches and the blend reader; OCCT `onPlane`, `sketchWire`,
`revolveProfileFace`, and the extrude/revolve/groove/pocket branches.

**Bug avoided on the way:** the first cut of OCCT's `revolveProfileFace` added
the frame origin AND the branch translated by it -- a double offset. Reverted
to build-at-origin (the spin axis is the frame normal through the origin) with
the branch doing the one translation, matching brep-rs's `revolve_tool`.

**Evidence (cross-kernel, the property that matters):** the same four docs run
through OCCT and brep-rs agree to 6 decimals on volume, face count and bbox:

| doc | volume | faces | bbox |
|---|---|---|---|
| framed tilt-45 extrude | 12000 | 6 | [0,-8.4853,0]..[40,17.6777,26.163] |
| framed offset-origin extrude (origin [5,5,10]) | 12000 | 6 | [5,5,10]..[45,30,22] |
| framed pocket into a 60x60x20 box | 70000 | 11 | [-30,-30,-10]..[30,30,10] |
| named xz extrude (regression) | 12000 | 6 | [0,-12,0]..[40,0,25] |

Native tests: `sketch_frame_arbitrary_plane_extrudes`,
`sketch_frame_orientation_invariant_volume`. cargo 62/62, parity 61/0, mesh
61/61, OCCT ModelDoc gate 17/17.

**Not done (needs the studio, claimed by another writer):** the face PICK that
produces a frame, and the on-face sketch editor UI. S2/S3.

## W2a — two silent wrong volumes in the boring family — DONE (2026-09-16)

**What it was.** Reconnaissance for W5/W8 (counterbores) turned up two cases that
returned a WRONG SOLID with NO refusal -- the class SPEC §4.5 forbids outright,
found by comparing against closed form and OCCT rather than by any gate:

1. **Blind hole flush with a face** (box 40x40x20, hole d6 depth8 centred so the
   tool's mouth cap is coplanar with the top): brep-rs 31754.955773 vs 31773.805329
   (= 32000 - pi*9*8) on both OCCT and closed form. Error was exactly the floor
   disk's divergence term (6*pi).
2. **Through + second blind hole, flush or not** (d6 through + d6 depth8 at
   [14,0,0]): 31283.716875 vs 31208.318651.

**Root causes, both in the coplanar path only:**
- `flip_planar` rebuilt the flipped face from its vertex RING; a disk cap's wire
  is one closed circle, so the ring is a single point -> zero area ->
  `drop_degenerate_faces` deleted the tool's FLOOR silently. `flip_face` already
  documented this exact collapse for the enclosed-cavity path; `flip_planar` had
  the same bug with no comment. Fixed: keep the original wires, reverse only the
  plane normal (one line of geometry, matching `flip_face`).
- `keep_disk`'s region-membership slack was `1e-6`, EXACTLY the probe offset
  `PROBE`. For a face coplanar with a face of the other solid, the probe sits
  exactly PROBE past it, its half-plane evaluates to +PROBE, and the cap read as
  "inside" -- a spurious zero-thickness cap kept on the opening. Fixed with
  `REGION_EPS = 1e-9`, strictly below PROBE so a coincidence classifies as
  outside (which is what "on the base's boundary" means).

**Evidence.** New native test `blind_hole_flush_with_face_is_exact` (top and
bottom flush; volume within 1e-6 relative, exactly 8 faces). Cross-kernel
verification through the gate harness: brep-rs and OCCT agree to 6 decimals and
match face-for-face on all four of flush-top (31773.805329, 8), flush-bottom
(31773.805329, 8), interior (31773.805329, 9), through (31434.513322, 7). Visual
pair renders (brep-rs vs OCCT, clipped) show the floor present in both. cargo
63/63, parity 61/0, mesh 61/61, OCCT ModelDoc gate 17/17, npm run build clean.

**Still open, measured and NOT fixed (needs its own slice):**
- **Multiple corner bores, flush**: 4 corner holes at dx15 dy10 flush with the
  top give brep-rs 31038.672648 vs OCCT/closed form 31095.221316 (one floor
  lost). Cause is deeper than W2a: `region_inside` treats an existing bore in
  the base as solid material for the membership of the NEXT tool's cap (the
  region algebra is an intersection of half-planes/disks and has no notion of a
  SUBTRACTED void in `other`), so a cap spanning a prior bore reads as partly
  outside. That is the same "general trimmed-face membership" gap W5 targets.
- **Counterbores refuse**: d6 through + any second bore cut into the result
  (d10 through, d10 blind, offset d6/d6) -> "brep-rs cannot cut this hole yet".
  OCCT: 30429.203673 / 31032.389463 / 30992.925928. W8.

**Fixture request for the lead:** add `hole-blind-flush-top` (the W2a test doc;
OCCT 31773.805329, 8 faces) to the `hole` kind. It pins the silent-wrong-volume
class the gate could not see. The corner-bore and counterbore cases are NOT
ready for fixtures -- they still differ/refuse.

## Closeout map — what is left, 2026-09-17

A read-only survey, not a slice: no code was built and no gate was run (see
"Verification note" at the end). Written because the remaining scope was spread
across nine slice reports, `.msgbox/FUTURE.md` and the spec, and no single place
said what is left.

### Measured against this campaign's own definition of done

The header states five clauses. Where each one stands, read from source today:

1. **"every refusal reachable from a valid `ModelDoc` is implemented or has a
   fixture proving OCCT refuses it too" — NOT met.** Eighteen distinct
   capability refusals remain in `wasm.rs`, across 23 sites (blend repeats one
   message 3 times, the draft side-wall one 4 times). Sixteen are real feature
   gaps and OCCT builds the cases behind most of them; the other two are the
   unknown-`kind` fallback (:1501, unreachable while all 20 kinds dispatch) and
   the tessellation error (:1572). They are grouped by slice below.
2. **"`name_edge` is real" — met in code, ungated.** W1 built it and the adapter
   is wired, but the parity gate calls only `measure_doc`, `resolve` and
   `version`: NEITHER `name_edge` NOR `name_face` is ever called, so the whole
   naming surface is held by native tests alone. (`resolve` does cover
   `between` names, which is why naming regressions have been caught at all.)
   The gate change W1 asked for is still outstanding, and it is a gate change
   rather than a fixture — the one item here the builder cannot do.
3. **"history covers every op" — NOT met.** Verified by reading every dispatch
   arm: `OpRecord` is constructed at exactly two sites, `move` (`OpKind::Transform`,
   wasm.rs:463) and `combine` (`OpKind::Boolean`, wasm.rs:1005), plus
   `SweepRecord` for `extrude` (:607, :631) and `revolve` (:839).
   `OpKind::Fillet` and `OpKind::Shell` are declared in history.rs and never
   constructed. So mirror, pattern, pocket, groove, hole, shell and fillet
   record no history at all, and a name cannot be carried through any of them.
4. **"STEP export/import exists" — NOT met.** `step.rs` is four lines and a
   `placeholder()`. Both directions are in spec §3 scope.
5. **"all gates green" — last recorded green at W2a (2026-09-16):** cargo 63/63,
   parity 61/0, mesh 61/61, OCCT ModelDoc 17/17. Not re-run since.

Size is the one clause already won outright: ~122 KB gzipped against the
7,250,252-byte OCCT target (§8 decision 3), a ~59x margin.

### The 3D remainder, in dependency order

**W5 — general surface-surface intersection. The keystone.** `ops::boolean` is
face-by-face special casing over plane, cylinder and sphere plus an
enclosed-cavity path; there is no general trimmed-face membership. Four other
slices bottom out here:

- **W8, counterbores / overlapping bores** (wasm.rs:770, :794). Drill then widen
  is student-reachable and refuses. OCCT builds all three probed variants:
  30429.203673 / 31032.389463 / 30992.925928.
- **The one silent wrong volume still open** — four corner bores flush with the
  top: 31038.672648 against OCCT and closed form 31095.221316, one floor lost,
  no refusal. Root cause recorded under W2a: `region_inside` has no notion of a
  SUBTRACTED void in `other`. This is the highest-severity item left, because
  SPEC §4.5 forbids the class outright.
- **W2, fillet width** (wasm.rs:1171, :3164). Box edges and cylinder rims work
  (round and chamfer, W11); rotated boxes and boolean results refuse. Note that
  "multiple edges" is NOT a gap: `FilletFeature.edge` is a single `TopoName`,
  and occt-build.ts fillets one named edge too.
- **W3, shell** (wasm.rs:1478, :1491). Axis-aligned boxes only, via an inner-box
  subtract. OCCT uses a general offset (`MakeThickSolidByJoin`), which needs
  real face offsetting.

**Independent of W5, can run in parallel:**

- **W9 — STEP.** Touches only `step.rs`. The one remaining spec clause with no
  dependency on anything else, and round-trip (write, read back, compare volume
  and face count) is checkable in `cargo test` without OCCT. The cheapest whole
  clause left to close.
- **History for the seven kinds that record none** -- mirror, pattern, pocket,
  groove, hole, shell, fillet (clause 3 above). Mechanical next to W5, and
  `OpKind::Fillet`/`OpKind::Shell` already exist as variants waiting to be
  constructed.
- **Draft on non-boxes** (wasm.rs:1213, :1292-:1330). W4 closed `whole` for
  axis-aligned boxes exactly. **Blocked on a lead-owned file, not on brep-rs:**
  see the W4 entry -- `occt-build.ts`'s whole branch takes face handles from the
  original shape, so two go stale and it drafts 2 of 4 walls (29751.346645 vs
  the correct 27713.378369). A `draft-whole` fixture would fail against a wrong
  reference. Re-resolving each handle from `cur` is the fix; it changes what
  parity means, so it stays the lead's call.
- **Blend/loft** (wasm.rs:878, :883, :901). Two matching straight outlines with
  planar sides. Twisted, non-similar, rounded and circle lofts need ruled or
  NURBS surfaces -- the geometry §4.3 promises and nothing has needed yet.
- **Slanted profile segments in revolve and groove** (wasm.rs:817, :926). Only
  profiles parallel or perpendicular to the axis. W6 closed partial angles.
- **Mirror and pattern with overlapping copies** (wasm.rs:1048, :1125). These
  refuse rather than union, which is a boolean call, not new geometry.

### The 2D remainder

Not previously covered in this ledger. There is no Rust 2D kernel: 2D lives in
`packages/sketch` (TypeScript -- least-squares solver, sketch-arc, sketch-outline),
with the OUTLINE layer ported into `wasm.rs` (`extruded_profile`,
`profile_corners`, `role_of`) so both kernels agree on what a sketch means.

- **Inside brep-rs.** Extrude keeps bulges as exact arcs, so a rounded corner
  extrudes to a real partial cylinder. Revolve, groove and blend read straight
  segments only -- that is the 2D-shaped gap on the Rust side, and it is the
  same item as "slanted profile segments" above.
- **The solver is the larger 2D gap.** `solveSketch` takes `Point[]`: corners
  are the only unknowns. All eleven constraint kinds are straight-edge or corner
  rules. No radius, tangent, concentric or point-on-object is expressible,
  because a curve is a bulge rebuilt AFTER the solve -- the solver never holds a
  radius or a centre. `.msgbox/FUTURE.md` (2026-09-08) sizes promoting bulge to a
  solved unknown as a P1a-scale change. It is a solver-architecture slice, not a
  kernel one.
- **Sketch model limits.** One closed loop of design points plus
  rounds/chamfers/bulges, or the `shape: 'circle'` tag. No open profiles, no
  inner loops (a hole drawn inside a profile), no ellipse or spline entities.
- **Sketch-on-a-face.** S1 landed the `frame` plumbing, with `sketchFrameOf`,
  `sketch_frame` and `sketchFrame` agreeing verbatim on the named planes. S2/S3
  -- the face PICK that produces a frame, and the on-face sketch editor -- are
  not built and were claimed by another writer.

### Fixture requests outstanding, consolidated

Five slices each ended with a request and none are in the gate yet. Gathered
here so they can be actioned in one pass; all numbers are this ledger's own
OCCT measurements:

| fixture | kind | OCCT reference | asked by | blocked? |
|---|---|---|---|---|
| `cylinder-round-chamfer` | round | 12949.644918, 5 faces | W11 | no |
| `revolve-quarter` | revolve | 7068.583471, 6 faces | W6 | no |
| `hole-blind-flush-top` | hole | 31773.805329, 8 faces | W2a | no |
| `name-between-edge-after-cut` | edge | (gate must call `name_edge` first) | W1 | needs a gate change, not just a fixture |
| `draft-whole` | draft | 27713.378369 (the 4-wall answer) | W4 | yes -- occt-build.ts drafts 2 of 4 walls |

W6 also suggested a groove fixture at an asymmetric angle: the existing
`groove-half` is 180 degrees and mirror-symmetric, so it could never have caught
the frame-mirror bug W6 found.

### Verification note

This survey was written on a machine with **no Rust toolchain, no `wasm-pack`,
no npm and no `node_modules`**, and `packages/brep-rs/pkg` does not exist, so
cargo, the parity gate and the mesh gate could not be run. Everything above is
read from source or quoted from earlier slice reports, and every line number was
checked against the file today. The two checkers that are dependency-free WERE
run: `check-record.mjs` (OK, 3 rows) and `check-freecad-parity.mjs` (30/46
shipped, 5 queued, 11 refused, exit 1) -- the latter showing `docs/parity.md`
had been stale at 22/46, now corrected.
