# SPEC: a ball against a box, any orientation (W2 of PLAN-kernel-next-2026-10-05.md)

Status: S1 to S3 built 2026-10-05; S4a (ball x ball) built 2026-10-06; S4b (ball x cylinder, the quartic) not started. Parent: `SPEC-brep-kernel-rs.md` section 4.5, `SPEC-brep-combine-sphere.md`
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
* **S2 + S3 RESULT (done):** `ball_box::assemble` builds all four operations (`keep`, ball minus box, `join`, box minus ball) in either
  operand order. New pieces: rectangle-minus-disk faces (the rectangle's outside stretches joined by the plane's region arcs traversed the
  other way, a whole circle inside the rectangle as a hole wire), `HullTrim::reversed` for the cavity wall of box minus ball, and a
  lump count that treats the sphere face as one piece per loop when Gauss-Bonnet says it is several (`Region::sphere_components`: chi
  from area, boundary geodesic curvature and exterior angles, pieces = (chi + loops) / 2). A slab through the ball (ball minus box:
  two caps) and a rod through it (box minus ball: two stubs) refuse; their connected twins build. 90 random boxes x 4 operations: 87 of 87
  build for each, worst volume error 1.8e-13 of the larger volume. Pair family: 773 to 789 agree, 0 wrong. Full census: 0 wrong, agree
  5,324 (was 5,253 at the start of the session), refused 7,908 (was 7,977); gates 78/78/77+1/17.
  One existing test, `sphere_minus_box_poking_out_at_the_corners_is_not_a_sealed_void`, asserted only a margin from the wrong figure;
  the true answer is 0.4 above it, so it now compares against the independent overlap volume and a single shell.
* **S4 NOT DONE:** the cylinder against the ball and ball against ball (the plan's (c) and (d), 80 of the sweep's gaps). A cylinder wall meets a
  sphere in a quartic, a curve the kernel has only for the coaxial and bore cases; it needs its own spec, not an extension of this one.
* **S4 PRE-CHECK (2026-10-06, pair family seed 1, 1,500 scripts, 710 refused, OCCT volume > 1e-6 = real gap):** the "80 gaps" are two
  different problems and the spec above lumped them wrongly. **Ball x ball is NOT a quartic**: two spheres meet in a circle in the radical
  plane, so each ball's kept part is a `Hull` of ONE half-space; no new curve. It is only 7 scripts (4 crossing, 3 nested, 1 of them a
  disjoint `join` that is an honest two-lump refusal). **CORRECTION, same day:** `sphere(x)` in a script is a DIAMETER; the counts in this
  paragraph used it as a radius. Re-measured from the parsed docs: every CROSSING ball pair in the sweep now builds (see S4a); what is
  left is 5 `join`s of balls that do not touch (honest two-lump refusals), 14 empty `keep`s, 24 same-ball `cut`s (honest empties), and one
  nested `keep` (the smaller ball; not built). The ball x cylinder count of 73 stands (it was measured from the docs: axis offset > 0).
  **Ball x cylinder is the quartic, and it is the bigger bucket: 73 scripts** (join 42, cut 23, the rest keep), every one with the
  cylinder axis OFFSET from the ball centre (69 by more than 1 unit; 4 by under 1); none is coaxial (coaxial is already built). The
  cylinder is always z-aligned in these scripts. Not yet measured: how many of the 73 are single-lump, and how many are tangent or graze.
  Method: `docs/specs/prototypes/census/run-sweep.sh` pair family + `pair-empties.mjs`, then bucket by operand kinds and axis offset.
* **S4a RESULT (done 2026-10-06, `ball_box::ball_ball`):** two crossing balls build for intersect, union and both subtractions. The two
  spheres meet in one circle in the radical plane, so each ball's face is a `Hull` of ONE half-space (the side of that plane); no new
  curve, no new trim. Both faces use one seam direction (square to the centre line) so the circle is one welded edge. Checked against
  the closed-form lens volume, edge-use counts, translation invariance and a closed mesh; test `two_crossing_balls_build_all_operations`
  (60 random pairs x 4 operations, all build, volume error < 1e-9). Nested, apart, tangent and concentric balls return `None` (no
  crossing circle), keeping their existing sentences. Pair family: 789 to 790 agree, 0 wrong (a small gain: crossing balls were rare).
  cargo test 509, gates 78/78/77+1/17.
* **S4b PRE-STEP RESULT (done 2026-10-06, `ball_box::provably_apart`):** the 73 ball x cylinder "gaps" were not all the quartic. The pair
  generator places a ball 0.1 to 0.3 clear of a cylinder, so the bounding boxes overlap while the solids do not; the face-by-face path
  cannot see past that and refused. `provably_apart` is exact (the centre's distance to the other ball, cylinder or cuboid against the
  radius, with a 1e-7 margin), is used by `solids_provably_disjoint` (so an empty `intersect` now says "do not overlap"), and
  short-circuits `subtract` (the part unchanged) and `union` (two shells side by side, as boxes already did) in `boolean_unchecked`.
  Test `a_ball_leaning_into_a_cylinders_box_without_touching_it` uses the sweep's own numbers and also checks a ball 0.02 inside
  contact is NOT claimed apart. Pair family 790 to 830 agree, 0 wrong. Full census (15,000 scripts): no WRONG record for brep-rs,
  agree 5,390 (was 5,324), refused 7,842 (was 7,908). cargo test 510, gates 78/78/77+1/17.
  **S4b RE-BUCKET (same day, pair family after the pre-step, 669 refused):** ball x cylinder refusals that are real gaps (OCCT volume
  > 0) are **38, not 73**. Footprints overlapping the ball's silhouette: 28 where the cylinder wall STRADDLES it (union 14, cut 8, keep 6;
  the hard case, the existing `SphCyl` only covers a wall wholly inside the silhouette) and 10 where the wall is inside it but an end
  is inside the ball (a stub: union 7, keep 2, cut 1). A further 35 are honest empty `intersect`s that now carry the "do not overlap"
  sentence. 38 of 1,500 is 2.5% of a synthetic family whose sizes the plan already calls unrealistic. **Recommendation: do not build
  the straddling quartic now**; it needs the quartic trimmed by both end planes plus the silhouette, for a few scripts. The 10 stubs
  are the only cheap part, and they too need the quartic cut at the end plane. Revisit only if a real student part needs it.
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
