# SPEC — brep-rs: several bores on one sphere (2026-10-05)

Status: IMPLEMENTED (2026-10-05) for disjoint bores parallel to one axis, up to four. Parent: `SPEC-brep-sphere-offset-bore.md`
(S1 to S4: one bore, through or blind, e <= r included, STEP). Precedents: `SPEC-transverse-bore.md`.

## Why, and how much it is worth (measured, not guessed)

The first census of a second bore on a sphere quoted 255 refusing scripts. That number was wrong for this purpose: it counted
scripts that also carry a counterbore or countersink. Re-cut from the 15,000-script sweep (seed 1, 2026-10-05, after S3):

| | scripts |
|---|---|
| sphere scripts that are only a sphere and two or more `hole()` calls | 192 |
| of those, with a counterbore or countersink (refuse on the recess anyway) | 158 |
| plain holes only | 34 |
| of those, every bore buildable alone (in the 0.95 R limit, off or on the axis) | 26 |
| of those, all bores parallel and disjoint | 2 |
| of those, bores that overlap (7) or run in two directions (17) | 24 |

So the census itself only reaches two scripts. The reason to build it is the shape it describes: a ball with several holes
(a bowling ball with three finger holes) is the natural classroom use of a sphere with holes, and the census generator draws
sizes at random, so it under-represents disjoint holes. The overlapping and crossing cases (a cross-drilled ball) need
cylinder-cylinder cuts inside a sphere and are a different, larger project; they still refuse.

## What builds

`hole(s, ...)` a second, third or fourth time on a sphere that an earlier hole bored, when the new bore is a plain cylinder:

- parallel to the first (the sphere keeps one axis), through or blind from either end, `e + r <= 0.95 R` for each;
- its footprint (radius r about its offset in the plane square to the axis) clear of every other footprint by at least
  `1e-6 R`, so the cylinders never meet and the removed volumes add;
- in any order: the solid does not depend on the order the bores were cut in.

Everything else on a bored sphere refuses in the hole's own sentence: overlapping or touching footprints, a bore across the
first, a fifth bore, union and intersect, anything but a plain cylinder tool. The refused hole is shown without itself, the
bores that did build stay.

## Design

**Data model.** `SphTrim::Bore { r, e, through }` is kept for one bore (every verified S1-S4 result is unchanged). A second
variant `SphTrim::Bores { n, h: [BoreHole; MAX_BORES] }` holds up to four `BoreHole { r, x, y, ends }`: the offset `(x, y)` in the
plane of the sphere's `e1` and `axis x e1`, and the ends it holes (`0` both, `1` the `+axis` end, `-1` the other). The trim is
`Copy`, so the list is a fixed array. `SphereSurf::bore_holes()` returns the list for both variants, and every site that read
`Bore { r, e, through }` (face area, volume term, centroid, box, point-in-face, mesh routing, STEP) now loops over it; the cap
measure takes the offset direction (`bore_cap_measure_toward`), since area and volume do not care which way the offset points.

**Builder.** `sphere_offset_bore` was rewritten around `assemble_bored_sphere(c, R, axis, e1, specs)`, which builds the sphere
face (one hole wire per holed end), a wall per bore and a floor per blind bore from scratch. A bored sphere is extended by reading
its bores back from its wall faces (`bored_sphere_parts`, checked against the sphere's own trim and against the closed-form volume
of what it claims to be, or it is not ours) and rebuilding everything with the new bore added. With one bore the output is the same
faces as before: all single-bore tests pass unchanged. The safety net is the same closed form, summed: the result's volume must be
`4/3 pi R^3` less each bore's removed volume (through `2 I`, blind `I - f0 pi r^2`) to `1e-9`, from formulas that share no algebra
with the face measures.

**Mesher.** The single-bore pole fan needs every hole symmetric about one plane, which several bores at different offset
directions are not. The sphere face is instead a spherical Delaunay triangulation, `sphere_hull.rs`:

1. The hole loops are the same polylines the bore walls use (so the shared curve is vertex for vertex the same).
2. Interior points are a Fibonacci lattice (turned by a fixed rotation so no row lines up with a bore's symmetry), kept out of every
   hole and at least one boundary spacing from every loop vertex.
3. The Delaunay triangulation of points on a sphere is their 3D convex hull (an incremental hull, about 150 lines). Because each loop
   edge's diametral cap is empty (no interior point inside it, none on the hole side), every loop edge is a hull edge.
4. Triangles whose centre lies in a hole are dropped.
5. The result is checked, or nothing is returned: every loop edge must be present and the only open edges must be the loop edges.

It needs no pole, so no bore can sit on one, and it does not care how many holes there are or where.

**Placement.** The script layer reads a hole's extent as its target's (a hole never changes it), but S3 made a bored sphere's box
exact, so a bore that swallows the pole shrinks it. The kernel centres a later blind hole on its target's box, so the hole step now
places against the whole ball for a bored sphere (`hole_reference_box`). Without it a second blind hole would be cut from the wrong
height, silently.

**STEP.** Unchanged in kind: each hole loop is the fitted B-spline, wound with the face on its left. The surface is written about
`d x n` of the first bore, a pole that is on no curve and in no hole for any parallel bore (every hole point has `|z| >= s0 > 0`).

## Measured

- Cargo 499 (7 new: hull, order independence, closed form on six multi-bore cases, exact box against a brute-force oracle, mesh
  closed and outward at chord 0.05 and 0.5, refusals).
- Kernel: closed form to `1e-9`, OpenCascade referee to `1e-7` with the same face counts, STEP read-back valid at `1e-6`, mesh
  closed and outward with volume within 2 % at chord 0.05, on six cases of 2-4 bores (through, blind, one swallowing the pole).
- Random differential fuzz (`prototypes/sphere-multi-bore-fuzz.mjs`, 400 scripts, seed 1): 222 built, 178 refused, 0 script
  errors; the 221 with every bore parallel to z agree with the closed form to `2.4e-15`.
- Three of those 221 differ from OpenCascade by 3e-6 to 4e-4. All three have a blind bore that swallows the pole cut first.
  OpenCascade places a later blind hole against its OWN box of the bored part, which that bore has shrunk, so it cuts the later
  hole at the wrong height (the referee contract in `occt-build.ts` centres the tool on the target's box). Cut that bore last and
  OpenCascade agrees with brep-rs to `8e-11`; brep-rs gives the identical volume in both orders. The referee apparatus is not edited
  (AGENTS.md), so this is recorded here: an OpenCascade-side defect, not a brep-rs one.

- Sweep (15,000 scripts, seed 1, run on an otherwise idle machine): 0 wrong; one script moved from refused to agreeing with
  OpenCascade, none moved any other way (the other class changes are OpenCascade hanging or not, which varies run to run). That is
  the census's own reach for this shape (two scripts), as scoped above. Gates unchanged (parity 78/0, mesh 78/0, STEP 77/0/1, occt 17/0).
- Mutation checks: with `hole_reference_box` replaced by the target's own box, the pole-swallowing-then-blind case fails the closed
  form (the pin for the placement fix); the hull mesher's conformity check returned nothing, never an open mesh, in every run.

## Still refuses

Overlapping, touching or crossing bores (cylinder-cylinder inside a sphere); bores in two directions; a fifth bore; a bored sphere
under any other operation; counterbore and countersink recesses; `e + r > 0.95 R`.

## Not verified

The mirror branch of the STEP loop winding (a mirrored bored sphere refuses earlier). The hull's cost grows with the number of
points (it scans every live facet per inserted point), so it is capped at 40,000 points and returns nothing beyond that; the
mesh gate and the tests top out well under it. Several bores along the sweep's other families are measured only by the sweep below.
