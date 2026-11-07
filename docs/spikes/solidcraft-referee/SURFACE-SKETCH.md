# Surface sketches: sketching on curved faces

Date: 2026-11-07. Kernel under test: SolidCraft **v0.40.0-rc.2** (`777f9609`, kernel solidcore), through the rig's
topology wrapper (`~/.cache/solidcraft-0.40.0-rc.2-rig/sc-referee-pkg-topology`). Nothing upstream was modified, nothing
was pushed, filed or posted.

Code: `packages/layer/src/surface-sketch.ts`. Tests: `packages/layer/test/surface-sketch.test.mjs` (pure, in `npm test`)
and `packages/layer/test/live-surface-sketch.mjs` (real kernel, not in `npm test`; evidence in
`packages/layer/test/evidence/live-surface-sketch-0.40.0-rc.2.json`).

## What it is

A surface sketch is an ordinary 2D sketch whose coordinates are measured **along the surface**. Its origin sits on an
anchor point of the face, its x axis points along a chosen tangent direction, and a sketch point (s, t) lands where a
walk of length |(s, t)| from the anchor, straight ahead on the surface (a geodesic), in the direction (s, t) makes with
the x axis, ends. This is not a wrap or an emboss of a flat sketch: the sketch's own plane is the surface.

| surface | map | what is kept |
|---|---|---|
| cylinder wall | unrolling (closed form) | every length and angle |
| two flat faces at a corner, any angle, outside or inside | unfolding across the edge (closed form) | every length and angle; a curve crossing the edge is broken exactly there |
| sphere | geodesic walk (closed form: great circles) | distances and directions from the anchor; lengths across them shrink by sin(r/R)/(r/R) |
| wavy face (any smooth face seen as a height over a plane) | geodesic walk, RK4 on the height field's geodesic equation | distances and directions from the anchor; the stretch across is measured |

Where lengths cannot all be kept (sphere, wavy), the largest stretch over the outline is measured and the sketch is
refused above `maxStretch` (default 1%), in one sentence that says by how much and how to fix it (smaller, nearer the
anchor, or allow more stretch).

A wavy face is not described by the script; the layer **measures the kernel's own face** (`inspect.isocurve`, 30 curves
each way on every face of it), fits a cubic B-spline height field with 1 mm knots (`fitHeight`), and checks the fit
against a second, different sampling (17 curves each way) that the fit never saw. The worse of the two residuals is the
fit's quality; above 2 µm the sketch is refused ("too irregular to sketch on").

## What the kernel does with it

The kernel is never asked to understand a curved sketch. The layer maps the outline onto the surface, then flattens the
mapped outline onto a plane outside the part along one **view direction** (the normal at the anchor; the bisector of
the two normals at a corner; the height field's plane normal for a wavy face). That flat "shadow" sketch is what the
kernel gets, and it puts the outline back exactly where the layer put it, because projecting the shadow along the view
lands on the mapped outline. Three operations:

- **cut** / **raise** by a depth: a prism of the shadow region along the view, trimmed to a layer of the part by
  booleans, then cut from or joined to it. Two floors:
  - `view` (any surface): the floor (or top) is the surface moved by the depth along the view. Volume = shadow area x
    depth, exactly. The depth square to the surface is reported (it is smaller where the surface tilts).
  - `normal` (cylinder, sphere): the floor is a coaxial / concentric copy at radius R - depth (R + depth), so the depth
    is exact square to the surface. Volume by quadrature of the chord between the two surfaces over the shadow region.
  Side walls run along the view direction in both.
- **imprint**: split the face along the outline. Only a closed outline whose pieces meet smoothly (see the kernel
  facts below).

Before anything is sent, guards refuse: an outline that leaves the face (cylinder ends, the fitted face's box, the
corner's faces), that turns more than `maxTiltDeg` (70) away from the view, that folds over itself as seen along the
view, a corner sharper than 20 degrees, a zero depth, too much stretch, a poor fit. After the build, the result is
checked against the layer's own prediction (`verifySurfaceSketch`), which comes from closed forms and quadrature, never
from the kernel: the volume change for cut/raise (relative tolerance 2e-4), and for imprint, that every new edge lies on
the predicted outline (2 µm), that the outline is fully covered, that its length matches (1%) and that nothing else on
the part was marked. A mismatch is a refusal.

## Kernel facts found on rc.2 (measured with raw command lists, no layer)

These decided the design. Each is a candidate upstream report; none is filed (owner approves exact text first).

1. **Split Face by a sketch carries every open curve on to the edge of the face.** A rectangle of four lines on a flat
   face split it into 9 regions (the inner one exactly 60 mm2, plus the four sides' extensions). Four fit splines through
   collinear points did the same, and so did a lens of two curved splines meeting at sharp corners (inner region 89.457
   against 89.459 exact, plus extensions). A single closed periodic spline is split cleanly. Hence: imprint only takes a
   closed outline whose pieces all meet smoothly (circle, oval, slot, rounded rectangle), sent as one periodic spline;
   anything with sharp corners is cut or raised instead.
2. **Split Face by a sketch projects through the whole face.** A circle aimed at a cylinder wall marked the front and
   the back (two regions); on a sphere both caps. Hence: a round face is first split in two by the plane through its
   axis (centre) square to the view, and only the front half is marked. The seam lies 90 degrees round from the anchor,
   outside the tilt guard, and is reported in the feature's notes.
3. **An arc that lies off the face produced two straight full-length splits** of the face instead of nothing.
4. **Arcs are placed coarsely, fit splines accurately.** An exact half circle in a face's own plane came out 0.6% short
   in length (model.edges) and 2.6% short in area; a fit spline through 64 points of it, 4e-6 of the area. Hence: every
   curved shadow piece is sent as a fit spline (points 0.5 mm apart; at 0.25 mm all round solidcore's own check refuses
   the extrude), straight ones as lines. Pieces that meet smoothly (a slot, a rounded rectangle) go as ONE periodic
   spline: loose spline ends rounded a 1.5 mm slot end off by 2e-4 of its volume. For a mark, a periodic spline through
   a slot rippled 3 um where its side meets its end; points 0.2 mm apart within 1.5 mm of each such join bring it under
   2 um. That crowding is used for marks only: it made solidcore refuse to extrude the sphere and wavy slots.
5. **Per-face areas and edge lengths are mesh estimates, also with `exact: true`.** A plain cylinder's top reads
   1250.48 (model.faces) and 1254.61 (inspect.measure on the face) against 1256.637; body totals and circle lengths are
   exact. Hence: the imprint check uses edge points (exact points on each edge), not areas.
6. **A mark can be refused depending only on where the spline points fall.** The same 7 x 4 ellipse on the cylinder,
   sampled as 2048 points before fitting, is refused by solidcore's trimming check ("Face Loop has bad orientation",
   "zero area"); sampled as 2000 or 4096 it is marked correctly, and a 7 x 4.1 ellipse is refused. An honest refusal, but
   a fragile one. The layer does not retry with nudged points (that would be a translator policy; not decided).
7. **Booleans of a shadow prism against the part are exact enough to check against**: cylinder, sphere, lofted wavy
   body and prisms with corners give the predicted volume to 4e-14 .. 7e-5 in 1 to 9 s. Marks are slow: 3 s on a flat
   face, 16 to 36 s on a cylinder, about 29 s on a sphere (the cylinder mark is split into some 1500 short edges).
9. **Two builds of rc.2 disagree on marks.** A circle mark on a cylinder that already had a cut was built (and checked)
   by the rig's wasm build, and refused by the official rc.2 Linux CLI (native) with fact 6's loop-orientation error.
   Volumes from cut / raise agreed between the two builds on all 17 features compared. So marks need the check on the
   build the student actually runs; `test/showcase-surface-sketch.mjs` checks every feature on both.
8. One shadow prism was refused by solidcore's extrude ("flat arrays: a NURBS form that is not its analytic surface"):
   a 14 x 8 rectangle on the wavy face, allowed 3% stretch.

## Results (36 cases, `node packages/layer/test/live-surface-sketch.mjs`)

**34 of 36 as expected. 0 built a part that differs from its prediction. 2 refused by the kernel** (facts 6 and 8), each shown with the layer's sentence:
"The outline for surface1 could not be built on this face, so the part is shown without it -- try a smaller or simpler
outline." Pure tests: 23 in `surface-sketch.test.mjs`, all against closed forms or a second method.

Corners were run at 45, 60, 90, 120 and 150 degrees outside and 90, 120 and 150 inside; 30 degrees is refused (its
faces turn 75 degrees from the view). The circle cuts across corners match to about 3e-5, the size of the error left by
the loose spline ends where the circle is broken at the edge; straight-sided outlines across a corner match to 1e-13.

"predicted" is the layer's own number (closed form or quadrature), "kernel" is what inspect.measure / model.edges
reported after the build.

| case | outcome | predicted | kernel | rel. error | time |
|---|---|---|---|---|---|
| cylinder cut along view, rectangle 16 x 10, 1.5 deep | built | -233.6510 mm3 | -233.6510 mm3 | 1.1e-11 | 1.0 s |
| cylinder cut along view, rectangle turned 30 deg (helical sides) | built | -125.2463 mm3 | -125.2462 mm3 | 7.7e-7 | 3.8 s |
| cylinder cut square to the surface, rectangle 16 x 10, 1.5 deep | built | -240.5594 mm3 | -240.5593 mm3 | 1.3e-7 | 1.1 s |
| cylinder raise along view, slot 12 long r 3, 1 high | built | 97.3293 mm3 | 97.3285 mm3 | 8.5e-6 | 4.4 s |
| cylinder raise square to the surface, circle r 5, 1 high | built | 78.5091 mm3 | 78.5087 mm3 | 5.4e-6 | 3.6 s |
| cylinder cut, plate with a ring (circle inside a rectangle) | built | -180.5886 mm3 | -180.5896 mm3 | 6.0e-6 | 2.9 s |
| cylinder mark a circle r 5 | built | outline 31.4158 mm | 2112 edges on it, 31.4157 mm |  | 16.7 s |
| cylinder mark an ellipse 7 x 4 | refused by the kernel | outline 35.2031 mm |  |  | 10.1 s |
| cylinder mark a slot 10 long r 3 (pieces meet smoothly) | built | outline 38.8493 mm | 3312 edges on it, 38.8491 mm |  | 35.7 s |
| cylinder REFUSE: wraps 172 deg round | refused by the layer (expected) |  |  |  | 0.0 s |
| cylinder REFUSE: marking a rectangle | refused by the layer (expected) |  |  |  | 0.0 s |
| sphere cut along view, circle r 4, 1 deep | built | -49.9683 mm3 | -49.9667 mm3 | 3.3e-5 | 4.4 s |
| sphere raise square to the surface, circle r 5, 1 high | built | 78.3396 mm3 | 78.3395 mm3 | 4.1e-7 | 4.9 s |
| sphere cut square to the surface, rectangle 6 x 4, 0.8 deep | built | -19.1871 mm3 | -19.1859 mm3 | 6.6e-5 | 3.6 s |
| sphere raise along view, slot 6 long r 1.5 (stretch < 1%) | built | 19.9567 mm3 | 19.9567 mm3 | 1.4e-6 | 4.9 s |
| sphere mark a circle r 5 | built | outline 31.2706 mm | 2112 edges on it, 31.2704 mm |  | 28.9 s |
| sphere REFUSE: circle r 12 stretches 2.6% | refused by the layer (expected) |  |  |  | 0.0 s |
| wavy cut along view, circle r 6, 1 deep | built | -102.5560 mm3 | -102.5548 mm3 | 1.2e-5 | 8.7 s |
| wavy raise along view, slot 10 long r 2.5, 1 high | built | 64.5210 mm3 | 64.5202 mm3 | 1.2e-5 | 8.8 s |
| wavy cut along view, rectangle 9 x 6 turned 20 deg, 0.8 deep | built | -38.6668 mm3 | -38.6668 mm3 | 1.4e-6 | 6.4 s |
| wavy REFUSE: rectangle 14 x 8 stretches 2% on the waves | refused by the layer (expected) |  |  |  | 2.5 s |
| wavy rectangle 14 x 8 with 3% stretch allowed | refused by the kernel | -81.5739 mm3 |  |  | 4.5 s |
| wavy REFUSE: runs off the face | refused by the layer (expected) |  |  |  | 2.4 s |
| outside corner 45 deg: cut a circle r 5 across the edge, 1 deep | built | -30.0559 mm3 | -30.0551 mm3 | 2.6e-5 | 2.9 s |
| outside corner 60 deg: cut a circle r 5 across the edge, 1 deep | built | -39.2699 mm3 | -39.2687 mm3 | 3.1e-5 | 2.9 s |
| outside corner 90 deg: cut a circle r 5 across the edge, 1 deep | built | -55.5360 mm3 | -55.5343 mm3 | 3.2e-5 | 3.1 s |
| outside corner 90 deg: raise a rectangle 12 x 8 across the edge, 1 high | built | 67.8823 mm3 | 67.8823 mm3 | 4.1e-14 | 0.9 s |
| outside corner 120 deg: cut a circle r 5 across the edge, 1 deep | built | -68.0175 mm3 | -68.0154 mm3 | 3.0e-5 | 3.1 s |
| outside corner 120 deg: raise a rectangle 12 x 8 across the edge, 1 high | built | 83.1384 mm3 | 83.1384 mm3 | 7.1e-14 | 1.0 s |
| outside corner 150 deg: cut a circle r 5 across the edge, 1 deep | built | -75.8636 mm3 | -75.8615 mm3 | 2.8e-5 | 3.1 s |
| inside corner 90 deg: cut a circle r 5 across the edge, 1 deep | built | -55.5360 mm3 | -55.5343 mm3 | 3.2e-5 | 2.9 s |
| inside corner 120 deg: cut a circle r 5 across the edge, 1 deep | built | -68.0175 mm3 | -68.0154 mm3 | 3.0e-5 | 3.1 s |
| inside corner 120 deg: raise a slot across the edge, 1 high | built | 51.6454 mm3 | 51.6460 mm3 | 1.2e-5 | 3.0 s |
| inside corner 150 deg: cut a circle r 5 across the edge, 1 deep | built | -75.8636 mm3 | -75.8615 mm3 | 2.8e-5 | 3.0 s |
| outside corner 90 deg: mark a circle r 3 on one face | built | outline 18.8493 mm | 1512 edges on it, 18.8491 mm |  | 3.4 s |
| outside corner 30 deg REFUSE: too sharp for one view | refused by the layer (expected) |  |  |  | 0.0 s |

Earlier runs during development found two faults of the layer's own, both fixed and both covered by tests now: a closed
outline with corners that crossed the corner edge had its first and last sides joined into one spline, which rounded a
corner off (+0.031 mm3 on a 67.88 mm3 raise); and the volume tolerance had a floor of 1e-6 of the BODY's volume, which
let that through on a 48000 mm3 part. The tolerance is now 2e-4 of the change plus 1e-9 of the body.

## Showcase in SolidCraft itself

`node packages/layer/test/showcase-surface-sketch.mjs <out>` (with `SOLIDCRAFT_CLI` set to the official rc.2
`solidcraft-cli`) builds four designs, keeps a feature only if it matches its prediction on both the rig kernel and the
official CLI, and saves `.solidcraft` files and snapshots. Result on 2026-11-07: cylinder 2 of 4 features (a slot raised
square to the surface was refused by a solidcore boolean, "intersect::curve_class::p6: upstream status 1001"; the mark
was refused by the official CLI, fact 9), sphere 3 of 4 (the mark refused, fact 6), wavy 5 of 5, corners 12 of 12
(outside 60, 90, 120, 150 and inside 90, 120 degrees, a circle cut and a rectangle raised across each edge). No feature
was built that did not match.

## Not done

- **No script word.** Students cannot reach this yet. A word for it means touching `VOCABULARY` in
  `packages/script/src/reshape-script.ts`, which AGENTS.md forbids without the owner. A proposal that needs no new word:
  an option on the existing `sketch()` call, e.g. `sketch(part.face('side'), { along: 'surface', at, x })`, mapped to a
  new feature kind in the translator. Owner decision.
- **Not wired into the translator** (`packages/layer/src/translate.ts` / `unified.ts`): the planner and the check are
  pure functions with the same contract (commands, prediction, verify), not yet a `FEATURE_KINDS` entry. The face's
  geometry comes from upstream's topology (`cylinder` and `plane_normal` are given; sphere centre and radius are not, so
  they would come from the doc's own sphere feature), and wavy faces are measured as the live test does.
- Marks across a corner edge, marks on a wavy face that spans several kernel faces (the lofted top is 10), and marks
  with holes: refused or untested.
- Cut / raise square to the surface on corners and wavy faces (only along the view there; the depth square to the
  surface is reported).
- A sketch wrapping more than 70 degrees round a cylinder in one go (it would need two views, split at a seam).
- Text on surfaces: the map takes any outline, but no font outline is fed to it.
