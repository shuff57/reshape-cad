# SPEC: a ball against a box, any orientation (W2 of PLAN-kernel-next-2026-10-05.md)

Status: DRAFT 2026-10-05, nothing built. Parent: `SPEC-brep-kernel-rs.md` section 4.5, `SPEC-brep-combine-sphere.md`
(the one case that exists: a square prism through a ball), `SPEC-brep-sphere-multi-bore.md` (`sphere_hull.rs`).

## What refuses today (measured 2026-10-05, probe `w2_probe_ball_box`, ball r = 10)

| Box against the ball | Result |
|---|---|
| One box plane crosses the ball (the rest clear of it) | builds (a cap, or the rest): `rev_circle_on_plane` |
| Two parallel planes (a slab) | builds, except `subtract` of a slab through the middle (two lumps, honest) |
| A square prism straight through, centred | `subtract` builds (the S-series special case); `union` and `intersect` refuse |
| Two or more NON-parallel planes cross the ball (an edge or a corner of the box inside it, an offset prism) | refuses at `ops_planar.rs` `rev_circle_on_plane` ("a plane that is not square to the axis reaches the surface") |

Pair census (seed 1, 1,500 scripts): 81 box x sphere gaps, 35 tangent (W8, now partly done), 46 not; of those 46 only 3 cross one
plane, 2 cross none, and 41 cross two to six. So the work is the multi-plane case; one plane is its first test, not a result.

## The shape of the answer

A ball B (radius R, centre c) and a box X (six planes, any rotation) meet in a region whose boundary is made of:

* **Box faces, each cut by its circle.** Plane i is at signed distance `d_i` from c; it meets the ball in a circle of radius
  `sqrt(R^2 - d_i^2)` (none if `|d_i| >= R`: tangent is W8's, refuse here). The part of face i inside the ball is the rectangle
  intersected with that disk: a loop of straight segments (rectangle edges, clipped by the circle) and circular arcs.
* **One sphere region**: the points of the sphere inside X (or outside, by operation). Its boundary is the arcs above, joined at the
  points where a box EDGE meets the sphere. It may be one loop, several loops (a prism through the ball leaves two holes), or none.
* **Vertices**: box corners inside the ball (a corner of X), and box-edge-meets-sphere points (up to two per edge).

The faces of the result, by operation (A = ball, B = box):

| Operation | Sphere region | Box faces |
|---|---|---|
| `keep` (intersect) | inside X | inside the ball, normal as the box's |
| `cut` (A - B) | outside X | inside the ball, normal reversed |
| `cut` (B - A) | inside X, normal reversed | outside the ball (rectangle minus disk) |
| `join` | outside X | outside the ball |

"Outside the ball" for a face is the rectangle minus the disk: a rectangle with a circular hole when the disk is wholly inside the
face, otherwise one or more pieces bounded by segments and concave arcs.

## Representation (the invasive part)

A sphere face needs a trim that says "the points inside (or outside) this convex polyhedron". Add to `SphTrim`:

```
Hull { n: u8, planes: [HalfSpace; 6], keep_inside: bool }     // HalfSpace { n: Vec3, d: f64 }, outward normal
```

`SphTrim` is `Copy` and already carries `Bores` (four entries), so a six-plane array fits. Membership of a sphere point is
`all(dot(n_i, q) <= d_i)` (flipped for `keep_inside = false`): this is `in_bore_hole`'s analogue, and it is the `in_hole`
predicate `sphere_hull::sphere_with_holes` already wants. Boundary wires are the arcs, as edges of a new `Curve` or existing `Arc`
(each is an arc of a circle, so the existing `Curve::Arc` suffices; the sphere face's `uv` pcurves are not needed for the hull mesher,
as with `mesh_sphere_bores`).

About 48 places read `SphTrim` (geom 18, ops 13, step 8, mesh 5): each must either handle `Hull` or refuse it, like `Bores`. The bore
series (S1 to S4h) is the template; the checklist is `grep -n "SphTrim::"`.

## Meshing

`mesh_sphere_hull`: loops from the boundary arcs' polylines, `in_hole` from the trim, then `sphere_with_holes`. The derived-not-verified
point of the plan: that its conformity argument (a smooth, densely sampled loop) survives a loop with CORNERS. The corner vertex is on
the loop (it is where two arcs meet), so the loop polyline passes through it; whether the empty-diametral-cap argument holds at a
corner needs a standalone cargo test first (prototype P0).

## Never a wrong solid

The result is checked by what already guards every boolean: edge-use counts (each edge twice), `volume_is_translation_invariant`,
`boolean_result_is_sound`, mesh closed, and the inclusion-exclusion partner `V(A+B) + V(A*B) = V(A) + V(B)` to 1e-9. The oracle is a
numerical integral of the ball-box overlap that shares no algebra with the builder: integrate over (x, y) the length of the chord
`[z_lo(x,y), z_hi(x,y)]` clipped to the box, in a frame where the box is axis aligned (any box is, by rotating the ball's centre into
the box's frame). Refuse, in a sentence, whenever a contact is degenerate: a box edge tangent to the ball, a corner exactly on the
sphere, a circle through a corner, two circles tangent to each other.

## Slices

* **P0, prototype (no kernel edits):** the topology (vertices, loops, which box faces are cut) and the volume, as a standalone cargo
  test against the numerical oracle, over a grid of box placements; plus `sphere_with_holes` on a corner loop, checked watertight.
  Stop rule: if the hull mesher cannot close a loop with corners, W2 changes (see Risks) before anything else is built.
* **P0 RESULT (done, `ball_box.rs`):** the stop rule passes. `region_loops` finds the boundary of the sphere region inside a box (arcs joined at
  corners); on 120 random boxes at random orientations all 232 meshes (the region and its complement) close, conform to their loops, and
  match a Fibonacci-lattice area oracle within 3 %. One change was needed: when the part kept is a small patch and the hole is the rest of the
  sphere, the hole side had no points, the loop circles are flat, and the hull's far facets lay across the patch and were kept as duplicates
  (86 of 232 failed). `sphere_with_holes_scattered` adds a coarse scatter inside holes, two margins from every loop vertex (conformity
  untouched); `sphere_with_holes` (bores) is unchanged. Corners were never the problem.
* **S1 RESULT (done):** `ball_box::keep` builds ball AND box at any orientation: planar pieces (rectangle intersect disk, from the
  region's arcs and the rectangle's clipped edges), one `SphTrim::Hull` sphere face, welded, then checked against the independent
  numerical overlap volume (1e-7 of the ball), edge-use counts, translation invariance and a closed mesh. Exact face areas assemble the
  oracle volume to 1e-13 of the ball over 145 random boxes; through the public `boolean`, 77 of 77 clean crossings build. Pair family:
  764 to 773 agree, 0 wrong. Three things beyond the plan were needed: (1) the hull mesher needs every boundary arc sampled UNIFORMLY with
  one step length (an arc of a smaller circle sampled at the same angle step, or with the extreme-angle samples `curve_points` injects,
  puts a short edge beside a long one at a corner and the long edge leaves the hull); (2) the sphere's axis points that belong to the face
  must be mesh vertices or the mesh bounding box falls short of the exact one (caught as a `WRONG-BBOX-ONLY` census record), added when
  outside every loop edge's diametral cap; (3) `mesh_solid` now retries at finer chords when the first attempt gives nothing, as it
  already did for an open mesh. `sphere_hull::sphere_with_holes_scattered` (a coarse scatter in the holes) was P0's one change.
* **S1, `keep` (ball and box):** `SphTrim::Hull`, faces, mesh, STEP refusal as for other sphere trims. One connected region.
* **S2, `cut` (A - B):** the sphere outside X; a prism through gives two holes.
* **S3, `join`, and `cut` (B - A):** the rectangle-minus-disk faces: the part that can be several pieces.
* **S4, cylinder against the ball, then ball against ball:** the plan's (c) and (d); a cylinder's wall meets the sphere in a quartic, so
  that is a new curve and its own spec.

## Risks

* The mesher: corners (above). Fallback: split the sphere region along the box's edge great arcs into patches that are smooth-bounded
  (more faces, no corners in a loop).
* The census sees this through scripts that also have a `hole` or `round` after it (the refusal cascades); the gain is smaller than the
  pair-family count. Measure on the pair family only.
* A ball and box with several lumps in the result (a slab through the middle). Refuse; `cut_pinches`-style detection already exists for
  the point-touch cases.
