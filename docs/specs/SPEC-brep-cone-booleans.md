# SPEC: cone booleans (W3 of PLAN-kernel-next-2026-10-05.md)

Status: S0 built 2026-10-06; S1 onward not started. Parent: `SPEC-brep-kernel-rs.md` section 4.5. Precedent: `SPEC-brep-ball-box.md`
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

Before S1, repeat the pre-check on the genuine 63: how many are a box face that cuts the cone square to its axis (a circle, which the
kernel already carries), and how many cross the lateral surface at an angle (a real conic).

## Never a wrong solid

Same guards as every boolean: edge-use counts, translation invariance, closed mesh, inclusion-exclusion with the partner operation,
and an independent volume. S0 adds none of its own because it builds nothing new: it copies an operand. Its risk is a false "apart" or
"inside", which is why both are proved with closed forms and fuzzed against sampled points.
