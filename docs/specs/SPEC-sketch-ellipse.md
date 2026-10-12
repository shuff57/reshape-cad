# SPEC: the ellipse in the sketcher (FreeCAD Sketcher S2, and what S3 needs)

Status: MEASURED, design proposed, NOT implemented.
Source: `freecad-probes/probe_s2_ellipse.py` (output `probe_s2_ellipse.json`), FreeCAD 26.3.0 RC1 headless.
Clean-room: measured outputs only.

## Measured behaviour

| # | Fact |
|---|---|
| E1 | A lone ellipse has DoF 5: centre (2), major radius, minor radius, rotation of the major axis. |
| E2 | `AngleXU` is the major axis's angle from +x (radians); `Focus1` is centre + sqrt(a^2-b^2) along it. `getPoint(e, 3)` is the centre; 1 and 2 both return the point at parameter 0 (the major vertex). |
| E3 | Constraints that APPLY (status 0, DoF falls): coincident point-to-centre (7 -> 5), pointOnObject point-on-ellipse (7 -> 6), tangent line-to-ellipse (9 -> 8), equal ellipse-to-ellipse (10 -> 8: BOTH radii), block (5 -> 0), distanceX/Y of the centre (5 -> 4), distance centre-to-point (7 -> 6). |
| E4 | Constraints FreeCAD ACCEPTS but marks MALFORMED (status -5, `MalformedConstraints` = [1], DoF unchanged, not applied): radius, diameter, horizontal, vertical, angle on an ellipse; tangent circle-to-ellipse; tangent ellipse-to-ellipse; equal ellipse-to-circle. |
| E5 | An ellipse is dimensioned through INTERNAL GEOMETRY. `exposeInternalGeometry(e)` adds 4 construction objects (major-diameter line, minor-diameter line, two focus points) tied by 4 `InternalAlignment` rules; DoF stays 5 because they are fully determined. |
| E6 | A distance rule on the major line (24) and the minor line (8) sets major radius 12 and minor radius 4 and takes DoF 5 -> 3. The centre stays free. |
| E7 | An arc of an ellipse has DoF 7 (the ellipse's 5 plus two end parameters); points 1 = start, 2 = end, 3 = centre; `exposeInternalGeometry` adds the same four objects (geometry count 1 -> 5), DoF stays 7. |
| E8 | A Pad of a whole ellipse (a 10 x 5 at length 4) is valid, volume 628.3185307 = pi*a*b*h exactly, 3 faces: one SurfaceOfExtrusion (the elliptic wall) and two planes. |

## Design for brep-rs (proposed)

Geometry. `GeoKind::Ellipse`, five slots: centre `c` (2), focus-1 point `f1` (2), minor radius `b` (1). Major
radius is derived, `a = sqrt(b^2 + |f1 - c|^2)`, so `a >= b` holds by construction and every slot is a length
(the layer's one invariant). This is the foci parametrisation the other sketch kinds' "lengths only" rule
asks for; no angle variable, no branch cut. Point refs: `c` is the centre, `a` is focus 1, `b` is focus 2
(derived, `2c - f1`), so coincident, distance, distanceX/Y and symmetric work through the existing
point-ref machinery.

Residuals, all lengths:
- pointOnObject, point `p` on the ellipse: `|p - f1| + |p - f2| - 2a`.
- tangent, line to ellipse: with `d1, d2` the foci's signed distances to the line, tangency is
  `d1*d2 = b^2`; the length-valued form `(d1*d2 - b^2) / (sqrt(|d1*d2|) + b)` has the same zero set and is
  smooth through zero.
- equal, ellipse to ellipse: TWO rows, `a1 - a2` and `b1 - b2` (E3). `rows()` for `equal` then depends on
  its argument kinds, which it does not today.
- E4 kinds are refused at open in a sentence, naming the kind and saying an ellipse is sized through its axes.

Arcs of an ellipse need two more slots (end points) with on-curve rows, as the circular arc has.

## The decision this needs (NOT mine to make alone)

How is an ellipse SIZED? FreeCAD does it through internal geometry (E5, E6): four extra construction objects
per ellipse. brep-rs has a 16-kind rule vocabulary and the studio has no concept of internal alignment.

- (A) FreeCAD-faithful: add internal geometry + an internal-alignment rule. Most faithful, heaviest; the studio
  must draw and pick the extra construction objects. Needs a schema change (rule kind + geometry rows).
- (B) Two new dimension kinds, `majorRadius` and `minorRadius`, each one residual on the derived `a` and on
  `b`. Same expressive power for sizing, no extra geometry; a schema change of two kinds.
- (C) Ship ellipse with NO size rule: an ellipse is sized by its seed and by points on it (E3). Smallest, but a
  student cannot type "major radius 12".

Recommendation: (B). It keeps one geometry per ellipse, needs no new studio drawing concept, and the kernel
stores exactly the numbers FreeCAD's axis dimensions end up setting (E6). Either A or B touches the rule
vocabulary, which lives in `packages/script` (the other agent's area).

## What S3 (an ellipse as a solid) needs that does not exist

`geom::Surface` has Plane, Cylinder, Cone, Sphere, Torus; `Curve::Ellipse` exists (rim corners). A pad of an
ellipse (E8) needs an ELLIPTIC CYLINDER surface: area, volume integrand, tessellation, STEP
(`CYLINDRICAL_SURFACE` is circular; STEP has no elliptic cylinder, FreeCAD writes a surface of extrusion), and
a `flip_face` arm. That is a kernel change across `geom`, `mesh`, `step` and the boolean paths, and is its
own roadmap item.
