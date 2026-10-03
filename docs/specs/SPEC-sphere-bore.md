# SPEC-sphere-bore: a hole straight through a sphere's centre

Status: BUILT 2026-10-03 (PLAN-next K-2). Derived from our own geometry; no third-party kernel was read.

## The case

`sphere(40)` (R = 20) with `hole(s, { across: 6 })` (r = 3), along any of x, y, z. Before: refused with "cannot cut this hole yet". A bore whose
axis passes through the centre meets the sphere in two CIRCLES at z = +-h, h = sqrt(R^2 - r^2); no new curve type is needed.

## Design

A dedicated builder, `ops::sphere_axial_bore`, called in `ops::boolean` right after `cylinder_cross_bore` (the same pattern). It takes a plain, untrimmed
sphere minus a plain cylinder tool (`cylinder_parts`) and returns the finished solid.

- Sphere face: the same sphere surface with `v_range` narrowed to the zone between the circles (`v` is colatitude from -z; the zone is
  [asin(r/R), pi - asin(r/R)]). The meridian seam is an `Arc`.
- Bore wall: a plain cylinder with `e2` negated (void side), spanning [-h, h] (through) or [floor, h] (blind). Rim circles are shared edge handles.
- THROUGH: two faces (zone, wall). BLIND, entered from one side with the flat floor strictly between -h and h: three faces (sphere with one polar hole,
  wall, floor disk). The entry is normalised to +z, so a blind bore from either end builds.
- Anything else returns None and the hole refuses in its existing sentence: axis not through the centre, r/R > 0.95, a floor inside a polar cap
  (|floor| >= h), a tool that does not clear the sphere, a sphere that already carries a trim.

## Closed forms (derived here, not read off the kernel)

- through: V = 4/3 pi h^3 (the napkin ring)
- blind: V = 4/3 pi R^3 - pi r^2 (h - f) - pi c^2 (3R - c)/3, c = R - h, f = floor height from the centre.

## Measured

R=20, r=3: 32385.73406817515 against 32385.734068175156 (4e-16 relative). Through at (R, r) in {(20,3), (20,10), (20,19), (5,0.5), (30,15)}; along x, y, z and
shifted by (37,-23,11); blind at four depths. OpenCascade referee: volume within 1e-7, same face counts (2 and 3). The mesh at deflection 0.005 is watertight,
consistently oriented, within 1% of the exact volume, and a JS ray cast agrees with the analytic solid at ~1500 random plus structured points.

## Not done / limits

STEP refuses (a sphere face has no STEP writer, as for a plain sphere). Further cuts on a bored sphere are not tested. The 0.95 ratio is a choice.
Tests: `packages/kernel/test/sphere-bore.test.mjs` (16).
