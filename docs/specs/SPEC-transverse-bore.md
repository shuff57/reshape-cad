# SPEC-transverse-bore: a hole across the side of a round part

Status: BUILT 2026-10-02 (see "As built" at the end). The earlier investigation below said this needed a kernel-wide change; a narrower design, a dedicated analytic trim for exactly this one case, did it without touching the shared boolean path. Derived from our own geometry and our own source; no third-party kernel was read.

(Historic text, kept for the reasoning: everything from "The case" down to "Tests that would prove it" is the pre-build investigation. Its "Decision: keep the refusal" was superseded.)

## The case

`cylinder(20, 30)` (R = 10, h = 30) with `hole(c, { across: 4, along: 'x' })` (tool radius r = 2, axis perpendicular to and through the part's axis). Today `build_doc_json` refuses it:

> hole h: a bore across the side of a round part meets its wall in a curve brep-rs cannot carry yet; drill along the part's own axis instead -- h is shown without it.

(Before this note the sentence was the generic "cannot cut this hole yet".) A tool across a cylinder is the same refusal whether it is a bore or a square slot: measured, `cut(cylinder(20,30), box(40,6,10,{at:[0,0,0]}))` also refuses with "an unsupported surface pair". So the sentence does NOT suggest a slot.

## The curve

Part axis z, tool axis x. Part wall `x^2 + y^2 = R^2`, tool wall `y^2 + z^2 = r^2`. With `y = r cos t`, `z = r sin t`:

    x = +/- sqrt(R^2 - r^2 cos^2 t)

For r < R this is a closed space curve (one per side the tool enters, two for a through bore). It is not planar and not a conic: the points at t = 0, pi/2, pi, 3pi/2 are not coplanar (their diagonals are skew), so no `Circle`/`Arc` and no sampling-free planar trick describes it. Only for r = R does it degenerate into two planar ellipses, and that case cannot occur: the hole is refused earlier when `across` exceeds the part's width (`Boring ... would not fit`), and r = R leaves a knife edge.

## What the kernel's model lacks (measured against the code, not assumed)

1. **Curve.** `geom::Curve` has exactly three variants: `Segment`, `Circle`, `Arc`. There is no parametric or NURBS edge, so the meeting edge has nowhere to live. `same_edge_geometry` (the seam weld), `Curve::length`, `point_at`, the edge measure, name resolution, the mesher's edge sampling and the STEP writer all match on those three and would each need a fourth arm.
2. **Trimmed curved faces.** A curved face is a rectangle in (u, v): `Surface::volume_term` integrates over `domain()` = `[u0,u1] x [v0,v1]` and nothing else (the one trimmed exception is the sphere's polar caps, special-cased). The tool's wall and the part's wall after a transverse cut are bounded by a curve `v = f(u)`, which is not a rectangle. Area, centroid, volume, `face_area_centroid`, the mesher (a regular grid per face) and `inside_surface` all assume the rectangle. `partial_wall_arc` trims in u only, `partial_wall` in v only; neither can trim along a curve.
3. **Boolean.** `process_face` for a cylinder wall returns `None` for any other face of `other` that is not a parallel cylinder, a perpendicular plane, a sphere handled as above, or a coaxial torus/cone (`ops.rs`, the `Surface::Cylinder` arm: "non-parallel axes: not yet implemented"). The face split would need the curve as a pcurve in both faces' (u, v).
4. **Volume has no elementary closed form.** The removed volume for a through bore is `4 * integral_{-r}^{r} sqrt(r^2 - y^2) * sqrt(R^2 - y^2) dy`, a complete elliptic integral of the second kind. R = 10, r = 2: 250.06441209661864 (Simpson on `y = r sin t`, 2e5 intervals, computed in a scratch script), leaving 9174.71354867276 of `pi R^2 h` = 9424.777960769381 at h = 30. Our test oracle would be a numeric integral or the OCCT referee, never a hand-derived elementary formula, so a wrong curve could hide inside an agreeable-looking tolerance.

The first two are structural. Adding a fourth `Curve` variant touches every module and every `match`; adding curve-trimmed faces touches the area, volume and mesh machinery that every other feature relies on. That is the destabilising change this task said not to force.

## Minimal curve type, if it is ever built

`Curve::CylCylIntersection { part_axis, part_radius, tool_axis, tool_radius, branch: +1 | -1 }` for the perpendicular-and-intersecting-axes case only, parameterised by `t` as above, with exact `point_at`, tangent and arc length (an incomplete elliptic integral, evaluated numerically to 1e-12). Keep it a closed-form analytic type (no sampled polyline: the repo bans faceted approximations), and refuse anything off-centre or skew.

## Proof obligations (all must hold before the refusal is removed)

1. Volume equals the numeric integral above to 1e-9 relative, at the origin AND shifted by (37, -23, 11), for r/R in {0.05, 0.2, 0.5, 0.9} and a bore that starts inside the part (blind) as well as through.
2. `once_used_edges` empty for the meeting edges (they must weld: one handle per seam), translation invariance of the volume, mesh watertight at 0.05 with the shared edge sampled identically from both faces.
3. Every tessellated vertex of the wall lies on the other surface to 1e-9 (the curve is truly on both).
4. Parity gate fixture built on OCCT and brep-rs (a NEW fixture; `scripts/brep-parity-fixtures.mjs` is lead-owned, so the lead adds it) agrees on volume, bbox and face count.
5. STEP export reads back in OCCT at relative volume delta 0 (needs an `INTERSECTION_CURVE` or a B-spline writer: a further, separate change).
6. Every near-miss refuses in a sentence: tangent (r = R), off-centre axes, skew axes, tool entering through the cap.

## Tests that would prove it

- cargo: a `cylinder_cylinder_perpendicular_*` family in `ops.rs` pinning obligations 1 to 3 with `assert_closed`.
- `packages/kernel/test/transverse-bore.test.mjs`: the script cases above through `runScript`, numeric-integral oracle, and the exact refusal sentences for the near-misses.
- The existing `k8_transverse_bore_still_refuses` (cargo) and 'a transverse bore through a cylinder side still refuses plainly' (kernel) pin today's refusal and must be flipped to `Exact` in the same commit that builds it.

## Decision (superseded)

The pre-build investigation kept the refusal, reading the work as a kernel-wide change (new curve variant, curve-trimmed faces, mesh, STEP). It was wrong about the cost: the case is narrow enough (two perpendicular cylinders whose axes meet) that every trimmed region has a closed one-dimensional form.

## As built

### Design

A DEDICATED builder, `ops::cylinder_cross_bore`, called first in `ops::boolean`, the same way `cylinder_pair_boolean` and `cylinder_open_hollow` are. It takes a plain cylinder minus a plain cylinder tool and returns the finished solid; nothing in the generic face-split path changed.

- **Curve.** `Curve::CylCyl { center, d, n, a, big_r, r, sign }`: `p(phi) = center + sign*sqrt(R^2 - r^2 cos^2 phi) d + r cos(phi) n + r sin(phi) a`, `n = a x d`. Exact `point_at`, derivative, length and centroid (composite Gauss-Legendre of the speed, 64 panels x 16 nodes), tight bounding box (dense sample plus golden-section refinement).
- **Trimmed faces.** `Cylinder` gained `cross: Option<Cross>`, mirroring the sphere's existing `trim`. `Cross::Wall` is the part's wall less its entry hole(s); `Cross::Tool` is the bore's own wall bounded by the meeting curve (and, for a blind bore, a flat floor). The wall's frame is fixed by the builder (`e1 = n`, `e2 = -d`) so both holes sit at u = 3pi/2 and pi/2, far from the seam at u = 0, and the rim circles are `Arc`s starting at `n` so a seam never lands on a hole (a `Circle` rim starts at `frame(axis).e1`, which IS the hole centre for a bore along x).
- **Measures, all exact one-dimensional quadratures of closed-form integrands (no sampled polygon).** Tool wall, with extent `hi(u) - lo(u)` along the bore at angle u: area `integral r (hi-lo) du`, volume term `integral s r (r + O.rho(u)) (hi-lo) du`, centroid `integral r [(O + r rho)(hi-lo) + axis (hi^2-lo^2)/2] du`. Pierced wall: whole wall less each hole, the hole region `{R^2 sin^2 a + z^2 < r^2}` integrated with `sin a = k sin t`, `z = r cos t`, `k = r/R`, which makes the integrand smooth (the plain `a` parametrisation has square-root endpoints). The panel count grows as `8/(1-k)`.
- **Mesh.** Neither face is a (u, v) rectangle, so each is a LADDER between boundary polylines that already are edges of the solid: the pierced wall between each rim and each half of the hole's outline (chord rungs always on the material side of the curve's steep tips), the bore wall between its two chains. Every vertex comes from an edge polyline, so the shared curve is sampled identically from both faces. The curve's segment count is the maximum of what the tool circle, the part wall (its angle moves at most k per unit) and the curve's own worst bend need, in multiples of 4.
- **Self-check.** The builder subtracts the result's measured volume from the part's and compares it with an independent form of the removed volume (`integral 2 r^2 cos^2 th * x_extent d th`); a disagreement beyond 1e-10 of the part refuses.
- **Everything else refuses.** `ops::boolean` returns `None` when either operand carries a cross trim (`has_cross_trim`), `flip_face` returns `None` for one, `cylinder_parts` does not recognise one, and `build_doc` refuses pocket, groove, hole, combine, fillet, draft, shell, mirror and blend on a bored part with "already has a bore across its side". Moves and copies (pattern) are rigid and stay exact.
- **STEP.** No exact form is written. `step::write_solid` refuses a solid holding a cross trim: "brep-rs cannot write a bore across a cylinder's side to STEP yet ...". An `INTERSECTION_CURVE` or B-spline writer is still the separate piece of work.

### What builds

A plain cylinder, a plain cylinder tool, axes perpendicular and meeting; tool radius at most 95% of the part's; the bore clear of both caps; and either THROUGH (both tool ends clear of the wall) or BLIND entering from one side with its flat floor strictly inside (|floor| < sqrt(R^2 - r^2)). Any axis orientation, any translation.

### What still refuses (each with the sentence "a bore across the side of a round part builds only when ...")

Tangent or near-tangent (r/R > 0.95), off-centre (axes do not meet), skew (not perpendicular), through a cap, a floor that lies in the wall (between sqrt(R^2 - r^2) and R), a part that is not a plain cylinder (an earlier cut, a shell, a chamfer), a second cut on a bored part, a STEP export of one.

### Measured

R = 10, r = 2, h = 30: removed 250.06441209661864 (Simpson, 400000 intervals), solid 9174.71354867276; brep-rs 9174.713548672766 (6e-16 relative). Through bores at r/R in {0.05, 0.2, 0.5, 0.9, 0.95} and blind bores (three floors each, entering from +x and -x) match the numeric integral to 1e-9, at the origin and shifted by (37, -23, 11); 4 faces (through) and 5 (blind). `once_used_edges` is empty; the 0.05 mesh is watertight at every ratio and at 0.01; mesh volume within 1% of exact; every vertex of each wall lies on its own cylinder, none past the other; the meeting curve lies on both to 1e-9. OpenCascade as referee: volume within 3e-11, bbox identical, face count 4/4 and 5/5.

### Tests

`ops::cross_bore_pins` (8, cargo), `k8_transverse_bore_builds_exactly` and `k8_transverse_bore_measures_meshes_and_refuses_step` (cargo; they replace `k8_transverse_bore_still_refuses`), `packages/kernel/test/transverse-bore.test.mjs` (9, with the OCCT referee), and the flipped 'a transverse bore through a cylinder side builds exactly' in `kernel-fixes-k8.test.mjs`.

### Not verified

No browser check of the viewport. The parity gate has no fixture for this (lead-owned; the lead may add one). The 95% ratio limit is a choice, not a proof: the quadrature is exact well past it, but the mesh and the tips pinch toward the part's silhouette, and it was not tested beyond 0.95.
