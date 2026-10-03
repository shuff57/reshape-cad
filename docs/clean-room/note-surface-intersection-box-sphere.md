# Design note A: surface-surface intersection for booleans, concretely `intersect(box, sphere)`

Status: background for a lead decision. It authorises no kernel change. Our contract is unchanged: never return a wrong
solid silently; refuse per feature with a plain sentence; four dependencies only; no fallback engine. K1a stays closed
and this note says nothing about reopening it.

## 1. Our problem

`combine` of a box and a sphere with `intersect` (and `keep`) refuses with "an unsupported surface pair". The kernel today
builds only one sphere-versus-box case: a sphere trimmed by a centred, symmetric square tube along its own polar axis.
The general case needs, for every box face crossing the ball, the exact circle where the face plane meets the sphere,
that circle clipped to the face's rectangle, the matching hole in the sphere face, and then a keep/drop decision per
piece. The sphere face also has a seam and two poles, which any hole boundary may straddle.

## 2. How the foreign designs decompose it

The kernels I read share one pipeline, and the first two stages decide whether we can be exact.

**Stage 1, find candidate pairs.** A bounding-box broad phase discards face pairs that cannot touch. One design also
samples a small grid of normals and distances on each pair to label it: apart, crossing, nearly tangent, degenerate at a
pole, or the same surface. The label picks the strategy; it never decides the answer alone.

**Stage 2, intersect a pair, by type.** Where a closed form exists it is used and trusted. The honest designs also have
a third answer besides "curve" and "none": "I cannot say", which the boolean must turn into a refusal. Treating
"cannot say" as "do not meet" produces a solid with a missing wall.
- Plane and sphere: let d be the signed distance from the sphere centre to the plane. If |d| > R, empty. If |d| = R, one
  tangent point (one design treats this as empty because a point imprints nothing). Otherwise one circle, centre at the
  centre's projection onto the plane, radius sqrt(R^2 - d^2).
- Plane and cylinder: plane square to the axis gives a circle; plane parallel to the axis gives zero, one (tangent) or two
  lines; oblique gives an ellipse with semi-minor equal to the radius and semi-major radius/|cos(tilt)|.
- Two spheres: a circle in the radical plane. Plane and cone: circle or generator pair when square or through the apex;
  other sections are conics that some kernels cannot yet represent, so they answer "cannot say".
- Surfaces of revolution sharing an axis (sphere with a coaxial cylinder or cone, coaxial tori): intersect the two 2D
  meridian profiles in the (distance-from-axis, height) half-plane; every crossing, swept round the axis, is a circle.
  This one idea covers a whole family exactly.
- Off-axis sphere and cylinder, two cylinders at an angle, sphere and oblique cone: quartic curves. Exact designs say
  "cannot say"; others march.
- Exactness is kept by representing sections as rational quadratic arcs built by an affine or projective map of a base
  circle, so the arc stays on both surfaces to round-off.

**Stage 3, marching, only where no closed form exists.** Seeds come from where coarse meshes of the two faces cross, or
from a grid. Each seed is Newton-refined onto both surfaces, then the trace steps along the cross product of the two
normals and re-settles, in both directions, until it closes on itself or leaves the shared domain. Step length is capped
by how fast the normals turn. Seeds with near-parallel normals are rejected (a trace in a tangency band wanders). A trace
that exhausts its budget is a loud failure, never a truncated curve. A surface pair is marched once, not per face, or
the copies sit a hair apart and leave slivers. The point string is fitted by a curve: approximate.

**Stage 4, trim and close loops.** Each section is clipped to each face's real boundary: for a box face, circle against
rectangle gives arcs (or a whole circle when it fits inside). Clip endpoints become vertices on the box edge, which the
neighbouring face must also see (note B). On the sphere side the curve is expressed in longitude and latitude, with the
periodic branch kept consistent across the seam; a pole inside a hole is a special case. Pieces then form a 2D
arrangement per face; cycles are extracted and outer boundaries separated from holes by area sign.

**Stage 5, classify.** Each cell is tested for inside, outside or on the other solid by a ray-crossing count; grazing a
vertex or edge makes the count meaningless, so the count is retried along other directions and, if all fail, the answer is
"unknown" and the boolean refuses. Untouched faces inherit their fate across shared edges instead of being retested.

**Tangent and degenerate contact.** Two cases are separated by a rank test of the difference of the two surfaces' second
fundamental forms at the refined contact: an isolated node (two branches crossing) can be carved; an extended contact
(sphere inscribed in a cylinder, touching along a curve) has no section curve and is refused by name. A perturb-and-retry
style fallback exists in general (nudge a size slightly, recompute, accept only if the answer is continuous); for us it
would return a slightly different solid, so it is a diagnostic idea only, never a build path.

## 3. Exact versus approximate

Exact: plane-sphere circles, plane-cylinder lines and circles and ellipses, coaxial revolution pairs, containment and
disjointness answers. Approximate: any marched curve (fitted), classification near the boundary (tolerance band). One
design reports box-sphere intersect matching the analytic volume to near round-off using the exact path.

## 4. Incremental plan in our terms

Each stage lands only with its closed-form fixtures passing and a refusal for everything beyond it.

0. Containment only: sphere strictly inside the box returns the sphere; box strictly inside the sphere returns the box
   (sphere radius above half the box diagonal). Fixtures: radius 8 in box 20^3 gives 2048 pi / 3; radius 18 gives 8000.
1. Axis-aligned box, sphere at the centre, 10 < R < 10 sqrt 2 (every circle fits inside its face, caps cannot meet): the
   intersect is the sphere minus six caps. Cap height h = R - 10; cap volume = pi h^2 (3R - h) / 3.
   Box 20^3, R = 12: h = 2, cap = 136 pi / 3, six caps = 272 pi; **intersect = 2032 pi = 6383.716272**.
   Same operands: union = 8000 + 272 pi = 8854.513202; box minus sphere = 8000 - 2032 pi = 1616.283728.
   Surface area of the intersect = six discs of radius sqrt 44 (264 pi) plus the sphere face (4 pi 144 - 6 * 2 pi 12 * 2 =
   288 pi), total 552 pi. Topology: seven faces; the sphere face carries six inner loops; six circular edges.
2. Same, sphere centre shifted by (1, 0, 0), R = 12: caps have heights 3, 1, 2, 2, 2, 2 and still do not overlap.
   Total caps = 99 pi + 35 pi / 3 + 544 pi / 3 = 292 pi; **intersect = 2012 pi = 6320.884419**.
   Rule: build only when every circle fits inside its face and no two caps overlap (pairwise overlap needs
   distance-squared sums beyond R^2); otherwise refuse.
3. Tangent R = 10 at the centre (six point contacts): refuse in a sentence; never perturb.
4. Later: circles crossing box edges (R > 10 sqrt 2) need inclusion-exclusion fixtures and shared edge vertices; do not
   start before note B's diagnostic exists. Coaxial sphere and cylinder: ball of radius R meets a coaxial cylinder of
   radius a in volume 4 pi (R^3 - (R^2 - a^2)^(3/2)) / 3; R = 13, a = 5 gives 1876 pi / 3 = 1964.542606.
5. Marching: do not build. Off-axis quartics refuse.

**Test idea against our own kernel (not a dependency).** For any boolean result, sample a regular grid of points over the
bounding box, skip points within a small band of either operand boundary, and compare "inside the result" with the
boolean predicate of the operands' own inside tests. Any mismatch fails the test. It catches a missing wall, an unreversed
face and an added void that volume alone can hide when errors cancel.

**Refusal sentences to keep:** the existing "unsupported surface pair" sentence for any pair beyond the stage built;
add one for tangent contact ("the sphere only touches a face of the box at a point, which this kernel will not
guess at") and one for a section circle that leaves its face ("the sphere cuts across an edge of the box, which is not
built yet").

## 5. Licence note

Read, read-only, nothing copied: mmiscool BREP kernel @ eeb9f92 (custom copy-back licence), vcad @ eba7a2e
(Apache-2.0/MIT), opencadkernel @ d22a270 (MPL-2.0), monstertruck @ 1fbc7a5 (permissive; truck-* banned by AGENTS.md; ideas
only). Date 2026-10-02. All formulas above were derived independently from elementary geometry.
