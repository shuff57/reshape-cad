# SPEC: the ellipse in the sketcher (FreeCAD Sketcher S2, and what S3 needs)

Status: IMPLEMENTED in `41f4bac` (sketcher half, option B). Not implemented: S3, the ellipse as a solid.
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

## Decision: option B (taken)

An ellipse is sized by two new dimension kinds, `majorRadius` and `minorRadius`: one geometry per ellipse, no
internal-alignment objects. Both may be reference rules (`driving: false`). `radius` and `diameter` on an
ellipse refuse in a sentence that names them, where FreeCAD marks them malformed (E4).

## What landed (`packages/brep-rs/src/sketch/`)

- Geometry row: `{"id", "k":"ellipse", "c":[x,y], "major":a, "minor":b, "angle":degrees}` (angle optional,
  default 0; minor > major is stored as the same curve with the axis turned a quarter). Slots: centre,
  first focus, minor radius. Point refs: `c` = centre, `a` = first focus; the second focus is derived.
- Rules: `coincident`/`distance`/`distanceX`/`distanceY` on `c` or `a`; `pointOnObject` of a point on the
  ellipse; `tangent` line-to-ellipse (signed by `side`, as for a circle); `equal` ellipse-to-ellipse (two rows);
  `majorRadius`, `minorRadius`.
- Refused in a sentence: radius, diameter, and tangent/equal of an ellipse with a circle or another ellipse
  (FreeCAD: malformed). `horizontal`, `vertical` and `angle` on an ellipse refuse because an ellipse has no
  two ends.
- A sketch with an ellipse that is not construction geometry refuses as a PROFILE until S3.
- Verified against FreeCAD's DoF facts E1, E3, E6 (tests `ellipse_tests`) and against central differences.

## Not done
- Arc of an ellipse (E7): two more slots and on-curve rows, and the end-point parameterisation.
- The ellipse as a solid (S3, below), and the ellipse in `packages/script` / the studio.

## What S3 (an ellipse as a solid) needs that does not exist

`geom::Surface` has Plane, Cylinder, Cone, Sphere, Torus; `Curve::Ellipse` exists (rim corners). A pad of an
ellipse (E8) needs an ELLIPTIC CYLINDER surface: area, volume integrand, tessellation, STEP
(`CYLINDRICAL_SURFACE` is circular; STEP has no elliptic cylinder, FreeCAD writes a surface of extrusion), and
a `flip_face` arm. That is a kernel change across `geom`, `mesh`, `step` and the boolean paths, and is its
own roadmap item.
