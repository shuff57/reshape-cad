# SPEC: cone booleans (W3 of PLAN-kernel-next-2026-10-05.md)

Status: S0 built 2026-10-06; S1a (`keep(cone, box)`, exact) and its STEP export built 2026-10-07; join / cut of a cone with a box not started. Parent: `SPEC-brep-kernel-rs.md` section 4.5. Precedent: `SPEC-brep-ball-box.md`
(the sphere track: its pre-check found that a third of the "gaps" needed no curve at all).

## Pre-check (2026-10-06, pair family seed 1, 1,500 scripts, after the sphere work; 669 refused)

Cone gaps that are real (OpenCascade's volume > 0): **268**. Classified by whether the result is one operand or their sum (a cut that
misses, a join of bodies that are apart, a body inside another) or neither:

| Pair | needs no curve | genuine |
|---|---|---|
| cone + sphere | 60 (cut misses 26, join apart 27, keep inside 5, join inside 2) | 45 |
| cone + box | 18 (cut misses 9, join apart 9) | 63 |
| cone + cylinder | 13 (keep inside 5, join inside 7, join apart 1) | 49 |
| cone + cone | 8 (cut misses 4, join apart 3, join inside 1) | 12 |
| total | **99** | **169** |

(`sphere(x)`, `cone(x, h)`, `cylinder(x, h)` take a DIAMETER in scripts; the doc stores the radius. The classification reads the parsed
doc, not the script text.) A further 104 refusals are honest empties (an `intersect` of bodies that do not overlap, a cut of a shape
from itself).

## S0: bodies that are apart or inside one another (built)

A ball, a plain cylinder, a cuboid and a whole cone are all convex, which is what makes the two questions decidable exactly:

* **Apart**: a plane separates them. GJK on the Minkowski difference proposes a direction; the support functions of the two bodies
  then PROVE it (`min over A of n.x - max over B of n.x > 1e-7 * size`). A wrong direction can only make the answer `false`.
* **Inside**: every extreme feature of A (box corners, a cone's apex and base circle, a cylinder's two end circles, a whole ball) is
  inside B by a margin. A cylinder container is two half-spaces and a radial bound, a cone container is its base half-space and the
  signed distance to its generating line (`g = (H rho + r t - r H) / slant <= 0`), a ball container is a distance, a box container is six
  support values. A circle not square to a cylinder or cone container's axis is NOT proved (answer `false`).

Result when at least one body is a whole cone (`convex_pair::trivial`, called first in `boolean_unchecked`): apart gives the part
unchanged for `subtract` and two shells side by side for `union`; A inside B gives B for `union` and A for `intersect` (and the
mirror). Everything else, including a cut of a body that lies inside the other (a cavity), is left to the existing paths. Apart is also
used by `solids_provably_disjoint`, so an empty `intersect` says "do not overlap". Tests: a fuzz that checks every claim of apart or
inside against sampled points of the two bodies (and that the claims are made often enough to mean something), and the sweep's own
near-miss geometry through the public boolean.

**S0 result**: pair family 830 to 921 agree (the pre-check predicted 99; 91 landed), 0 wrong; cargo test 512; gates 78/78/77+1/17.

## What is left: the 169 that need a curve

Cone x plane is a conic (ellipse, parabola or hyperbola by the plane's angle), cone x cylinder and cone x sphere are quartics, cone x
cone is a quartic. The order that follows the pre-check, cheapest first:

1. **Cone x box (63).** Planes only: conics. A box face cut by a cone is a polygon with elliptic/hyperbolic arcs; the cone face is
   bounded by those arcs and the box's edges meeting it. This is the ball-box track again with a conic in place of a circle, and
   `ball_box.rs` (region loops by arcs joined at corners, rectangle-minus-region faces) is the template. It needs a `Curve` variant for
   a conic arc (or a fitted spline with an exact test, as STEP does) and a cone-trim representation like `HullTrim`.
2. **Cone x sphere (45), cone x cylinder (49), cone x cone (12).** Quartics. Do not start these before S1 shows the conic machinery
   holds; re-bucket first, because the sphere track's quartic (ball x cylinder) shrank from 73 to 38 once near-misses were removed,
   and the survivors were mostly cases a real student would not draw.

## Cone x box pre-check (2026-10-06, pair family after S0: 68 refused with a real result)

Every box in the sweep is axis-aligned and every cone stands on z, so every box plane is either SQUARE to the cone's axis (a circle on
the cone, which the kernel already carries) or PARALLEL to it (a hyperbola, or two straight generators when the plane passes through the
axis). There is never an ellipse or a parabola: those need a plane tilted to the axis, which the generator does not make.

| Planes of the box that cut the cone's slanted face | Scripts |
|---|---|
| none sideways, only z-faces (circles only) | 14 (intersect 7, cut 1, join 6) |
| one or more vertical planes (a hyperbola each) | 52 |
| no overlap in height | 2 |

So the dominant case is a NEW curve, but a simple one with a closed form: in the plane at distance d from the axis the cone meets it
where `y^2 = w(z)^2 - d^2`, `w(z) = (R / H)(H - z)`, i.e. `w = d cosh s`, `y = d sinh s`. S1 is therefore bounded to a **box that has
a face square to the cone's axis** (the box need not be at any other angle), which covers all 68, and leaves tilted boxes (ellipses,
parabolas) refused with their present sentence.

### S1 sketch (not started)

* `Curve` variant for a hyperbola arc on a vertical plane (point, derivative, length, bbox, transform, STEP by fitted spline), plus the
  circle that already exists for the z-faces.
* A cone face trimmed by up to six half-spaces (the `HullTrim` idea for a cone). A cone unrolls to a flat sector, so its mesher can work
  in the unrolled plane from the boundary polylines: no spherical-hull mesher is needed.
* Planar pieces: z-faces are rectangle (intersect or minus) a disk of radius `w(z)` about the axis, built by the `ball_box.rs`
  region/rectangle machinery with a different circle; vertical faces are rectangle (intersect or minus) the region under a hyperbola.
* Lump check: Gauss-Bonnet as in ball x box does not apply as is (a cone is flat); count lumps from the loops, and refuse a result in
  more than one lump (a box through the cone's middle can split it).
* Oracle: an independent numerical volume (integrate the cone's cross-section clipped by the box over z) that shares no algebra.
* Risk to measure first, as P0 did for the hull mesher: that the unrolled-sector mesh of a region bounded by hyperbola arcs closes
  against the planar faces' meshes along the shared arcs (edges sampled once, shared by handle).

## Never a wrong solid

Same guards as every boolean: edge-use counts, translation invariance, closed mesh, inclusion-exclusion with the partner operation,
and an independent volume. S0 adds none of its own because it builds nothing new: it copies an operand. Its risk is a false "apart" or
"inside", which is why both are proved with closed forms and fuzzed against sampled points.

### P0 RESULT (done 2026-10-06, `cone_box.rs`, no kernel edits)

The stop rule passes. For a cone and a box with a face square to its axis, the slanted face of `cone AND box` is a **ladder of columns**
(a lower and an upper point per angle theta; the cone's generators are straight, so no interior points are needed) and every plane face is the
**convex hull of the vertices on its plane** (the result is convex). On 2,066 random cone and box pairs (full-turn cases 336, boxes
holding the apex 265, boxes cutting the base 739) every mesh is closed and consistently wound, with a volume within 7e-6 of the cone's
volume of an independent integral (`disk_rect_area` over z), and doubling the lattice shrinks the error.

Three things the prototype taught that the sketch above did not have:

1. **Event angles must be computed, not found by bisection.** Where the binding bound on the generator changes, or the interval opens or
   closes, is where two bounds on `w` are equal: `x/cos = W`, `y/sin = W`, `X/cos = Y/sin`, plus the angles where a plane through the axis
   changes sides. Bisecting between lattice samples missed a second event inside one cell (a top plane meeting a hyperbola, then a pinch
   a hair later) and left a gap. With the analytic list, each cell between consecutive stations is wholly empty or wholly non-empty, so
   one test at its middle decides it.
2. **One degeneracy rule for every face.** The ladder dropped triangles under an area tolerance while the hull dropped collinear points
   under a different one; three points on a circle arc 2e-4 apart were a triangle in one and a line in the other, an open triangle. Drop
   only what is exactly degenerate, the same way on both sides.
3. **A result may have no slanted face at all** (a box wholly inside the cone's side, cut only by the base): that is a clipped box, not a
   refusal.

Not tested here, and still the work of S1 proper: exact curves (the prototype samples the hyperbola at lattice angles and joins faces by
position, where the kernel needs a `Curve` variant whose edges are shared by handle), the `Cone` trim carried on the face, the
outside operations (cone minus box, box minus cone, join: the plane faces are no longer convex, a face can be several pieces, and the
result can be several lumps), STEP export, and the sentences for refusals.

## S1a RESULT (built 2026-10-07): `keep(cone, box)`, exact, `cone_keep.rs`

Built for a box with a face square to the cone's axis (every script box against a cone standing on z, a box turned about z too).

* **Curve**: `Curve::Hyperbola { c, p, q, s0, s1 }`, `p(s) = c + cosh(s) p + sinh(s) q`, an open arc (point, derivative, length, box, centroid, transform; sampled for the mesher). `Cone::bounded` marks a cone face that is only the part its wires enclose.
* **Faces**: the box's z-faces are `ball_box.rs`'s rectangle-meets-disk (a disk of the cone's radius at that height); the vertical faces are a rectangle meeting the region under the hyperbola, built in `vertical_loop`. The cone's own face is NOT described: it is the edges the plane faces use once, chained into loops, so it cannot disagree with its neighbours. One loop round the axis (or two, for a frustum) is one face, every other loop its own face.
* **Measures from the wires** (`build::bounded_cone_measure`): a cone develops onto a flat sector, so area `= (1/sin a) (1/2) loop (x dy - y dx)`, the centroid and the volume term (`apex . vector area`, because `p . n = apex . n` along a generator) are closed forms. The box of a face holding the apex in its middle needs the apex added (`bounded_cone_holds_apex`): a fuzz against the mesh found that.
* **Mesh**: every rim edge of a bounded cone is sampled at one lattice of angles about the axis (`cone_lattice_polylines`), and the face is zipped between its two rim chains (fanned from the apex where it is in the face). Sampling each rim at its own spacing made fans that lay flat on the box plane next door and doubled its triangles.
* **Checks**: every edge used twice, one lump, the divergence volume against an independent cross-section integral (2e-6 of the cone), origin-free volume, a closed mesh, and the volume unchanged on moving into place. A pair outside what the construction handles (tilted box, a corner on the cone, a plane nearly tangent) refuses; a box exactly as wide as the base, which touches the base circle at points, builds.
* **After it**: move and turn work; every other operation on the part refuses (`ops::has_cut_cone`, and a sentence in `wasm.rs`); STEP is written (below). The builder is tried LAST in `boolean_legacy`, so the coaxial path (planes square to the axis only), which writes STEP, keeps what it already built.

Tests: cargo 522 (random 783 crossings, 774 built, 0 wrong, the other 9 a box holding the whole cone; 2,197 boxes snapped to awkward values, 1,461 built, 0 wrong; whole pairs moved and turned through the public boolean); `packages/kernel/test/cone-box-keep.test.mjs` (66 of 90 random scripts built, volume against OpenCascade to 1e-9 relative, 24 empty; bounding box; watertight meshes at two tolerances). Pair family: 921 to 953 agree (the pre-check predicted 32), 0 wrong; gates 78/78/78/17.

Next: join and cut of a cone with a box (non-convex faces, several lumps; 23 + 13 pair scripts).

### STEP export (built 2026-10-07)

A hyperbola arc has no STEP primitive, so it is written as the clamped cubic B-spline `fit_closed_curve` already fits for the bore curves, generalised to an OPEN arc (`fit_curve`: each end keeps its own exact tangent; the fit is checked against the exact curve to 1e-7 of the part's size or the file is refused). The cone face is written from its own wires, as the cross-bored cylinder is; the loops are wound by the existing area rule. OpenCascade reads every kind back correctly, which the sphere track's faces did not (they needed a chosen frame and a refusal class): 904 random scripts read back as the same valid solid (volume and box), 0 wrong, 0 refused; and the awkward classes, each moved and turned too (a frustum cut sideways, the apex on the boundary, a half through the axis, a thin slab through the axis giving two strips, the apex inside the box, a box exactly as wide as the base, a box turned about the axis): `packages/kernel/test/step-cone-box.test.mjs`.
