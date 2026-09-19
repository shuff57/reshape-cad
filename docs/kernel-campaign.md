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

## W9a — STEP export — DONE (2026-09-17)

**Problem.** `step.rs` was four lines and a `placeholder()`, so of the campaign's
five definition-of-done clauses this was the only one with no code at all. It is
also the only clause that depends on nothing else, which is why it went first
rather than waiting behind W5.

**What it writes.** An AP214 `ADVANCED_BREP_SHAPE_REPRESENTATION` with real
analytic geometry: `PLANE` and `CYLINDRICAL_SURFACE`, `LINE` and `CIRCLE`,
welded `EDGE_CURVE`s, `CLOSED_SHELL`, and `MANIFOLD_SOLID_BREP` per body or
`BREP_WITH_VOIDS` when a body encloses a cavity. A faceted STEP was considered
and rejected: the tessellator is already gated and would have been far easier,
but §4.5's REJECTED note rules out shipping a faceted approximation in place of
a B-rep, and the extension on the file does not change that.

**Refuses, in plain words:** conical, spherical and toroidal faces (6 of the 61
fixtures: `cone`, `sphere`, `torus`, `box-round-fillet`, `cylinder-round-fillet`,
`boolean-sphere-minus-box`), a cylindrical face with a hole in it, a planar wire
that is not a closed chain, and a shape with several bodies AND cavities at once
(which body a cavity sits in is a containment question this does not answer, and
guessing it would hand back a wrong solid). The whole solid is refused, never
part of it.

**THE VERIFICATION IS OCCT, NOT A ROUND TRIP.** A writer that only round-trips
through its own reader proves nothing about the format. The bundled OCCT wasm
binds `STEPControl_Reader`, so every written file is read back by a FOREIGN
kernel and compared against `measure_doc` for the same feature: volume and bbox
to 1e-6 relative, face count exactly, and `BRepCheck_Analyzer` must call the
shape valid. **55 of 61 fixtures written, all 55 pass; 6 refused.**

**Five defects OCCT found that no self-round-trip could have:**
1. **Complex entity part order.** `( NAMED_UNIT(*) LENGTH_UNIT(*) SI_UNIT(...) )`
   must be alphabetical, `( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(...) )`, and only
   the supertype whose attribute is redeclared takes `*`. Wrong order threw NO
   error: OCCT failed to bind the length unit, fell back to METRE, and every
   solid came back 1e9 times too big.
2. **Loop winding.** A loop is counterclockwise in the SURFACE's parameter
   space, and the face's `same_sense` together with the bound's own orientation
   flag carry any flip -- OCCT's invariant in all three of its own files read
   while writing this. Turning a bore's loop round instead was rejected by
   `BRepCheck` on 12 fixtures at once.
3. **Cylinder loops cannot be translated from the face's wire.** A rim is a full
   circle, so a wire of [rim, seam, rim, seam] passes any point-continuity test
   however each rim is recorded, and the kernel does not keep them consistent
   because nothing that measures a cylinder reads them. `boolean-union` had both
   rims turning the same way: closed in space, wound TWICE in parameter space,
   rebuilt by OCCT as one edge of two full turns, 2608.37 of volume gone.
   Cylindrical boundaries are now synthesised from `vmin`/`vmax`/`arc` -- the
   same fields the kernel's own volume integral uses.
4. **Who fixes a rim's seam vertex.** A closed circle's vertex is arbitrary on
   its own (a cap's hole bound is one circle and joins nothing) but a wall
   chains that circle to a seam ruling and the two must meet. Writing the cap
   first put a bore's rim vertex 90 degrees from its own seam and left the wire
   disconnected -- valid edges, invalid wire. Chained faces are written first.
5. **Welding is per SHELL, not per solid.** `mirror` leaves two boxes meeting at
   x=20; welding by geometry across them merged 4 edges and 4 vertices into one
   non-manifold shell, which OCCT took apart again into 13 faces and 3 shells
   for a 12-face 2-body shape. The kernel's own shell list is the authority on
   which faces form a body.

**Evidence.** cargo 68/68 (was 63: five new tests in `step.rs`); parity 61/0;
mesh 61/61; OCCT ModelDoc 17/17; kernel JS suite 98/98; `tsc` clean on all five
packages. Cross-kernel STEP check 55/55 as above. New wasm export
`export_step(doc_json, feature_id) -> {"step": ...} | {"error": ...}`; the three
gate-contract exports (§4.7) are untouched.

**NOT done, and the clause is only half closed: STEP IMPORT.** Export was the
half worth having first -- it is what a student sending a part to a printer
needs -- but §3 asks for both. Import is a separate slice with a hazard of its
own: the trim of a face lives on the SURFACE here (`SphereSurf::trim`,
`Cylinder::arc`), while in STEP it lives in the loops, and the boolean-carved
sphere trim cannot be recovered from loops at all. An importer must therefore
REFUSE what it cannot represent exactly rather than rebuild a face whose area
and volume then measure wrong -- the silent-wrong-volume class of W2a. Do not
start it without that rule.

**Also not done:** cone, sphere and torus surfaces. Each needs degenerate
topology (an apex, two poles, or a doubly-closed surface) which is where STEP
writers usually go wrong, and each should be added against the OCCT read-back
one at a time.

**Fixture request for the lead:** none. This needs a GATE, not a fixture --
`scripts/brep-parity-gate.mjs` cannot see `export_step` at all. The harness used
here is a scratch script (`/tmp/opencode/step-parity.mjs`, uncommitted, in V0's
tradition): for each fixture it calls `export_step`, reads the file with
`STEPControl_Reader`, and compares against `measure_doc` plus
`BRepCheck_Analyzer`. Promoting that into a lead-owned `brep-step-gate.mjs`
would make this a real gate; until then W9a is held by native tests and a
scratch harness only.

## W9b — STEP import, the planar half — DONE (2026-09-17)

**Problem.** W9a left the §3 clause half met: export was real and gated, import
was untouched. W9a's own entry recorded the hazard to design for first -- a
face's trim lives on the SURFACE in this kernel and in the LOOPS in STEP, so an
importer that rebuilds a face whose trim it guessed produces the
silent-wrong-volume class §4.5 forbids.

**The oracle came first, and it is not our own writer.** A reader tested against
files its own writer produced proves nothing. `/tmp/opencode/occt-corpus.mjs`
writes an OCCT-authored `.step` for all 61 parity fixtures with
`STEPControl_Writer` and records OCCT's own measurement of each in `index.json`.
That pair -- foreign file plus trusted number -- is what the importer is judged
against. 61 written, 0 skipped; one fixture (`bowed-edge`) shows a 1e-11 wobble
on an exact-zero bbox coordinate with volume identical to 12 digits, which is
b-spline bbox noise rather than OCCT disagreeing with itself.

**What it reads.** One `MANIFOLD_SOLID_BREP` whose every face is a `PLANE`
bounded by straight edges. **23 of the 61 OCCT files import and measure within
1e-6 relative of OCCT's own volume, with bbox to 1e-6 and face count exact. The
other 38 refuse, each naming its cause.**

**Why that boundary and not a wider one.** The kernel measures the two halves
differently, and only one half is recoverable from a STEP file. A planar face is
measured FROM ITS WIRES (`build::face_edges` feeds every boundary wire to
`geom::planar_measure`, exact for arcs by Green's theorem), so it is exactly
recoverable. A curved face is measured FROM SURFACE TRIM FIELDS -- a cylinder's
`vmin`/`vmax`/`arc` -- that the loops alone do not determine, and the wires are
never consulted. Guessing them is precisely the W2a failure class. Cylindrical
faces and the circular edges that come with them therefore refuse in plain
words and get their own slice.

**Three refusals that no other check could make.** An adversarial review built a
scratch crate and MEASURED each attack rather than reasoning about it:
1. **Units.** An inch file read as millimetres is wrong by 16387x while staying
   positive, finite, closed and self-consistent. `step.rs:772` records the same
   hole read the other way -- OCCT failed to bind a unit, fell back to METRE,
   and every solid came back 1e9 times too big with no error anywhere. A file
   with no unit context is refused rather than defaulted.
2. **Placement.** An ignored `ITEM_DEFINED_TRANSFORMATION` yields a correctly
   shaped solid in the WRONG PLACE with an exactly correct volume.
3. **Face orientation.** One inverted planar face on a 100^3 box measures
   666666.667 against 1000000, with a bit-identical bbox. Worse, on a box with
   its CORNER AT THE ORIGIN, flipping three of its six faces changes NOTHING --
   `area * dot(n, centroid)` is zero for any plane through the origin whichever
   way `n` points. So the normal derived from `same_sense` is cross-checked
   against the outer loop's own signed area, and a disagreement refuses rather
   than picking a winner. The final positive-volume check is kept because it is
   free, but it caught exactly one of eight measured attacks and is not a net.

**The defect the corpus found that self-round-trip could not.**
`FACE_BOUND.orientation` reverses the LOOP; `ADVANCED_FACE.same_sense` reverses
the SURFACE; the two COMPOSE. Reading only `same_sense` refused all 61 OCCT
files -- while our own writer's output round-tripped perfectly, because a built
solid has `face.forward = true`, so `step.rs` writes `.T.` on both flags and
never exercises the difference. Same lesson as W9a's five defects, from the
opposite direction.

**Also learned the expensive way.** `SURFACE_CURVE`/`SEAM_CURVE`/`TRIMMED_CURVE`
must be unwrapped to their basis curve BEFORE classifying, or every cylinder
OCCT has ever written is refused on its seam. `BREP_WITH_VOIDS` must be tested
BEFORE the root count, because `groove-full` carries a void and ZERO manifold
roots. And STEP's typed parameters are real in every file
(`LENGTH_MEASURE(1.E-07)`), so a value type with no slot for them cannot parse
the corpus at all.

**Refuses, in plain words:** a cylindrical, conical, spherical, toroidal or
b-spline face; a circular, elliptical or b-spline edge; a `VERTEX_LOOP` bound;
a length unit that is not millimetres; a placement transformation; an enclosed
void; anything but exactly one solid; a face whose outer bound disagrees with
its normal; a shell whose edge is not used exactly twice in opposite
directions; and a result whose volume is not positive.

**Evidence.** cargo 103/103 (was 84). With `STEP_CORPUS` set, the census in
`step_in.rs` asserts the EXACT 23/38 split as well as the numbers, so a fixture
that imports when it should refuse cannot pass as green. Export gate 55/0/6,
parity 61/0, mesh 61/61, ModelDoc 17/17, kernel JS 98/98. New wasm export
`measure_step(text)` returns one entry of `measure_doc`'s shape map, so an
imported solid is measurable exactly like a built one. `step.rs` gains
`pub(crate)` on `Seg` and `planar_signed_area`; visibility only.

**NOT done.** Cylindrical faces and circular edges (18 corpus files wait on
exactly that, plus 3 whose refusal currently names "cylindrical" where the end
state should name spherical or toroidal). `BREP_WITH_VOIDS` (10 files) needs the
`ORIENTED_CLOSED_SHELL` flag handled, or an unreversed void shell ADDS its
volume instead of subtracting. Assembly placements (3 files).
`/tmp/opencode/step-import-parity.mjs` still asserts the end-state 41/20 and so
exits 1 listing the 21 remaining: that is deliberate, it is an honest progress
meter and goes green only when import is finished.

**Fixture request for the lead:** none. Like W9a this needs a GATE rather than a
fixture -- promoting `step-import-parity.mjs` alongside `brep-step-gate.mjs`
once the cylinder slice lands would close both halves of §3 under one roof.

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
4. **"STEP export/import exists" — BOTH HALVES STARTED, neither complete
   (W9a + W9b, 2026-09-17).** Export is real and verified against OCCT's own
   reader on 55 of 61 fixtures, with cone, sphere and torus refused. Import now
   reads planar solids and is verified against 61 OCCT-AUTHORED files: 23
   import and measure within 1e-6 of OCCT's own numbers, 38 refuse by name.
   What is left on the import side is cylindrical faces and circular edges (18
   files), BREP_WITH_VOIDS (10) and assembly placements (3). See W9b.
5. **"all gates green" — YES, re-run 2026-09-17:** cargo 68/68, parity 61/0,
   mesh 61/61, OCCT ModelDoc 17/17, kernel JS 98/98, `tsc` clean. One
   pre-existing failure in `packages/script` (101 tests, 1 fail) is an artifact
   of running the suites under `bun` rather than node: bun's JSC writes
   "Cannot access 'box' before initialization." with a trailing period, and
   `reshape-script.ts:308` anchors its TDZ regex on `initialization$`. It passes
   on real node; nothing was changed to accommodate it.

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

- **W9 — STEP.** Export DONE (W9a) and now GATED: `scripts/brep-step-gate.mjs`
  runs the cross-kernel check the lead asked for, 55 pass / 6 refuse. Import's
  planar half is DONE (W9b). What is left is cylindrical faces and circular
  edges on the import side, BREP_WITH_VOIDS and assembly placements, the
  cone/sphere/torus surfaces on the export side, and promoting
  `/tmp/opencode/step-import-parity.mjs` into a second lead-owned gate. Still
  independent of W5.
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

Not previously covered in this ledger.

> **Corrected 2026-09-19.** Two claims below have gone false since, and the
> `wasm.rs:NNN` references throughout this Closeout map have drifted. Both are
> recorded rather than silently patched: a dated survey's worth is that it says
> what was believed on its date.
>
> - *"There is no Rust 2D kernel"* was true when written on 09-17 and stopped
>   being true about twenty-five hours later. `6369cee` (2026-09-18 14:03, "2D
>   sketch layer -- constraint solver, diagnosis, wires, warm seam") added
>   `packages/brep-rs/src/sketch/` -- ten files, 7372 lines with their tests as
>   it landed, 8034 today -- and no entry here records its arrival. One bullet
>   below is wrong as a consequence; a second died later, in this campaign's own
>   washer slice. Both are marked.
> - **Do not trust a line number in this map; grep the sentence.** The sites
>   cited above moved as `wasm.rs` grew after 09-17. Spot checked: revolve's
>   slanted-profile refusal is at :973, not :817, and groove's at :1082, not
>   :926 -- while :817 now lands on the annular-pocket refusal the washer slice
>   added, a DIFFERENT refusal that reads plausibly at the old address.

2D ships as two models, not one:

- **The classic outline** -- `packages/sketch` (TypeScript least-squares
  `solveSketch`, sketch-arc, sketch-outline), with the OUTLINE layer ported
  into `wasm.rs` (`extruded_profile`, `profile_corners`, `role_of`) so both
  kernels agree on what a sketch means. Still the path `packages/script` takes
  (`reshape-script.ts:951`, `model-codegen.ts:545`, `solveSketchDrag`).
- **The soup sketch** -- geometry rows plus rules, solved in Rust by
  `sketch::SketchSession` (`open`/`solve`/`diagnose`/`profile`) over
  Levenberg-Marquardt in More's formulation, with hand-written analytic
  derivatives checked against central differences on every free column, to 1e-6
  relative with the denominator floored at 1 (`sketch/fd.rs:737` -- a purely
  relative test would demand 1e-6 of two numbers that are both rounding noise).
  `SketchCanvas2D` drives it through `SketchSession2D`, and since `2b19a05` it
  is the studio's only sketch editor; a legacy points-only sketch migrates to
  soup rows on open.

- **Inside brep-rs.** Extrude keeps bulges as exact arcs, so a rounded corner
  extrudes to a real partial cylinder. Revolve, groove and blend read straight
  segments only -- that is the 2D-shaped gap on the Rust side, and it is the
  same item as "slanted profile segments" above.
- **"The solver is the larger 2D gap" -- FALSE since `6369cee`.** It holds for
  `solveSketch`, which does take `Point[]`: corners are its only unknowns, and
  all eleven of its kinds are straight-edge or corner rules. It never held for
  the Rust solver, which holds exactly what the bullet said nothing here did.
  `Geo::Circle { c, r }` and `Geo::Arc { c, r, a, b, sense }` put a centre and
  a radius into the parameter vector as free columns
  (`ParamBlock::radius_slot`), so a curve is a solved unknown rather than a
  bulge rebuilt AFTER the solve; and of the four rules the bullet called
  inexpressible, three are first-class `ConstraintKind` variants -- `Radius`,
  `Tangent` and `PointOnObject`, alongside `Diameter`, sixteen kinds in all.
  Concentric is the fourth and still has no kind of its own.
  `.msgbox/FUTURE.md` (2026-09-08) sizes promoting bulge to a solved unknown as
  a P1a-scale change; that stays open for the CLASSIC model only.
- **Sketch model limits -- "no inner loops (a hole drawn inside a profile)" is
  FALSE since `82ec736`** (the washer slice at the end of this file). The rest
  of the bullet stands. Classic: one closed loop of design points plus
  rounds/chamfers/bulges, or the `shape: 'circle'` tag. Soup: `point`, `line`,
  `circle` and `arc` rows, an outline carrying any number of holes, nested one
  level deep -- a plug inside a bore is a second solid and refuses. Neither
  model has open profiles, ellipses or splines.
- **Sketch-on-a-face.** S1 landed the `frame` plumbing, with `sketchFrameOf`,
  `sketch_frame` and `sketchFrame` agreeing verbatim on the named planes. S2/S3
  -- the face PICK that produces a frame, and the on-face sketch editor -- are
  not built and were claimed by another writer.

### Fixture requests outstanding, consolidated

Six slices each ended with a request and none are in the gate yet. Gathered
here so they can be actioned in one pass; all numbers are this ledger's own
OCCT measurements:

| fixture | kind | OCCT reference | asked by | blocked? |
|---|---|---|---|---|
| `cylinder-round-chamfer` | round | 12949.644918, 5 faces | W11 | no |
| `revolve-quarter` | revolve | 7068.583471, 6 faces | W6 | no |
| `hole-blind-flush-top` | hole | 31773.805329, 8 faces | W2a | no |
| `name-between-edge-after-cut` | edge | (gate must call `name_edge` first) | W1 | needs a gate change, not just a fixture |
| `draft-whole` | draft | 27713.378369 (the 4-wall answer) | W4 | yes -- occt-build.ts drafts 2 of 4 walls |
| `washer-extrude-bore` | hole (cross-construction) | 11057.522204, 7 faces | washers | no -- rows spelled out below |

W6 also suggested a groove fixture at an asymmetric angle: the existing
`groove-half` is 180 degrees and mirror-symmetric, so it could never have caught
the frame-mirror bug W6 found.

### Verification note

The survey above was first written with **no toolchain on the machine at all**,
from source alone. The toolchain was then installed and every claim that a gate
could check was checked; W9a was built and verified on the same setup. What it
took, recorded because the machine has no C compiler and no root:

- `rustup` (minimal profile) warns `no default linker (cc) found` and cannot
  link a native test binary. `gcc` and `glibc-devel` are not installed and
  `sudo` wants a password, but `dnf download` needs neither -- the rpms extract
  into a scratch prefix with `rpm2archive`, and a three-line `cc` shim passing
  `-B` at that prefix links fine. Fedora's `libc.so` is a linker script naming
  `/usr/lib64/libc_nonshared.a` by absolute path, so that one line needs
  repointing at the extracted copy.
- `npm` does not exist and `node` is a `bun` shim. `bun install` populates
  `node_modules` (including `replicad-opencascadejs`), `node_modules/.bin/tsc`
  builds the five packages in the root script's order, and all four gates run
  under bun unchanged. The JS test suites need `bun test` rather than
  `node --test`, which bun's shim does not implement.

The two dependency-free checkers were run first and still pass:
`check-record.mjs` (OK, 3 rows) and `check-freecad-parity.mjs` (30/46 shipped,
5 queued, 11 refused, exit 1) -- the latter showing `docs/parity.md` had been
stale at 22/46, now corrected.

## Multi-loop profiles (soup washers) + three shipped bugs found alongside — DONE (2026-09-18/19)

**Target.** SPEC-sketcher2 §8.2's refusal 7: a soup sketch with a hole through
its outline (rect + inner circle -- a washer) refused wire discovery outright.
`Face.boundary: Vec<WireRef<C>>` already supported holes as extra wires; nothing
walked a disjoint second loop into one.

**Fix, kernel side.** `sketch::wires::discover_wires` gains `LoopRole` and
`WireLoop`: each connected component of the half-edge planar subdivision yields
one CCW loop (a rim and a bore are two SEPARATE components, not one two-loop
face, so signed area cannot tell outer from hole -- containment can). Analytic
`point_in_loop` (v-monotone arc splitting, not sampled) classifies the
largest-area loop as the outline and tests every other loop for containment;
anything not cleanly inside (a hair poking outside, two overlapping holes, an
island inside a hole) still refuses, now by the more specific reason. New
tests: `washer_rect_and_circle_discovers_two_loops`,
`island_in_hole_refuses`, `circle_hole_poking_outside_refuses`,
`two_overlapping_circle_holes_refuse`, among others.

**Fix, build side.** `build::extrude_profile_loops` walks N loops (outer +
holes) into one multi-wire `Face`; `make_face_multi` replaces the single-wire
`make_face` internals (which now delegates to it, all 43 call sites
untouched). `wasm.rs`'s `soup_profile`/`extruded_profile`/`extrude_prism`
widen to carry loops end to end. An annular POCKET (cut, not extrude) still
refuses by name -- `ops::boolean` returns `None` on an annular tool -- rather
than silently dropping the hole: *"pocket {id}: sketch {target} has {what}
through its outline, and brep-rs cannot cut a pocket with an annular tool
yet"*.

**Evidence.** `soup_washer_extrudes`: a 40x25 plate, 10mm bore, height 12 --
`(1000 - 25*pi) * 12` = **11057.522204 mm³**, 8 faces (4 plate walls + 2 bore
walls + 2 caps, each cap carrying both wires), bbox unchanged by the bore.
Adversarial hunt (`soup_washer_meshes_names_and_steps`, written after the
feature looked done, specifically to try to break the new multi-wire caps):
mesh is watertight (every edge pairs exactly twice), cap triangle count >=
8*3 (rules out a hole-blind triangulator silently ignoring the inner wire),
STEP export produces `BREP_WITH_VOIDS` with >= 8 `ADVANCED_FACE`, and
`name_face`/`name_edge` resolve correctly on a bore wall, a cap, and the
shared bore-rim edge. All passed on the first run. cargo (brep-rs) full suite
green throughout.

**Bug found alongside, fixed standalone first (per instruction: land the fix
before the feature): a concave arc wall silently signed its volume outward.**
`extrude_profile`'s `ProfileSeg::Arc` arm built the wall's `(e1, e2)` surface
frame by NEGATING both axes for a clockwise/inward arc -- a 180-degree
rotation, not the reflection the divergence-theorem integral needs, so
`cross(e1, e2)` kept the SAME sign it would have had for a convex arc. A part
with a concave arc wall (a notch cut INTO a profile, distinct from a bore)
measured **16130.899694 mm³** when the closed form and OCCT both say
**15607.300918 mm³** -- a 3.35% silent error, reachable from the shipped Slot
tool (any slot whose radius exceeds its own construction produces a concave
wall) and undetected because no existing fixture exercised a concave arc.
Fixed (`58f1bc3`) by reflecting one axis (`v_axis` negated, matching the
existing `e2`-flip precedent in `reversed_face`) and swapping the arc's own
start/span for the inward case, rather than negating both. TDD: RED captured
verbatim (`16130.899693899575` vs `15607.300918301276`) before the fix,
GREEN after, full regression clean.

**Two more bugs found by dogfooding the Slot tool while chasing the arc sign
bug, both fixed standalone:**
- **`fix(studio): the Slot tool bit notches out of its own ends` (`397ea49`).**
  `slotRows` emitted the two end-cap arcs with their endpoints in the wrong
  order, so both the canvas render and the kernel build agreed on a
  notched-rectangle shape, not a true obround -- a source-data bug, not a
  kernel/canvas disagreement. Fixed by reversing both caps' arc endpoint order
  (sense unchanged) and the four rules referencing them. New tests pin the
  drawn x-extent and assert every slot weld names two coincident points.
- **`fix(script): a param() on a soup radius made the sketch unbuildable`
  (`3b388d1`).** `geom()`'s circle/arc arms stored a bound `param()`'s NAME
  in the row instead of its resolved number, so the kernel refused the build
  and the emitter wrote `r: NaN`. Fixed by resolving through `num()` at
  authoring time, same as `rules()` already did; test 6 rewritten from the
  broken contract it had been pinning.

**Browser dogfood (SPEC §10 checklist).** Drew a 40x25 rectangle and an
8mm-radius circle in Edit-2D (PASS -- both tools work via two-click placement,
not drag, confirmed by reading `SketchCanvas2D.tsx`'s `onClick` dispatch
directly rather than assuming), Pulled to height 12, and watched a real hole
appear in the 3D viewport (PASS, confirmed three ways: analytic volume
9587.256842 mm³ = `40*25*12 - pi*8^2*12` to float precision, mesh vertices at
exactly radius 8.0 from the bore axis, and a visible dark bore opening in a
tilted screenshot -- the straight-down screenshot alone was inconclusive, an
8mm hole in a 40x25 face reads as a faint mark from directly above). One
authoring gotcha surfaced and is worth recording for whoever writes soup
sketches by hand next: `sk1.geom([...])` alone is not a closed outline --
`sk1.rules([...])` needs the four `coincident` rules tying the rectangle's
corners together, or the kernel correctly refuses with "edge 1 has a loose
end; the outline must close" even though the coordinates numerically match.
The UI's own draw tools (`onRectClick` etc.) always emit these rules; only a
hand-typed script can hit this.

**Fixture request for the lead:** `washer-extrude-bore` -- 40x25 plate, 10mm
bore, height 12. OCCT measured live via the gate's own harness at
**11057.522204 mm³, 7 faces** (parity 69/0 against brep-rs's matching number,
confirmed cross-construction since `occt-build.ts` has no soup-sketch support
of its own and cannot build a two-wire face directly -- OCCT's number was
pinned via the equivalent box+hole boolean route, then compared against
`brep-rs`'s soup washer). Not committed: `packages/brep-rs/AGENTS.md` lead-owns
`scripts/brep-parity-fixtures.mjs`. The patch is parked at
`/tmp/opencode/wave1-park/fixtures.patch` (`git apply --check` clean at HEAD),
and since `/tmp` does not survive, the row it adds, in full: a `raw` fixture
named `washer-extrude-bore` of kind `hole`, holding a `sketch` `sk1` on `xy` at
offset 0 with `points: [[0,0],[40,0],[40,25],[0,25]]`, an `extrude` `e1` of
`sk1` to `height: 12`, and a `hole` `hole1` on `e1` with `diameter: 10`,
`depth: 14`, `center: [0,0,0]`, `axis: 'z'`. It uses `points` (a CLASSIC
sketch) on purpose -- `occt-build.ts` reads only `points`, so the fixture builds
the same solid the one way OCCT can, and the soup washer is refereed against
it. One bore only: several blind bores hit the `region_inside` defect class
recorded under W2a, and `depth: 0` hangs OCCT (`AGENTS.md`).

**Coverage-shape finding:** the concave-arc sign bug is the second
silent-wrong-volume class found this campaign (after W2a's coplanar-cap
bugs) by construction/dogfooding rather than by any gate catching it. Neither
the parity gate's fixture set nor the native test suite had ever built a
profile with a concave arc segment before this session. The class is now
covered by `concave_arc_wall_volume_is_exact`; whether OTHER concave-arc call
sites (revolve, groove) share the same class is unmeasured.

**Commits:** `58f1bc3` (sign fix), `397ea49` (Slot tool), `3b388d1` (param()
fix), `bf99ba8` (multi-loop build seam), `82ec736` (multi-loop wire
discovery), `d065c27` (adversarial mesh/STEP/naming hunt).
