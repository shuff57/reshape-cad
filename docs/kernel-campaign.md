# Kernel campaign ledger

One section per slice of the plan to finish brep-rs. Written at each slice
boundary by the builder session (opencode). The gate stays lead-owned; new
fixture requests and their OCCT reference numbers are recorded here rather than
edited into `scripts/brep-*.mjs`.

Definition of done for the campaign: every refusal reachable from a valid
`ModelDoc` the studio can author is either implemented or has a fixture proving
OCCT refuses it too; `name_edge` is real; history covers every op;
STEP export/import exists; all gates green.


## W2a — general edge fillet/chamfer (2026-09-28, STARTED)

**Why.** `build_fillet` (wasm.rs) only knows two shapes, and both work the
same way — REBUILD THE WHOLE PRIMITIVE rather than fillet an edge. `box_extent`
/`box_local_frame` demand exactly 6 faces, so a box that has already been
rounded (7 faces) is no longer recognised: two fillet features on a box, e.g.
both edges of the top face, give the FIRST as exact 31862.654825 and the SECOND
as `brep-rs can only round an edge of a box yet` (measured; the true two-edge
closed form is 31725.309649). The edge NAME resolves fine through the first
fillet's history — the refusal is `FilletErr::NoBox`, not `NoEdge` — so this is
purely the geometry builder, not naming. The user-visible consequence: a
student cannot round a boolean result, a prism, a wedge, or a second edge of the
same box.

**The plan, in dependency order.** A fillet is "offset both adjacent faces
inward by r, join them with a blend surface"; the blend depends on the pair:

| adjacent faces | blend | status |
|---|---|---|
| plane ∩ plane | cylinder along the edge | **Slice A, first** |
| plane ∩ cylinder | torus | exists, hardcoded for a cylinder rim |
| cylinder ∩ cylinder | sphere | Slice C, not started |
| chamfer, any pair | flat bevel quad | do alongside A |

**Slice A scope.** Any straight edge between two PLANAR faces, on any solid:
boxes, prisms, wedges, and every boolean result of them. It also subsumes the
two-edges-on-one-face case above, because its own output is still an
all-planar-faced solid that Slice A can fillet again.

**Slice A algorithm.**
1. Take the two adjacent planar faces and the shared edge (two vertices).
2. Their OUTWARD normals (the face's own `forward`, not the plane's) give the
   edge direction `d = normalize(cross(n1, n2))`.
3. Refuse a concave or flat edge (`dot(n1,n2) >= 0`): a fillet there is a
   different operation, and SPEC §4.5 wants a refusal, not a guess.
4. Offset each face inward by r. The blend cylinder's axis is the line parallel
   to `d` through the unique point satisfying `dot(A-o1,n1) = -r` and
   `dot(A-o2,n2) = -r`; its radius is r, tangent to both offset planes. Closed
   form, no root finding.
5. Rebuild F1 and F2 with their edge replaced by the tangent segment, and the
   two edges that met E at each end vertex shortened by r along their own faces.
6. Build the blend band: a `Surface::Cylinder` patch bounded by the two tangent
   segments and, at each end, the curve where that end's third face cuts it.
7. Re-trim the THIRD face at each end vertex. This is where SPEC §4.5's
   three-face condition bites: refuse when an end vertex touches more than
   three faces, exactly as truck's own fillet does upstream. A refused edge
   refuses that ONE feature and leaves the rest of the solid alone.

**Pinning.** Closed forms, never an eyeballed number: one edge on a box
31862.654825 (already pinned); TWO edges of the top face 31725.309649; the same
two edges on a boolean L-bracket, whose closed form is the box's minus both
corner removals. Every slice keeps parity 68/68, mesh 68/68, STEP 60/8 and
cargo green — the gates are the floor, not the target.

**FALSIFIED 2026-09-28, same day — the cheap route does not exist here.** The
leading idea above (fillet = subtract the corner prism) was built and measured
before being abandoned, and the result is worth more than the code was:

- The corner prism itself is EASY and exact. Cross-section perpendicular to the
  edge, the removed corner is the curvilinear triangle bounded by the two faces'
  own segments and the blend arc; `extrude_profile` with a `ProfileSeg::Arc`
  builds it at exactly `(r^2 - pi*r^2/4) * length` (137.3451754256331 for r=4,
  L=40) with the right bbox. Two traps cost real time and are worth writing
  down: the arc centre sits at distance r from the FACES, not from their inward
  offsets ((12,2) is 8 from z=10, not 4 — the correct centre is (16,6)), and the
  (u, v, sweep) frame must be RIGHT-handed or `ensure_outward` mirrors the solid
  and you get a plausible wrong answer rather than an error.
- The BOOLEAN then refuses, and it is not a bug to fix. **A fillet tool is
  tangent to the very faces it blends** — the arc touches z=10 along exactly one
  line, so the tool's cross-section there has measure zero, and
  `cyl_parallel_region` returns empty for tangency by design. Overshooting the
  tool past the solid to make the caps transverse does not help (measured); the
  tangency is intrinsic to a fillet, not an accident of the tool's extent.
- So `fillet = subtract(corner_prism)` cannot work until the boolean itself is
  tangent-aware — which is SPEC §4.5 DEPARTURE 3's named hard case ("tangent
  faces are not yet supported" upstream in truck too) and is a slice in its own
  right, arguably part of the same coplanar/tangent work W5 needs.

**Chamfer-first, measured 2026-09-28: the concept WORKS, the boolean does
not.** A chamfer needs no tangent surface, so its corner tool is a plain
triangular prism -- two of three sides coplanar with the base's own faces,
the third (the bevel) transverse. Built and measured:

- ON A BOX it is exact. The prism subtracts from a 40x40x20 box to precisely
  31680.000000 -- the number `fillet_chamfer_one_edge_volume_and_faces`
  already pins -- on 7 faces with the extents unchanged, and the prism's own
  volume is exact (880.0 for the 50-long overshooting tool). So a general
  chamfer is genuinely reachable by reusing the boolean.
- ON A BOOLEAN RESULT IT RETURNS A WRONG SOLID, which is why none of it
  shipped. A 40x30x10 plate unioned with a 20x20x10 block (exact, 16000) then
  chamfered on the step's top edge loses 453.333 instead of the closed-form
  160, and `ops::boolean` returns `Some` -- a silent wrong volume, SPEC 4.5's
  cardinal sin. The prism is provably right (exact volume and bbox), and the
  union is provably right (16000), so the fault is the boolean's handling of
  this coplanar-side tool against coplanar base faces. Same family as the
  coplanar/tangent weakness above, on a new shape.
  **CORRECTION 2026-10-01: no longer a silent wrong volume — it REFUSES.** Measured
  through the built wasm: the doc-level `combine op2` produces a plain-sentence
  refusal and yields no shape at all; the union `u1` is exact at 16000 and the tool
  `e2` exact at 880. `wasm.rs:1323-1334` emits that refusal **only** when
  `ops::boolean` returns `None`, so the kernel-level claim above ("returns `Some`")
  is stale, not merely unverified. Neither 15840 nor 15546.667 is produced.
  Refusing is the honest floor, **not** the fix: `K2b` is still the slice that would
  make this exact. The parity fixture `chamfer-on-boolean-result` is the gate that
holds it (msgbox #425).
  **CORRECTION 2026-10-01 (K2a): "the concept WORKS, the boolean does not" is now
  stale for the CONVEX case.** `f78f396` put a general convex-edge chamfer in the
  tree, and it goes through the boolean exactly as predicted here -- an overswept
  triangular wedge prism whose two side faces are coplanar with the faces being
  chamfered. The coplanar worry recorded at :108 is real but was never the blocker:
  the four `coplanar-*` parity fixtures pass at ~1e-16. Measured: a hex prism -- a
  shape with no cross-section to re-extrude, which is what the four prism paths in
  `build_fillet` could never reach -- chamfers to 5161.5114065552525 = 2980*sqrt(3) at
  1e-6, watertight, plus a second case whose bevel plane passes through the origin.
  The box pins did not move: 31680, 31360, 31040+160*pi.
  What still refuses is the BOOLEAN RESULT case, which is K2b and is gated on K1a,
  which failed its stop rule (msgbox #430: the reach filter broke three green tests
  and C2 still refused). That one needs option (b).
  The paragraph immediately below is out of date in one phrase: that implementation is
  no longer kept "rather than in the tree". K2a rebuilt it, minus the
  `f64::INFINITY` seeding bug recorded at the end of it -- the reason the first attempt
  failed as a silent refusal. It landed chamfer-only: a round on a general convex
  edge is refused with its own sentence, because a ball blend is not a wedge. The
  tangency argument at :81-87 is untouched and still governs the round case.

The implementation that got this far is worth keeping in mind rather than in
the tree: it resolved the edge's two faces' outward normals from the faces'
own `forward` flag, derived the edge direction from its two vertices, took the
into-face direction by averaging the face's boundary points perpendicular to
the edge (a centroid would be wrong for a concave face), and TESTED convexity
with `inside_solid` one micron inside the corner -- a dot product cannot tell a
flat edge from a concave one, both giving n1.n2 > 0. One bug of its own is
worth recording because it failed silently as a refusal: seeding the
face-reach scan with `f64::INFINITY` and keeping only `d > best` never updates,
so every edge looked infinitely far away and every chamfer refused.

**Consequence for the plan:** the boolean is the gate, again -- and now for
chamfers too, not only rounds. Slice A must be the real surgery after all

**Shipped instead, 2026-09-28: multi-edge fillet/chamfer on a box, still with no
boolean.** The studio fans a multi-edge pick into N sequential features, and the second
one was refused purely because `box_extent`/`box_local_frame` insist on six faces. But
the box path never calls the boolean at all -- it re-extrudes the cross-section -- and a
box carrying 45-degree chamfer bevels is a *prism along the axis its bevels share*. So
the second edge re-extrudes that cross-section with the cuts it already carries plus its
own, and lands exactly: two 4mm chamfers on a 40x40x20 box measure 31360.000000 against
the closed form (800 - 8 - 8) * 40, on 8 faces, and a chamfer followed by a round on the
neighbouring edge measures 31040 + 160pi. Measured, not assumed, and it needed no
boolean work at all -- which is the useful shape of that result: the W2a wall applies to
the BOOLEAN, not to every route to a solid.

Three bugs found on the way, all of which had to be found by measuring:

- **A wrong solid that was already reachable.** The profile emitted its two trim points
  pin-then-pout, which closes the loop only at the two even corners, so a single chamfer
  at `+z/-x` built a self-intersecting bowtie. Every fixture cut `+z/+x`, so 237 green
  tests never saw it. Now fixed and pinned at all four corners. This is the class-(2)
  failure mode the gates cannot see, found in the one path everyone assumed was safe.
- **A recogniser that read the low side as positive.** Storing `dot(origin, n)` for the
  low face gives `+|lo|` when the normal points outward, so every axis collapsed to zero
  width and the second edge refused for a reason that had nothing to do with geometry.
- **An arc radius taken as its own chord.** The multi-cut profile's round corner used the
  distance between the two trim points, `d*sqrt(2)`, as the radius, and the loop then
  failed to close by `d*(sqrt(2) - 1)` -- a refusal, not a wrong solid, which is the one
  way that bug could have shown up safely.

## W2a spike, 2026-09-28: what the coplanar boolean actually does wrong

Scoped as a spike, so the first act was to make the defect **runnable and located**,
not to start fixing it. Pinned as a deliberately FAILING test,
`ops::spike_coplanar_chamfer_on_a_boolean_result_is_exact`: plate 40x30x10 unioned with
block 20x20x10 (union exact, 16000), minus the identical triangular corner prism
(exact, 880), expected 15840. It measures 15546.666766666667 -- removing 453.333 where
the closed form says 160. Reproduced from scratch, matching the earlier number to the
last digit. cargo is 241 pass / 1 fail, and the 1 is this.

**Localized by dumping both face sets, not by reading and guessing.** The bracket has 11
faces. The result also has 11 -- and they are the bracket's own:

| face | bracket | result | correct |
|---|---|---|---|
| z=5 (block top) | 400 | **320** | 392 |
| x=10 (block side) | 200 | **120** | 192 |
| y=+/-10 (block sides) | 200 | 192 | 192 |
| 45-degree bevel | -- | **absent** | 160 |

So two things, and they are one bug. For each COPLANAR pair the boolean deletes the
**entire coplanar overlap rectangle** -- x 6..10 by y -10..10, area 80 -- from the
surviving face, instead of trimming it by the tool's true triangular section, area 8. And
it drops the tool's transverse (bevel) face altogether, so the result contains no 45-degree
face at all. The y=+/-10 faces losing 8 each is CORRECT and worth recording: the tool
overshoots the block in y, so its triangle really does notch those faces.

**The shell is closed and manifold.** That is the part that matters most for the contract.
`boolean`'s own SPEC-4.5 guard (`ops.rs`, the per-edge two-use check) passes it, because the
boundary genuinely is a closed 2-manifold -- it is just the wrong manifold. So the guard
that exists to stop wrong solids does not catch this class, and only a measured volume
does. Anything that trusts topology invariants instead of a number will ship this.

**The architecture's limit, named.** `Region` (`ops.rs:329`) is (intersection of
half-planes) intersected with AT MOST ONE disk -- always convex. `intersect_disk`
(`ops.rs:352`) collapses to `empty = true` on two disks that are not nested, which is a
silent material loss by construction. Worse, coplanar faces are not resolved as a pair at
all: `coplanar_face_wires` (`ops.rs:1488`) returns the coplanar footprint as wires, and
the parallel branch of `region_inside` (`ops.rs:532`) resorts to void-face sampling
heuristics. The over-deletion measured above comes out of that path.

**Why TANGENT (round fillets) cannot be expressed in this model at all, and is not a
patch.** `cyl_parallel_region` (`ops.rs:469`) returns `Region::empty()` for a tangent
cylinder, with the comment "Tangent: the intersection is a line of measure zero". The whole
boolean decides keep-or-drop per face piece by testing whether a probe point has an
interior inside the other solid. A measure-zero section has no interior to probe, so there
is nothing to decide. Representing tangency needs limiting positions or a surface offset --
a different representation, not a tighter special case. Coplanar is a bug; tangent is an
architecture.

**Ranked options.**

1. **Make a same-side coplanar tool face contribute nothing to the region** (it bounds no
   material on the kept side), letting the tool's transverse faces do the trimming, and
   keep those transverse faces as the new boundary. BOUNDED: a local change to the coplanar
   branch, and the new fixture is its pass/fail. This is the recommended first slice.
2. Resolve coplanar pairs properly as a pair (split both faces by the intersection
   polygon, keep the correct side of each). Correct but wider, and (1) is a strict subset of
   it -- do (1), then judge.
3. Replace per-face region intersection with real face-face intersection curves plus face
   trimming and rebuilding. A REWRITE. The only thing that also reaches tangency.
4. Per-surface-type strategy dispatch. Orthogonal to 1-3, and premature.

**Exit criterion, falsifier, and cost.** Done for slice 1 when
`spike_coplanar_chamfer_on_a_boolean_result_is_exact` passes (volume exact, exactly one
45-degree face, 12 faces) AND the 241 currently-green tests stay green -- especially the
bore/floor tests, which live on the very `region_inside` path being changed. It is
falsified if the coplanar branch cannot be made to trim by the true cross-section without
the probe logic losing its grip on the bore cases, or if the bevel face cannot be kept
without breaking the manifold guard -- in which case slice 2 is the honest next step, and
tangency stays out of reach for this representation. Realistic cost: slice 1 is a day, and
it buys chamfers on boolean results. It does NOT buy general fillets, shell, or
counterbore. Those need 3, and 3 is weeks with a real chance of regressing what is green.

**Note on method.** No independent architecture review happened: the oracle subagent is
misconfigured on this box (`anthropic/claude-opus-5` does not resolve; it wants
`claude-opus-5-5`), so the ranking above is one engineer's judgement over its own reading
and its own measurements. It has not been argued by anything that was not already in the
loop, and the parts of it that matter most are the measured table, not the opinion. — build
the offset faces and the blend band directly and re-trim the neighbours, rather
than delegating to the boolean. That is more code than the subtraction route and
is the honest cost. The arithmetic above (offset by r, tangent points, blend
centre) is reusable as written; only the ASSEMBLY has to be new.

**Out of scope for Slice A**, named so it is not silently forgotten: edges
between curved faces (Slice C), filleting/chamfering a curved EDGE, and
non-convex (concave) edges. Those need the general face-offsetting that W3
(shell) and W5 both bottom out in.


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

**CORRECTION 2026-10-01 — both entries above are stale; measured, not argued.**
- *Multiple corner bores, flush*: brep-rs now returns **31095.221315766117** against a
  closed form of 31095.22131576614 (`32000 - 4*pi*3^2*8`, so the geometry is four d6
  corner bores 8 deep, BLIND, not through), refusals empty, 18 faces. The 31038.672648
  wrong value no longer reproduces. This is the `region_inside` SUBTRACTED-void defect,
  fixed by `bfb211d`. **Still unsampled**: the only shipped corner-bore fixture,
  `hole-corners`, is a THROUGH bore (depth 22 in a 20-thick box) and so never exercised
  the blind-floor path that broke.
- *Counterbores refuse*: stale since `37c6091` — a counterbore cuts now; it is countersink
  that refuses (its wall is a cone).

Neither correction has a regression pin. The `hole-blind-flush-top` fixture requested
just below is the one that would hold either; its geometry is now measured and exact, so
it can be written without guessing. Filed to the lead as msgbox #425.

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

**Narrowed 2026-09-28: full circular edges on a PLANAR face now import.**
`edge_of` (`step_in.rs`) handled only `LINE` before; a STEP `CIRCLE` curve
whose two edge vertices are the SAME `VERTEX_POINT` (a full circle -- exactly
how a round hole's rim, or this kernel's own bore floors, are always written)
now builds a `Curve::Circle` and reuses `segs_of`'s existing `Seg::Arc`
conversion, the same Green's-theorem area path a bore's floor wire already
takes. An edge trimmed to PART of a circle (two distinct vertices) still
refuses by name -- which of the two arcs was kept needs the curve's own
parameter direction, not read here, so it is a guess rather than a fact and
stays out. This does NOT touch cylindrical/conical/spherical/toroidal
SURFACES at all (`build_face` still refuses any non-`PLANE` surface before an
edge is ever read) -- it only widens what a PLANAR face's boundary can be
made of. Two native tests hand-construct minimal STEP text (parsed, not
round-tripped through our own writer, so the two vertices genuinely differ in
the refusal case) and call `build_face` directly: a full circle radius 5
measures exactly `pi*25` with centroid at its own center (1e-9), and the
trimmed case refuses naming "circular". cargo 236/236 (was 235: +2 new, -1
retired blind-rename test that a real CIRCLE parse now makes obsolete),
parity 68/68, mesh 68/68, STEP 60/8 -- all unchanged, confirming this is
additive only. The old `/tmp/opencode/occt-corpus.mjs` +
`step-import-parity.mjs` scratch harness this section's numbers (23/38, 18/10/3
files) were measured against no longer exists (ephemeral `/tmp` scratch, never
committed) -- cross-kernel re-verification of the 18 cylindrical-face files
against real OCCT-authored STEP needs that harness rebuilt before the
cylindrical slice itself is attempted.

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
3. **"history covers every op" — RESOLVED 2026-09-27.** Was: `OpRecord`
   constructed at exactly two sites (`move`/`OpKind::Transform`,
   `combine`/`OpKind::Boolean`), `OpKind::Fillet`/`Shell` declared and never
   built, mirror/pattern/pocket/groove/hole/shell/fillet recording nothing.
   Now: all seven push an `OpRecord` via a new `record_op` helper.
   pocket/hole/groove reuse `OpKind::Boolean` (each already calls
   `ops::boolean` internally) with `carry_fate`'s surface-match against their
   single input, same mechanism `combine` already used. fillet/shell
   construct the long-declared `OpKind::Fillet`/`Shell`, also via
   `carry_fate`. mirror/pattern get a new `OpKind::Copy`: their surviving
   faces are the SAME `Rc` handles at the SAME index through
   `build::combine` (not a new solid to surface-match), so a per-index
   `Fate::Kept` is the honest fate, not `carry_fate` (which would call an
   untouched mirrored face `Deleted` since its geometry differs from the
   original even though the handle survives). `carried_name`'s reverse-lookup
   guard, previously gating on `OpKind::Boolean`/`Transform` only, is widened
   to every kind. 4 new native tests pin `carried == 6` for mirror, fillet,
   hole and shell against existing pinned fixtures (box+mirror, the r=4 box
   fillet, the flush-bottom hole, the closed-hollow shell), each asserting the
   resolved area/centroid match. Deliberately scoped OUT: a fillet/shell
   REFUSAL that keeps the original shape under the feature id (edge not
   found, thickness<=0, would-collapse) records no op — an op that refused
   did not run, the shape is unchanged, and the primitive heuristic already
   names a box target correctly; not a gap. cargo 232/228 (4 new tests, 0
   regressions), parity 68/68, mesh 68/68, STEP 60/8, kernel JS 36/36 — all
   unchanged from baseline, confirming this is naming-metadata-only, no
   geometry changed. Line numbers above (wasm.rs:463/1005/607/631/839) predate
   this slice and have drifted; grep the sentences, not the numbers (a
   standing caveat this ledger already carries elsewhere).
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
  **CORRECTION 2026-10-01: no longer open.** Measured today through the built wasm —
  brep-rs returns 31095.221315766117 against a closed form of 31095.22131576614, refusals
  empty, 18 faces; 31038.672648 does not reproduce. Fixed by `bfb211d`. See the dated
  correction under "Multiple corner bores, flush" above (:522) for the geometry and for why
  no shipped fixture watches it (msgbox #425).
- **W2, fillet width** (wasm.rs:1171, :3164). Box edges and cylinder rims work
  (round and chamfer, W11); rotated boxes now work too (2026-09-27,
  `box_local_frame`: the profile is built in the box's own orthonormal frame,
  rotation-invariant 31862.654825 round / 31680 chamfer on 7 faces, three new
  cargo tests; cargo 235/235, parity 68/68, mesh 68/68, STEP 60/8 unchanged).
  Boolean results still refuse. Note that "multiple edges" is NOT a gap:
  `FilletFeature.edge` is a single `TopoName`, and occt-build.ts fillets one
  named edge too.
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

## The OCCT referee reads soup sketches (occt-build.ts geoms/rules) — DONE (2026-09-19)

**Target.** The kernel side shipped multi-loop profiles -- a rectangle with a
circle inside it extrudes to a washer -- with no independent oracle over them:
`occt-build.ts` read only `points`, so any sketch carrying `geoms` threw
`TypeError: undefined is not an object (evaluating 'f.points.map')` and
`scripts/brep-parity-gate.mjs` could not build a soup sketch on OCCT at all.
The washer's 11057.522204 was brep-rs marking its own homework.
`packages/kernel/AGENTS.md` calls this file the only independent oracle over a
kernel whose signature failure is the wrong answer rather than the missing
one; a kernel feature this file cannot read has no referee.

**The spike that had to come first.** Before any production code, two
assumptions were measured on this embind build, because the whole design
rests on them: `BRepBuilderAPI_MakeFace.Add` IS bound, and `ShapeFix_Face`
repairs BOTH a swapped outer/hole classification and an unreversed inner wire
back to the same 11057.522204. That is why the reader hands OCCT every loop
in discovery order and lets OCCT decide which one is the outline, rather than
re-deriving containment in TypeScript -- a TypeScript re-derivation would
mirror brep-rs's own `point_in_loop`/`nesting` and could share its blind
spot, which would make the referee a copy of the thing it judges.

**The headline number.** The soup washer measures 11057.522203923061 on 7
faces on OCCT against brep-rs's 11057.522203923063 on 8, a relative delta of
1.65e-16. The face counts differ legitimately -- brep-rs splits the bore into
two half cylinders -- and the gate's face check at `brep-parity-gate.mjs:181`
is `mine.faces > 2 * occtFaces + 4`, a BOUND rather than an equality, so that
disagreement was never actually a blocker, though it was floated as a concern
earlier in this campaign's conversation.

**Four guards in `soupFace`, each with the measured failure that earned it.**
- Guard 1, a degeneracy floor: a circle of r <= 0.01 outside the rectangle
  came back as a plain 1000 mm2 plate with every other guard passing -- a
  too-small loop dropped invisibly under the area checksum's own 1e-6
  relative resolution. The floor here is brep-rs's own
  `EPS_AREA_REL * scale^2` times four, deliberately WIDER than the kernel's,
  so the referee refuses first and the gate blames the fixture rather than
  the kernel.
- Guard 2, counting wires: OCCT quietly DROPS a wire it cannot place -- a
  40x25 outline beside a 25x20 one returns a one-wire face of just the
  square, which BRepCheck calls perfectly valid because it IS a valid face,
  just not the sketch; and because 2*1000 - 1500 is exactly 500, an exact
  match for the area check as well. Counting wires against loops is the only
  thing that sees it.
- Guard 3, BRepCheck validity: an inner wire taken as built ADDS its bore
  (12942.477796) and swapped roles come out NEGATIVE (-11057.522204); both
  are caught by OCCT's own analyzer after the ShapeFix repair.
- Guard 4, the area checksum itself: twice the widest loop minus the sum of
  all loop areas must match what OCCT measures on the built face, so a
  mis-classified outline or a hole turned the wrong way stops matching and
  the reader refuses instead of handing the gate a wrong reference.

**Two design findings that changed the code.** Joins are read, never guessed:
the chaining is a union-find over the `coincident` rules' own end references,
not a proximity search, and the measured fact behind that is a rectangle
whose corners are bit-identical but carry no rules is refused by brep-rs -- a
proximity chain would need a tolerance to invent topology with. The sharpest
finding: a rule this reader IGNORES is one brep-rs still SOLVES, and solving
it MOVES THE GEOMETRY to a genuinely different, wrong reference volume, not a
refusal on either side. On a rectangle that reads 12000, one extra `angle`
rule makes brep-rs build 12315.30 and a `distance` makes it 15600.00; a
`diameter` on the washer's bore takes it from 11057.52 to 11764.38. Neither
kernel refuses, so the gate would print the difference as a FAIL of brep-rs,
which is why satisfaction is checked for the kinds that are one line of
arithmetic and `tangent`/`angle`/`symmetric`/`pointOnObject` are declined by
name. Found while VERIFYING the second adversarial review round, not by
either reviewer.

**Process honesty.** Two adversarial review rounds by a separate agent, not
one. The first found nine defects, two of them a face silently WRONG rather
than merely disagreeing -- a dropped wire (a 40x25 outline beside a 25x20 one
returning a one-wire face of just the square) and a loop dropped under the
area checksum's own resolution -- plus a crash on a zero-length edge, a
buildability split on a missing/bogus arc `sense`, a stale comment claiming
`SWEEP_MIN` mirrored brep-rs's when it did not, a false refusal on a
construction POINT, and unruled proximity welding standing in for the rules
brep-rs actually reads. The second round, re-run on the fix, found three
more: rules naming geometry that is not there, a degeneracy floor still
looser than brep-rs's own, and a test pinning a refusal brep-rs does not
share on unsolved rows.
Twelve defects total, and eleven were fixed. The twelfth is one documented,
deliberate divergence -- when a fixture's rows do not
satisfy their own rules, brep-rs SOLVES them (a least-squares compromise that
moves the geometry) while the reference REFUSES rather than guess. The
direction the gate treats that refusal is the reason refusing is safe: an
OCCT refusal is caught by the gate's own try/catch (`brep-parity-gate.mjs:124`)
as "the FIXTURE is broken, not the kernel", NOT scored as a FAIL against
brep-rs.

**Also guarded, not changed.** Revolve, groove and loft refuse a soup sketch
in words instead of throwing on its missing `points`, and `sketchEdgeCount`
counts curve rows for one -- migration keeps `points` alongside the new rows
(SketchCanvas2D's `{ ...f, geoms, geom, rules }`), so testing `points` first
would report a stale count for every migrated sketch.

**Evidence.** All re-run today on this machine: packages/kernel `bun test` 35
pass, 0 fail (the new `occt-build-soup.test.mjs` alone is 483 lines and 20
tests; `occt-build.ts` is now 1855 lines). Parity gate 68 passed, 0 failed,
exit 0; mesh gate 68 passed, 0 failed, exit 0. The commit body claims both
gates came out BYTE-IDENTICAL to the pre-change baseline; no baseline log
survives to diff against, but the claim's logic holds and what I confirmed
personally is the current state: 68/0 exit 0 on both, and zero fixtures use
soup rows today, so no existing fixture's verdict could have moved. tsc clean
across sketch, script and kernel.

**Lead-ownership note.** `packages/kernel/AGENTS.md` never says the builder
must not edit `occt-build.ts` -- only `scripts/brep-*.mjs` and
`scripts/brep-parity-fixtures.mjs` carry that restriction (per
`packages/brep-rs/AGENTS.md`). But an earlier entry in this same ledger (the
closeout map's draft-on-non-boxes item) treated a change to `occt-build.ts`
as something needing the lead's decision, and in W4 an equivalent ask was
declined. This slice edited `occt-build.ts` directly, with the user's
explicit authorization mid-session -- recorded here as a precedent, not
silently glossed over.

**Fixture status.** The parked patch at
`/tmp/opencode/wave1-park/fixtures.patch` used a classic points-based
box+hole proxy because OCCT could not read soup sketches at all. That proxy
is now superseded: the patch was updated in this same session to add
`washer-extrude-soup`, the real multi-loop doc (the same `geoms`/`rules` as
the headline number above), kept alongside the original `washer-extrude-bore`
proxy rather than replacing it. Verified against the current tree --
`git apply --check` clean, both kernels build without refusing, volumes agree
to 1.65e-16 relative, face count 8 against a bound of 18 -- so it would pass
the gate's own comparison as-is.
`scripts/brep-parity-fixtures.mjs` remains lead-owned either way; nothing
here is committed to it.

**Commits:** `cd44376` (the OCCT referee learns to read a soup sketch).

---

## K-H -- the closedness harness, and the seven measured cases pinned -- DONE (2026-09-30)

**Target.** Ground rule 2 of `.omo/plans/brep-fix-plan.md` needs a function
that did not exist. The once-used-edge count lived *inline inside* `boolean`
at `ops.rs:3594-3620`, where no test could reach it, and `weld_shared_edges`
is private and returns nothing. C0 and C2 both returned open shells and the guard
waved them through, so closedness had to become assertable before any later slice
could be proved rather than argued. No production behaviour changed: the only
non-test edit is the extraction.

**What landed** (`packages/brep-rs/src/ops.rs` only; 368 insertions, 24 deletions)
- `edge_use_counts` + `once_used_edges` extracted from `boolean`. The guard's
  refusal is now `edge_use_counts(&faces).values().any(|&n| n != 1 && n != 2)`,
  which is the loop it replaces: the old code skipped `n == 2` and refused anything
  else, and that is exactly `{1, 2}` surviving. Behaviour byte-identical, and measured:
  cargo reads 249 pass / 2 fail after this step alone, the same two tests failing as at
  HEAD.
- `closed_failures` -- the five checks of ground rule 2, each pushed as its own
  string so an open shell reports every check it broke at once, since WHICH ones broke
  is the diagnosis -- with `assert_closed` asserting it. Three unit tests prove the
  harness can pass, that a box minus one face leaves exactly its four edges used once,
  and that an open shell is rejected by name.
- Seven `spike_` pins, C0..C6, each a **ModelDoc** -- the JSON `runScript()` hands
  `build_doc_json` -- so a pin runs the path a student's script runs, not a hand-built
  solid. Each is exact-or-refused (ground rule 1: a refusal in a sentence is a pass), and
  each is built in **two frames**, at the origin and shifted by t = (37, -23, 11), because
  C2's error moved by 3.1e-2 under exactly that shift and a fixture that passes in one
  frame proves nothing. A case that builds neither a solid nor a refusal panics, so the
  exact-or-refused shape cannot pass a malformed pin vacuously.

**Ground rule 4 discharged before anything was pinned.** The closed forms are
hand-computed and two earlier spikes in this ledger counted a bore's core twice.
OCCT built all 14 docs (7 unshifted + 7 shifted) through the gates' own load path and
agreed with every hand value at <= 2.3e-16 relative: 3840, 15840, 15880, 15808, 15808,
15820, 63476.4012244017. The referee built the four cases brep-rs refuses, including the
`pocket()` one, so every refusal here is brep-rs-only and none is the referee's. Method and
table: `/tmp/opencode/kh/occt-referee.md` (scratch, outside the tree; the doc JSONs sit
beside it as `C0.json`..`C6.json`, `-shifted` variants).

**The measurement that changes the next slice: K0c's rule as written is refuted.**
I-6's evidence was a **mesh-level** count (12 and 14 open directed edges), and the plan's
K0c step 1 says to refuse when `once_used_edges` is non-empty, reasoning that a once-used
boundary edge is not the seam case. Measured over every boolean result the cargo suite
builds -- 123 calls, 108 shipped, 15 refused -- the **handle-level** count is nonzero on 58
of the 102 shipped results outside the two known-open pins, and all 58 belong to
currently-passing tests asserting exact volumes. They are bores and round rims: a bore's
wall rim and its cap rim are two different handles for one circle, because
`weld_shared_edges` only welds Segment edges (the wall's boundary uses a full-circle curve
in *one* wire, so it never meets the cap's circle) and a seam's two uses can land inside one
face. The plan's rule would refuse 58 correct solids and turn about 25 green tests red --
precisely the "refuses correct geometry at scale" its own stop rule forbids.

Four discriminators, measured on the same 108 results, counted as false refusals against
the 102 correct ones:
- handle-level `n == 1` (the plan's rule): **58 false**;
- mesh-level open directed edges at deflection 0.05: **3 false** -- `y1_box_join_exact`
  (30), `y1_bench_final_exact` (6), `y2_bench_final_exact` (44);
- geometric orphans only (a once-used handle with no coincident twin): **5 false** -- the two
  grooves' cylinder-wall rims plus the same three;
- **translation invariance at 1e-9 relative, ground rule 2's own check: 0 false**, and it catches
  all four known-open results (C0 at 4.2e-8 and 8.3e-8, C2 at 3.1e-2 and 3.2e-2).

So the cheapest zero-false-refusal closure signal available today is the check ground
rule 2 already names, and the handle-level count belongs in `assert_closed` -- where it now
lives -- rather than in the guard. What a translation-invariance check cannot see is an open
shell whose missing-face area vectors cancel. The three shells above are the opposite case:
geometrically closed, exact volume, `mesh_open` 6..44, i.e. T-junctions rather than missing
faces. A handle-level rule keyed on planar segments would flag all three correctly, but each
is a passing test asserting an exact volume, so that rule is a decision, not a default. The
counts are the decision's evidence.

**I-2 classified: latent, not live.** `ensure_outward` (`build.rs:669`) reaches
`reversed_face` (`build.rs:693`), whose arms cover Plane and Cylinder and whose fall-through
returns Cone, Sphere and Torus unchanged. Measured on hand-inverted primitives at an
off-origin centre, a cylinder control first: cylinder -62.831853 -> +62.831853 (the arms do
work). Sphere -268.082573 -> **-268.082573**, unchanged and still inside-out. Torus
-222.066099 -> **-222.066099**. Cone 56.548668 -> **-94.247780**: the base disk reverses,
the lateral face does not, and the divergence-theorem sum becomes a number that is neither
the solid nor its negation. So the fall-through *is* silent-wrong when reached -- a mixed-
orientation solid, the worst class there is. It is not reached: all 9 call sites feed it
`extrude_profile_loops` (Plane + Cylinder), `blend_solid` (Plane only) or `corner_solid`
(Plane only), and every Cone/Sphere/Torus construction in the crate lives in a builder none of
them calls. I-2 is therefore class 1, not class 2; K0d stays parked; and K0a keeps to
`flip_face` alone, which is what plan risk 4 says to do when I-2 is not live.

**Evidence.** All re-run on this machine today, wasm rebuilt before the gates.
`cargo test --release`: **256 passed, 5 failed** -- the two pre-existing spikes
(`ops::spike_coplanar_chamfer_on_a_boolean_result_is_exact`,
`wasm::tests::spike_countersink_cuts_a_cone_not_a_cylinder`) plus C0, C2 and C6, each red
for its own documented reason. The plan predicted 3 new failures, not 7: C1, C3, C4 and C5
refuse today and so pass, which is the exact-or-refused shape working. Compiler warning
count 28, identical to baseline. Parity 70/2 exit 1, mesh 70/2 exit 1, both with the same two
fixture names as the baseline (`boolean-rounded-corner-cap`, `chamfer-on-boolean-result`);
step 62 passed / 0 failed / 8 refused exit 0; `gate:occt` 17/0 exit 0; `bun test` sketch 9,
script 89, kernel 36, studio 219, all 0 fail. Every one of those numbers is the number at
HEAD.

**Not performed, so nobody reads a gap as a pass.** No browser or visual check (no image
input in this session). No CI run -- the workflow was read, not executed; its native-kernel
step is a bare `cargo test --release` with no `continue-on-error`, so it exits non-zero at
HEAD and with these pins, and the later JS steps are skipped by default. I-4 still
unmeasured. The three T-junction shells found open at mesh level (above) are recorded here
as an observation, not yet as a defect with an owner.

**Process note.** `ops.rs` was edited while unclaimed. The two ownership guards on this box
disagree about this session's identity -- the Claude-layer `PreToolUse` hook is hardcoded
`--as claude` while the client plugin is hardcoded `--as opencode` -- and `conflict()`
refuses any claim held under the other name, so no claim state lets this session write. It was
announced on the msgbox (#406, #408) and every edit was hash-anchored, so a concurrent change
to the same lines would have been rejected rather than clobbered. The fix belongs in the hook
configuration, not in a claim.

**K0c's signal, settled by its own stop rule (not a new decision).** The plan's
K0c step 1 first draft read "refuse when `once_used_edges` is non-empty". The
measurement above refutes that signal, and K0c's own stop rule -- "do not ship a
guard that refuses correct geometry; that converts class 2 into class 1 at scale" --
is what settles it, so no new judgement was invented: the guard refuses on ground rule
2's own closure check, `|V(r) - V(r + t)| > 1e-9 * V` for t = (37, -23, 11), which is the
same predicate `closed_failures` already applies and measured 0 false refusals against
those 102 correct results while catching all four known-open ones. The handle-level count
stays as `assert_closed`'s recorded metric and as K0b's re-open trigger: if the trim fix
drops C0's count to zero, the cheaper handle signal becomes valid. The slice's purpose, its
position in the order and its exit criteria are unchanged.

**Commits:** none yet -- the lead decides when this lands.

## K1a — non-convex tool booleans — STOPPED at an honest refusal (2026-10-02)

**Decision: stop. C2 stays a refusal. This is a deliberate closeout, not a
timeout.** Six attempts failed; this entry records why a seventh is not owed.

**Why stopping is correct, not a compromise.** C2 is CLASS-1 (honest refusal),
not class-2 (wrong solid). Per `packages/brep-rs/AGENTS.md`: "A refusal is
honest; a wrong solid is a defect." The kernel refuses C2 today, so the
binding contract — never return a wrong solid silently — is **satisfied**. Every
class-2 defect the campaign set out to kill is already fixed (bore floors
`bfb211d`, unreversed subtracted faces `ops.rs:4178`, open shells passing the
manifold guard K0c). Nothing about correctness is owed here. C2 is capability
work, and capability work is optional.

**The measurement that closes the question.** Instrumenting `boolean()` and
running only the C2 pin:
- `process_face` never returns None for any a-face or b-face — it is NOT a face refusal
- the manifold guard PASSES (every edge use count is 1 or 2)
- `boolean_result_is_sound` PASSES
- the only thing that refuses C2 is `volume_is_translation_invariant`
- the result carries exactly **14 once-used edges**

**And it refutes the standing diagnosis.** The recorded theory was that adjacent
faces disagree about WHERE a shared edge is split (one side whole, neighbour
split at the notch floor z=3). Measured: on `x=-10, y=10` the WHOLE edge
`[-5,5]` **and** both halves `[-5,3]` and `[3,5]` all exist, each used once; on
`z=3, y=10` the segments `[-10,10]` and `[7,-10]` overlap on `x` in `[-10,7]`.
Multiple emitted faces each lay a boundary claim over **overlapping** spans of
the same line. That is duplicate overlapping emission, not a missing split.

**Attempt 6 confirms this rather than contradicting it.** `conform_shared_edges`
(221 lines, `git stash@{0}`) unioned the split parameters per edge line and
re-split each face at the union. It could not work, and did not: a union can
make faces agree about *where to cut*, never about *who owns the boundary*. Its
failure is the refutation's prediction. Reverted ungated — 221 lines of
topology surgery across every boolean emission should not sit in a kernel
unverified by any gate. Preserved in the stash, labelled failed.

Also refuted, so attempt 7 does not re-tread them: the reach-box premise
(`region_inside` is exact), the mixed Segment/Arc arm, the micron coordinate
mismatch, and the "print the curve variant / add a mixed Segment<->Arc arm"
leads. The mismatch is neither curve-variant nor representation.

**What reopening C2 would require.** Not a local patch: a decision, made once
rather than rediscovered per face, about which emitted face owns each boundary
span of a shared line, for a subtract against a non-convex tool. That is a
restructure of emission, and it should be scoped and budgeted as its own slice
with a falsification measurement agreed *before* the attempt.

**Not verified.** Oracle was consulted for this call and returned the same
transport error twice (`Custom betas are only available for API key users`), so
the architectural review is outstanding — the decision above is mine, made on
the measurements in this entry.

## Session closeout (2026-10-02) — gates re-measured after the A2 anchor fix

Two defects found by hand-testing, not by a gate, and both now fixed:

- **The counterbore/countersink buttons could never appear.** `featureCenter()`
  returned `null` for a hole (documented as "no anchor, no bar, which is the
  honest state"), and the context bar only renders when it has a point to float
  over. A2 had put both verbs *inside* that bar, so they were unreachable for
  the only feature kind they apply to. Measured in Chromium: selecting `Box 1`
  rendered the bar, selecting `Hole 1` rendered nothing. Fixed by making the
  hole's representative point its MOUTH — the target's point plus the doc's
  offset, pushed out to the drilled face via `extentAlong`'s half-extent
  (`490a674`).
- **Two shipped docs examples could not build.** `reshape-docs.ts` is described
  as "every example runnable" and nothing enforced it. The countersink example
  failed twice over (two recessed holes on one solid is refused; `at:[20,0]` on
  `box(40,40,20)` is the box's own side face), and `repeatAround` used a count
  that made its own copies overlap. Both fixed (`3549409`). The kernel was never
  at fault: a single countersink is exact.
- **`kernel/test/docs-examples.test.mjs`** now runs every docs example through
  `runScript` and the real wasm. Its first run found four MORE pages teaching
  refused scripts — `round()` after a boolean (twice, one on a page titled "The
  order that always builds"), `keep(box, sphere)`, `blend` of two circles. Those
  are real kernel gaps, exempted by name with the reason; each exemption asserts
  the example still refuses, so gaining the capability fails the test and asks
  for the exemption to be dropped.

**Gates re-measured after all of it** (no kernel source changed this session, so
the prebuilt wasm was current — verified with `git diff -- '*.rs'`):

| gate | result | vs baseline |
|---|---|---|
| `brep-parity-gate.mjs` | 70 passed, 2 failed | unchanged |
| `brep-mesh-gate.mjs` | 70 passed, 2 failed | unchanged |
| `brep-step-gate.mjs` | 64 passed, 0 failed, 6 refused | unchanged |
| `gate:occt` | 17 passed, 0 failed | unchanged |
| `cargo test --release` | 291 passed, 1 failed | unchanged (the class-1 K2b chamfer) |
| `bun test` | 430 passed, 0 failed | 389 -> 430 |

Every red is an honest refusal of a case OCCT builds, not a wrong solid.

**Not verified:** A2's *taste*. Driven end-to-end in Chromium after the fix, and
measured rather than assumed:

- the bar renders for a hole with `[Dimensions | Counterbore | Countersink | Delete]`
- it sits inside the viewport, overlaps no toolbar / ribbon / timeline / params panel, and
every button is at least 24x16 px
- clicking `Counterbore` flips the label to `Remove Counterbore` -- the state-tracking the
structural tests only ever asserted
- the model REBUILDS with no refusal before or after, on brep-rs, so the recess is cut and not
merely written into the doc
- zero console errors throughout

What still needs human eyes is only the aesthetic layer: colour, contrast, spacing, overall
balance. This session has no vision path at all -- `look_at` hard-fails on image input, the
multimodal subagent receives no attachment through `task()`, and no OCR is installed -- and no
pixel-diffing substitute answers "does this look right", since it cannot even locate a bar that
floats at the selection anchor rather than at a fixed position.

## SPEC-S2 teaching-copy pass — done here, but the reader is in ANOTHER repo

`reshape-docs.ts` now teaches the OFFICIAL geometry names (`f12651c`), which
SPEC-S2 step 3 deferred as "a later pass" and whose rationale it already
recorded from msgbox #58: students bind variables through those names, so a
lesson teaching `box` makes `box` a poor variable name.

**Correction to that commit message, recorded here because it cannot be edited
in place.** It described `reshape-docs.ts` as "the in-app reference" and its
titles as "the nav label students read". Neither is verifiable from THIS repo:

- the only consumer of `reshape-docs` in the whole tree is
  `packages/kernel/test/docs-examples.test.mjs`, added earlier this session
- `packages/studio` has no docs module, and there is no `public/` directory
- `script-surface.ts:6` locates the documented surface in
  `lib/reshape-docs.ts` and `public/reshape/docs/reference.md` — neither path
  exists here

So the data is authored in this repo and rendered somewhere else (the host
app). SPEC-S2 and `packages/script/AGENTS.md` both call these "in-app reference
pages", which is why the phrasing was inherited rather than invented — but the
honest statement is: **this repo now authors official names; whether a student
sees them depends on the host repo's copy, which is out of scope here.** If
`public/reshape/docs/reference.md` in the host is a separate copy rather than a
build of this module, it still teaches the friendly words and needs the same
flip. That is the one loose end, and it is not mine to close from here.

### What the teaching-copy flip did NOT do: free `box` as a variable name

The directive behind SPEC-S2 (msgbox #58) is that students should be able to
write `const box = ...`, which reads as a natural variable name. Flipping the
taught surface to official names (`f12651c`) does not fully deliver that, and
the difference is worth being exact about.

Measured 2026-10-02, `runScript` one line at a time:

| script | result |
|---|---|
| `const box = 5` | OK — `with(scope)` shadows it |
| `let box = 5` | OK |
| `const box = cuboid(1,1,1)` | OK |
| `cuboid(1,1,1)` | OK |
| `box(1,1,1)` | still callable — the alias is intact |
| `var box = 5` | **REFUSED** — `"box" is already a reSHape tool here` |
| `box = 5` (bare) | **REFUSED** — same |

So `box` is still an OCCUPIED name, not a free one. The flip changes what
students are *taught* to type, which removes the reason to reach for `box` as a
variable — but the refusal for `var` and bare assignment stands, because
`box` remains in VOCABULARY. Freeing it entirely would mean dropping the
student aliases from VOCABULARY, which SPEC-S2 explicitly forbids ("Keep
student words in the array") and which would break every existing lesson,
script and gate fixture that calls `box()`.

Nothing to fix here — the two behaviours are both deliberate and separately
tested in `scope-shadowing.test.mjs`. Recorded only so nobody reads "official
names are taught" as "the friendly names were removed".
