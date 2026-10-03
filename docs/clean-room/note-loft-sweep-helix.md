# Design note R-2: loft of circles, general loft, path sweep, helix and pipe

Reader role, 2026-10-02. Prose and plain maths only. Written to be implemented without ever seeing the sources.

## 1. The problem as our kernel sees it

Our surfaces are plane, cylinder, cone, sphere and torus (the last two with restricted parameter ranges); our curves are
segment, full circle and circular arc. The existing blend takes two outlines with the same count of straight sides, in
two planes, and joins corresponding sides with planar quads. It refuses everything else with one sentence, including any
circle section. Nothing in the kernel can carry a sweep along a bent path, a helix, or an interpolated loft.

What each shape needs:
- **Loft between circles.** Two caps (planes), one side face, two rim edges. A full circle is one closed edge, so the side
  face is a single periodic strip with one seam edge joining the two rim start points. The surface is periodic in the
  angle; the seam is a straight generator line, and both rims must start at the same angle or the generators twist.
- **General loft.** Side faces are free-form (spline) patches between arbitrary sections: needs a spline surface type, a
  spline edge type, and surface intersection support for later booleans. We have none.
- **Sweep.** Along a straight path, a circle gives a cylinder (exists). Along a circular path, a circle gives a torus
  piece (torus exists, restricted tube range). Along anything else, the wall is a free-form surface.
- **Helix / pipe.** The helix is a new curve (not a conic, not rational). A pipe around it has a side wall that is none of
  our five surfaces. Topology: two end caps (planes perpendicular to the path tangent), two rims, one wall, one seam
  running along the whole path.

## 2. How the foreign designs decompose each case

**Circular sections.** One design stores a circle as a single closed rational curve; the other requires every section to
have at least two curves and refuses a lone circle with a plain one-line message (a circle must be split into arcs
first). Splitting a circle into two or four arcs gives well-conditioned seam handling and lets sections with different
arc counts be reconciled by cutting at shared parameters. The exact representation of an arc is a rational quadratic
(weights are cosines of half the arc angle), valid up to a quarter turn per piece in the sturdier form.

**Reconciling sections.** Before joining, all sections are made compatible: split every curve into polynomial pieces by
inserting knots, raise all pieces to the highest degree, and cut every section at the union of all parameter breaks so
that piece counts match. Then the loop direction is aligned (try both directions, and every rotation of the start point
at section breaks, choosing the one minimising summed squared distance to the previous section after rigidly carrying it
onto the previous plane; a couple of dozen sample points suffice). A rational curve may be reparametrised projectively, so
end weights are normalised to make neighbouring pieces comparable. Sections of different shape (square to circle)
therefore work only through splitting; the match is by parameter fraction of perimeter, not by geometric nearness.

**Ruled versus interpolated.** With two sections, ruled means straight generator lines between corresponding points:
for each homogeneous control point, interpolate linearly. With three or more sections, a smooth loft interpolates
through section control points (chord-length parameter, cubic by default, clamped by tangent magnitudes at the ends, or a
draft angle, or end-normal constraints). Optional guide rails or a path are additional constraints that must cross every
section in order. Points are allowed only as first or last section (cone tip).

**Analytic detection.** The general-loft design checks for the special case first: two untwisted circles whose centres lie
on a common normal to both planes and whose planes are parallel, with aligned seams and proportional control data. It then
discards the spline result and builds a plain revolved profile (a straight line revolved), i.e. a true cone or cylinder
with circular cap edges kept. Anything else (offset centres, tilted planes, twisted seams, three sections) stays a
spline skin.

**Sweep frames.** One design samples the path densely and propagates a rotation-minimising frame (parallel transport by
small rotations, a two-reflection scheme, so the frame does not flip at inflections the way the Frenet frame does); an
optional "bank" mode follows the curvature frame instead. Another uses Frenet frames only (simple, flips at inflections
and is undefined on straight stretches). A closed path accumulates a net twist (holonomy) which must be distributed
evenly as a counter-twist or refused. Twist and scale can vary linearly with arc length. Polyline paths mitre each joint
on the bisector plane. Straight and circular paths with a circle section are special-cased to analytic surfaces.

**Helix.** Parametrised by angle t: radius r(t) varying linearly from start to end radius, height rising linearly with t,
so point = centre + r(t)(cos t, ± sin t) in the base frame plus axis times pitch*t/(2π). Handedness is the sign.
Pitch and turns are linked by height = pitch*turns. Both designs convert it to a cubic spline sampled several segments
per turn (a handful with analytic tangents, or many by fitting): an approximation, not exact. One design also
records the helix axis so that a sweep along it is a screw motion rather than a transported frame.

**End caps.** Planar faces bounded by the first and last rim; holes need loops. Open sections give sheets, not solids.
Orientation is propagated across the strip consistently, not guessed from a centroid, because concave sections fool the
centroid test. Guards: a solid whose signed volume Jacobian changes sign (self-folded wall) is refused; a bend tighter
than the section's reach (section radius times curvature at or above one) is refused by name; folds near 180 degrees at
a corner are refused; an invalid, zero-length or reversing path is refused; adjacent patches disagreeing along a shared
rail is refused instead of returned. Loft messages (paraphrased): needs two sections; closed loft needs more sections;
sections must have matching open/closed state and hole counts; adjacent sections coincide; guides must cross every section
in order; choose guides or a path, not both.

## 3. Accuracy

EXACT: ruled between coaxial parallel circles (cone or cylinder); sweep of a circle along a straight line (cylinder);
sweep of a circle along a circle in the plane containing the axis direction (torus piece, or a sphere when the path
radius is zero); any revolve. Rational quadratic arcs reproduce circles exactly, so even the spline route is exact for a
*ruled* loft between two circles that fail the coaxial test (it yields an oblique cone/cylinder, a legitimate quadric
whose cross section perpendicular to its axis is an ellipse, which we do not model). APPROXIMATE: smooth interpolated lofts
(a fit; section curves are hit exactly but the skin between is a choice, not a unique shape); any sweep along a general path
(fitted patches, accepted at a tolerance relative to model extent); the helix (transcendental, so only fitted); any pipe
around it. Under our no-approximation rule only the EXACT group is admissible. The rest must stay refused until we have a
surface type whose equation is the real shape (helical sweep surfaces are exactly parametrisable even though not rational).

## 4. Proposed incremental plan in our terms

1. **Circle-to-circle ruled loft, coaxial parallel planes, aligned seams** to our cone surface (cylinder when radii are
   equal). Two caps, one wall, one seam; apex case (radius zero) already exists as our cone primitive. Reuse revolve of a
   line. Refuse non-coaxial, tilted, or three-section circle lofts with: "brep-rs can only blend two coaxial circles
   of the same axis yet" (new sentence), keeping the existing sentence for mismatched straight outlines.
2. **Circle swept along a straight line or circular arc** perpendicular to the section: cylinder / torus piece.
   Refuse every other path with a sentence naming the path kind ("sweeping along a curved path is not supported yet").
3. **Mixed curved and straight outlines with the same side count** (rounded rectangle to rounded rectangle at same
   scale): each side pair is straight-straight (plane), arc-arc coaxial (cone or cylinder). Defer.
4. **Helix and pipe**: needs a new curve (axis, radius, pitch, turns, handedness) and a new wall surface. Do not start
   until the lead accepts a new surface variant across mesh, measure, STEP export and booleans; a decision, not a task.
   Until then refuse: "brep-rs cannot build a helix or a pipe along it yet".
5. **General loft/free-form sweep**: no. Refuse per feature; do not approximate.

Fixtures (closed-form, derive from our own spec): frustum r1=3, r2=1, h=6 gives volume 26π; equal radii r=2, h=5 gives
20π (cylinder); r1=2, r2=0, h=6 gives a cone, π·r²·h/3 = 8π; circle r=1 swept along a quarter circle of radius 4 gives
2π² (area × centroid path length); a straight-swept circle r=2, length 5 gives 20π. Pipe on a helix with tube r, helix
radius R, pitch p, turns n (no self-overlap, r below the radius of curvature (R²+(p/2π)²)/R): volume π·r²·n·sqrt((2πR)²+p²).
Refusal fixtures: offset-centre circles; tilted circle sections; three circle sections; a twisted seam (aligned versus
a half-turn offset gives different faces, expect either a correct twisted refusal or a rotated seam, never a wrong solid).

## 5. Licence note

Read 2026-10-02: the MPL-2.0 kernel crate (loft, sweep, helix areas), the custom-licence mmiscool kernel (loft, sweep,
helix areas) and the MIT curvo library (loft, sweep, revolve areas). Nothing was copied, no code, names or constants were
transcribed; all text above is the reader's own paraphrase and own derivations.
