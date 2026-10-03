# SPEC-transverse-bore: a hole across the side of a round part

Status: INVESTIGATED 2026-10-02, NOT BUILT. The kernel keeps an honest refusal. This note says why, what is missing, and what would prove an implementation. Derived from our own geometry and our own source; no third-party kernel was read.

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

## Decision

Keep the refusal. It is honest, per feature, and now says what to do (drill along the part's own axis). Building this is a kernel-wide change (new curve variant, curve-trimmed faces, mesh, STEP), not a boolean arm.
