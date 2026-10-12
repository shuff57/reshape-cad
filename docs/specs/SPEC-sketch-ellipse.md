# SPEC: the ellipse in the sketcher (FreeCAD Sketcher S2, and what S3 needs)

Status: IMPLEMENTED. Sketcher half (option B) in `41f4bac` (the ellipse) and `92acd93` (the arc of an
ellipse); S3, the ellipse as a solid, in `99f1e82` (whole ellipse) and `0633d28` (arcs of an ellipse).
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

## The arc of an ellipse (`probe_s2b_ellipse_arc.py`)

| # | Fact |
|---|---|
| A1 | DoF 7 on its own. Points: 1 = start, 2 = end, 3 = centre. Internal geometry adds the same four objects. |
| A2 | coincident of an end or the centre with a point: 9 -> 7. Of an end with a line end: 11 -> 9. |
| A3 | pointOnObject: 9 -> 8, and a point OUTSIDE the sweep re-fits the arc onto the whole ellipse (same as a circular arc). |
| A4 | tangent line to arc along the edge: 11 -> 10. Line end to arc end (coincident + tangent): 11 -> 8. |
| A5 | tangent arc-to-ellipse and arc-to-arc along the edge: MALFORMED (-5). |
| A6 | equal arc-to-ellipse 12 -> 10, arc-to-arc 14 -> 12 (both radii). |
| A7 | radius and horizontal on the arc: MALFORMED. distance start-to-end: 7 -> 6. |
| A8 | Axis lines dimensioned 24 and 8: major 12, minor 4, DoF 7 -> 5. |
| A9 | A Pad of a half ellipse closed by a line is valid at pi*a*b*h/2 = 314.159, 4 faces. |

brep-rs: `GeoKind::EllipseArc`, nine slots `cx cy fx fy b ax ay bx by`, two internal on-curve rows. Point refs
`c` centre, `a` start, `b` end (the focus is not addressable). Endpoint tangency is defined against a line
only, as `S*(d.n)/(|d||n|)` with `n` the sum of the unit focal vectors at the shared end; any other endpoint
tangency refuses in a sentence. Rows: `{"id","k":"ellipseArc","c","major","minor","angle"?,"a":[x,y],"b":[x,y],"sense"?}`.

## Not done
- Endpoint tangency between an elliptic arc and a circular arc or another elliptic arc.
- The ellipse as a solid (S3, below), and the ellipse in `packages/script` / the studio.

## S3: the ellipse as a solid (landed) -- `freecad-probes/probe_s3_ellipse_solid.py`

FreeCAD measured: pad of 10 x 5 ellipse, h 4: 628.3185 = pi a b h, 3 faces. A D-shape (half ellipse closed by its
chord), h 4: 314.159, 4 faces. An ellipse hole in a 40 x 25 plate, h 6: 5321.416, 7 faces. Blind pocket 4 deep in a
40 x 30 x 10 block: 11371.681, 8 faces. Through pocket: 11246.027, 7 faces. All reproduced exactly.

What exists in brep-rs:
- `geom::EllipticCylinder` (semi-axes a, b along e1, e2; u is the eccentric angle; orientation lives in the frame,
  as for the circular cylinder; arc range for a partial wall). Exact tight box; area and centroid by composite
  quadrature because the 16-point rule is not accurate for the elliptic area element on an eccentric ellipse.
- `ProfileSeg::Ellipse` / `WireSeg::Ellipse`. A whole ellipse is its own candidate loop (two half arcs, built as ONE
  wall with shared rims, like a circle). An elliptic arc is a curve of the planner's graph like any other arc:
  tangent, curvature, parameter and area are closed form; crossings and contacts against anything use sampled
  polylines, which only makes them more cautious.
- Pad, and an ellipse hole inside an outline, through the ordinary prism builder.
- Pocket: `interior_pocket::cut_interior`, by topology alone (no surface is intersected). The tool is rebuilt as an
  exact fit, the entry face is replaced by one with the mouth as a hole, the tool's walls are flipped to face the
  cavity, and a blind floor is added (or a matching hole on the exit face for a through cut).

What refuses, in a sentence:
- every boolean against an elliptic wall (`ops::extract` reads only planes, circular cylinders and surfaces of
  revolution), so a union, subtract or intersect with a part that has one;
- a pocket whose mouth is not wholly inside one flat face, that runs into a hole of that face, that has an island,
  that any other face of the part reaches, or that is not a plain cut from a face (no symmetric, two-sided,
  tapered or angled cut);
- STEP export ("an elliptic wall"; FreeCAD writes a surface of linear extrusion over an ellipse), and a spin of an
  ellipse.

Fuzzed with degenerate numbers over every ellipse pad, hole, arc and pocket document: 0 aborts, 0 hangs.

## Not done
- Booleans against an elliptic wall (union, a fillet or chamfer of its rim, a hole through it).
- STEP write and read of the elliptic wall.
- Revolve of an elliptic profile.
- An ellipse in a profile that also has circular arcs meeting it: crossings are sampled, so a tangential
  contact closer than a chord's sag is refused as touching rather than judged exactly.
- Endpoint tangency between an elliptic arc and anything but a line (sketcher half, above).
