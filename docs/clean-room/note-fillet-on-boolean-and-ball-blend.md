# Design note R-1: fillet/chamfer on a boolean result, and ball blends at corners

Reader note, prose and plain maths only. Written for an implementer who will not see the source.

## 1. The problem as our kernel sees it

Today a round or chamfer is built from a primitive: an axis-aligned box edge, or the rim of a plain cylinder. A chamfer on a convex straight edge of a general solid is built by subtracting a wedge. What refuses: a round beyond a box, a chamfer on a boolean result (K2b), tangency.

Geometry of one edge between faces A and B with interior dihedral angle theta (angle inside the material, 90 degrees for a box):

- A radius-r fillet is a cylinder of radius r tangent to both faces. Its axis lies at distance r from each face, inside the material for a convex edge and in the air for a concave one. The contact lines are straight lines on A and B, each at distance r/tan(theta/2) from the edge (the setback). The blend surface is the cylinder arc between them.
- A chamfer of distance d is the plane through the two lines at distance d from the edge, one on each face.
- Topologically each mating face loses a strip along the edge and gains a new boundary edge on its contact line. One new face (blend) is inserted. Faces at the two ends of the edge must be re-trimmed so the loops still close.

Why the end vertex matters. Where the edge ends at a vertex touching exactly three faces (A, B and an end face E), the blend is simply cut by E's plane: when E is perpendicular to the edge the cut is a circular arc, otherwise an elliptical arc. Both A and B shorten consistently and every loop closes. When the end vertex touches four or more faces, which is common after a boolean (a notch or pocket meeting a box edge), there is no single end face. The blend's end section would cross into a fourth face, and the contact lines of the neighbouring edges' blends (if those are rounded too) need to meet. Our kernel has no representation for that closure, so today the only honest answer is to refuse.

Corners with several rounded edges: if two or three rounded edges meet at a vertex, their blends overlap. They cannot simply be cut by end planes, because each blend's end overlaps the next blend's.

Our boolean cannot be the vehicle. K2b is gated on the shared-edge consistency work (K1a, closed). A "subtract a tool solid" construction therefore inherits the boolean's failures. A direct edit of the shell (swap the edge for a blend, re-trim the two mating faces) needs no boolean and is the preferred route.

## 2. How the foreign designs decompose it

All three sources agree on the same skeleton.

**Rolling-ball spine and contact curves.** Imagine a ball of radius r touching both faces at once, rolled along the edge. Its centre traces the spine, which is the curve at distance r from both surfaces (the intersection of the two offset surfaces, taking the side of the material for convex edges). The ball touches face A and face B at two contact curves. The blend surface is the envelope of the ball's cross-section circle, with the circle lying in the plane perpendicular to the spine and passing through the two contact points. For two planes this is an exact cylinder. For a plane and a cylinder it is an exact torus piece (axis shared with the cylinder). For two coaxial cylinders it is a torus piece. For two skew cylinders or general surfaces the answer is not a standard quadric and the sources fall back on numerics.

**Stations.** For general surfaces the centre is found at a ladder of stations along the edge by solving a small nonlinear system: equal distance r to both surfaces, centre in the plane perpendicular to the edge at that station. Newton iteration from the previous station's answer. The stations are then fitted by a spline surface and by splines for the contact curves. One source refines the ladder locally where the fit stands off its carrier. Another fits the contact curves in the parameter space of the faces and verifies the fit at points between the samples, since a fit through the samples reads zero error at those samples whatever happens between.

**Reconciling adjacent blends.** The better design does not blend edge-by-edge on a solid already cut. It marches every selected edge against the ORIGINAL solid, solves every corner first, and only then changes topology, so the answer cannot depend on selection order. Corner types:
- Free end (one blended edge): cut by the end face.
- Two blended edges, third edge sharp (miter): the two blend surfaces intersect in a seam curve starting at the point where the ball touching all three faces touches the shared face. For equal radii and mirror symmetry the seam is planar (a planar curve on the bisector plane). Otherwise it is marched as a level set: a point of blend 1 lies on blend 2 when its distance to blend 2's spine equals r.
- Three blended edges meeting at a convex vertex: find the single ball of radius r touching all three faces (centre at distance r from each face). The corner patch is the piece of that sphere between the three tangency points, and each stripe stops exactly where its rolling ball coincides with the corner ball. The sphere patch and the stripes meet tangentially along circle arcs, so nothing needs intersecting.
- Mixed convex and concave edges at one vertex, a re-entrant vertex, or no common ball: refuse by a named reason (one design uses a torus-like horn patch for the re-entrant case, and another samples a blend; neither is cheap).

The simpler design (vcad-style) offsets every face by r and is only right when every edge is blended; for a subset it produced a malformed solid, so they wrote a separate path for subsets of planar edges with at most two selected edges per vertex. A chain of edges meeting at mirror-symmetric corners is closed by a planar miter curve.

**Tolerances and failure detection.** Collapsing a corner where the blend is exactly as wide as a face merges vertices within a stated small band and then re-runs a closure check. The best design checks the result against a closure bar after every identification. A weaker design hands back the input unchanged when it cannot finish and reports nothing; that is the failure we must never copy, and the third source includes a rule that a curve with no exact rational form must refuse rather than be sampled.

## 3. Exact versus approximate

Exact: plane-plane (cylinder), plane-cylinder and coaxial cylinders (torus), the corner patch of a three-edge convex corner of three mutually orthogonal planes (octant of a sphere), and any planar miter curve.

Approximate: general surfaces (fitted splines through stations), the seam of two unequal blends (a marched level set, sampled), any corner patch where the three faces are not mutually orthogonal planes with equal radius, and variable-radius blends. A fitted surface breaks our rule of no approximations: its error is whatever the fit tolerance allows, the tolerance is invisible to the user, and a seam sampled off by the tolerance produces a shell that reads as closed but is not watertight within our own validity checks. For ReSHape these are refusals, not features, until we can name a bound and gate on it.

Another risk: a fit can hide the failure that matters. A blend can be built and still wrong when the radius exceeds what the local geometry can host (the inset faces cross over). Every shipped design needs explicit refusals for that.

## 4. Proposed incremental plan (our terms, our maths)

Use direct shell surgery, not a boolean. Check after each step with volume, edge-manifold and closure checks, and keep the existing per-feature refusal contract. Add refusals before adding capabilities.

1. **Plane-plane edge on a boolean result, valence-3 ends, end faces perpendicular to the edge.** Contact lines at setback r/tan(theta/2) on each face; a cylinder (convex) or filler (concave) between. Removed (convex) or added (concave) volume is (edge length) times r squared times (cot(theta/2) - (pi - theta)/2).
   - Fixtures: block 20x20x10 minus a 10x10x10 corner block (an L). Inner concave edge of length 10, radius 1: volume = V_L + (1 - pi/4) * 10. Outer convex edge removes the same: V_L - (1 - pi/4) * 10. A 135-degree edge (prism after a chamfer cut, theta=135 degrees, equal to 3 pi/4): per unit length r squared times (sqrt(2) - 1 - pi/8). A 120-degree edge (hexagonal prism): r squared times (1/sqrt(3) - pi/6).
2. **Chamfer on the same set.** Planar bevel with leg d on each face. The removed (convex) or added (concave) triangle has two sides d with included angle theta, so the volume per unit length is d squared times sin(theta) / 2, which is d squared / 2 at a right angle. Fixtures: the L above with d=2, inner and outer edges (length 10, 20 per edge cross-section d squared / 2 = 2 per unit length, so plus or minus 20); the 120-degree hex edge gives d squared times sin(120 degrees)/2.
3. **Oblique end faces** (elliptical end arcs): only if our curve set carries an ellipse; otherwise refuse "round ends the edge meets at a slant".
4. **Plane-cylinder edge.** Concave fillet at the base of a cylindrical boss of radius R, fillet radius r: added volume 2 pi times ((1 - pi/4) r squared R + (5/6 - pi/4) r cubed). A convex rim (cylinder radius R, top): removed volume 2 pi times ((1 - pi/4) r squared R - (5/6 - pi/4) r cubed). Derived by Pappus from the filler cross-section (square minus quarter disc). Requires R greater than r for the convex case.
5. **Corner ball blend, three mutually orthogonal convex planar edges, equal radii.** Corner patch is an eighth of a sphere of radius r, centred at distance r from each face. For a box a by b by c with all 12 edges rounded at r: V = abc - (1 - pi/4) r squared (4(a+b+c) - 24 r) - 8 (1 - pi/6) r cubed. Check: a=b=c=2r gives a ball, 4 pi r cubed / 3. Single corner of a box with its three edges rounded (edge lengths L1, L2, L3): V = abc - (1 - pi/4) r squared (L1+L2+L3 - 3r) - (1 - pi/6) r cubed. Fixture: 10x10x10, r=2, all edges: 648 + 248 pi / 3, about 907.7.
6. **Everything else keeps a refusal:** valence of four or more at an end vertex ("this edge ends where more than three faces meet"); mixed convex and concave edges at one vertex; two rounded edges meeting with unequal radii; non-orthogonal corner; skew-cylinder or free-form faces; a size that makes inset faces cross over (use the shorter adjacent-face width as now); chamfer of a corner with more than two edges; any variable radius.

Gate: each new case is built, then its volume compared with the closed form above, and the shell checked for once-used edges and a closure failure. A case that cannot satisfy these refuses; it never ships.

## 5. Licence note

Read, read-only, in the scratchpad clones: mmiscool/next.BREP.io_RUST_BREP_KERNEL @ eeb9f92 (custom licence with copy-back/assignment, ideas only); ecto/vcad @ eba7a2e (Apache-2.0/MIT, ambiguous; ideas only); monstertruck @ 1fbc7a5 (Apache-2.0; ideas only, a quick look). Nothing was copied. No source text, names, constants or file structure are reproduced here; all formulas above were derived independently from geometry.
