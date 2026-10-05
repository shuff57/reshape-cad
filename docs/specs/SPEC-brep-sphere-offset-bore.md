# SPEC — brep-rs: an off-centre bore through a sphere (2026-10-05)

Status: S1 to S4 IMPLEMENTED (2026-10-05); S5 open. See "S1 result" to "S4 result" below. Parent: `SPEC-brep-kernel-rs.md`.
Precedents: `SPEC-transverse-bore.md` (cylinder across a cylinder), `SPEC-sphere-bore.md` (axial), PLAN-next §22-24, §33.

## Why

A fresh census of current `main` (15,000 random scripts, all families, against OpenCascade and closed-form oracles,
2026-10-05) found 0 wrong brep-rs solids and 8,066 honest refusals. 463 of them are `hole(sphere, { across, at })`:
a plain bore into a ball, off the axis, which the generic hole sentence refuses ("brep-rs cannot cut this hole yet").
Only `sphere_axial_bore` (axis through the centre) builds today.

A sphere is isotropic, so only the perpendicular distance `e` from the centre to the bore axis matters; "parallel to z"
is a special case of any axis.

## Geometry (derived; one number set checked by Simpson integration against a 2-D grid sum)

Sphere radius R at the origin; bore radius r; axis parallel to `d`, offset `e` along `n`; in scope 0 < e, e + r < R.
Let s0 = sqrt(R² − (e+r)²), fmax = sqrt(R² − (e−r)²).

- **Meeting curve** at cylinder angle φ: point = (e + r cos φ) n + r sin φ a + z d, with z = ±f(φ),
  f(φ) = sqrt(R² − e² − r² − 2 e r cos φ). f runs from s0 (φ = 0) to fmax (φ = π) and is strictly positive, so each
  branch is one closed curve and a through bore has two (±f); a blind bore has one. They pinch at e + r = R (tangent: refuse).
- **Removed volume.** I = ∫_D sqrt(R² − x² − y²) dA over D = {(x−e)² + y² < r²}.
  Through: V_rem = 2I. Blind with floor height f0 entered from +d: V_rem = I − f0 π r², valid for |f0| < s0.
  1-D form, w = sqrt(r² − y²), c² = R² − y²: I = ∫ ½ [ x sqrt(c² − x²) + c² asin(x/c) ] from x = e−w to e+w, dy.
  Result = 4/3 π R³ − V_rem. At e = 0 this reduces to the axial 4/3 π h³ (checked).
  Check value: through, R=20, r=3, e=8 → I = 514.4501 (grid 514.4588), V_result = 32481.4215.
- **Sphere patch removed per hole.** J = ∫_D dA / f = ∫ [asin((e+w)/c) − asin((e−w)/c)] dy; area = R·J. Vector area
  (R ∫ x/f dA, 0, π r²); the 1-D forms for centroid numerator and volume term follow the same pattern (`cross_region`).
- **Bore wall area** = r ∫₀^{2π} (f_hi − f_lo) dφ; floor disc π r².
- Bounding box changes only along d, and only when e < r (the pole falls in the hole).

## Data model

1. `Curve::SphCyl { center, d, n, a, big_r, r, e, sign }`, a new variant (not a flag on `CylCyl`), so exhaustive matches
   fail to compile: geom.rs (length, point_at, derivative, centroid, bbox, transform), ops.rs:2413, step.rs:516,
   step_in.rs:398. Silent wildcards that need an explicit decision and a pin test: `same_edge_geometry`
   (ops.rs `_ => false`), `edge_curve_kind` (mesh.rs `_ => Other`), `mesh_cross_tool` (`_ => {}` would drop the loop).
2. `Cross::SphTool { big_r, e, lo, hi, lo_sign, hi_sign }` for the bore wall, sharing the quadrature in `cross_region`
   through an `ext(u)` closure. Arms needed at geom.rs area_centroid / volume_term / aabb (the `matches!(.., Cross::Tool |
   Patch)` patterns there fail silently to a whole-rectangle measure), mesh.rs ~1164 and ~1371, and the test match at
   ops.rs ~8872 (`None | Some(Patch)` is a wildcard). The existing `cross.is_some()` guards refuse the new variant for free.
3. **`SphereSurf.trim: Option<f64>` becomes `enum SphTrim { None, Square(f64), Bore { r, e, minus } }`.** This is the
   important change: a bored sphere keeps full `u_range` and `v_range`, so it passes every `trim.is_none()` guard
   (`sphere_axial_bore`, `flip_face`) unless the compiler forces a decision at each read of `trim` (about 17 sites:
   geom, ops, ops_touch, step, mesh, ops_planar, build). `Bore` carries scalars only; the frame lives in the surface so
   `Surface::transform` stays exact. `SphereSurf::bore_region()` returns the removed area, volume term and centroid
   numerator and is subtracted as `Cross::Wall` is. `sphere_face_contains` returns false within r of the bore axis.
4. Faces: through = sphere with two inner loop wires (no outer seam) + `SphTool` wall; blind adds the floor. Audit every
   `boundary.first()` outer-wire assumption for a sphere whose only wires are holes.
5. Rename `has_cross_trim` so it also covers a sphere `Bore` (ops.rs ~5042, 5358; wasm.rs ~976, test ~8979) and reword
   the sentence "already has a bore across its side" so it reads correctly for a sphere.
6. Builder `sphere_offset_bore(op, a, b)` next to `sphere_axial_bore`, called right after it in `boolean_legacy`.
   Returns None for e < 1e-7 R (stays with the axial builder).

## Meshing

The wall reuses `mesh_cross_tool` (rungs are straight and lie on the cylinder). The sphere face cannot use a ladder
(chords sag on a doubly curved face) and `mesh_sphere_zone` assumes constant-latitude rims. Plan: a mesher-local frame
with pole ŷ = d × n. Every hole is a lens symmetric about the equator with its tips on it, and the pole is never inside
a hole whenever e + r < R. Mesh the y > 0 and y < 0 halves separately: a pole fan, rows scaled to the rim, and a rim
zipper over the virtual equator outside the hole windows and the loop arc inside them. Push the hole polyline points
exactly as sampled from the edge so the shared curve is bit-identical with the wall. Sample count follows
`cyl_cyl_segments`. Known weakness: skinny triangles at the window ends. Derived, not measured.

## STEP

Refuse in slice 1 with an explicit `Bore` arm (a sphere face with only inner loops has no outer bound). The `SphCyl` arm
in `wire_segs` can reuse `fit_closed_curve` (checked 1e-7 fit) later.

## Guards

Builds only when: operation is subtract; the sphere is plain, single-face, untrimmed; the tool is a plain cylinder;
(e + r)/R ≤ 0.95 (same policy as `CROSS_BORE_MAX_RATIO`); r ≥ 1e-6 R; through: both tool ends clear ±fmax by a margin;
blind: one end clears +fmax and |f0| < s0 less a margin, entered from either end normalised to +d.
Refuses, each in a sentence: the bore reaches or breaks out of the side; tangent or near-tangent; a tool end or floor
between s0 and fmax; a second cut on a bored sphere; union and intersect; STEP; an already trimmed sphere or zone.
The set-theoretic soundness check abstains on trimmed faces, as it does for `cylinder_cross_bore`, so the safety nets are:
`volume_is_translation_invariant`, and a closed-form net refusing unless |V_a − V_result − V_rem| ≤ 1e-10 V_a with V_rem from
the independent 1-D `I`. Add an analytic probe against the OPERANDS only (±δ off each result face against the sphere and tool).

## Test plan (oracles that do not trust the kernel)

Numeric 2-D sum or Monte Carlo of the removed volume over (R, r, e, floor) including e/r in {0.5, 0.99, 1.01, 2} and
(e + r)/R up to 0.95, plus the area check via J; e → 0 equals the axial formula; OpenCascade referee on volume (1e-7),
bbox and face count using the `transverse-bore.test.mjs` loader pattern (gate scripts are LEAD-OWNED: draft fixtures go in
`docs/specs/DRAFT-parity-fixtures-new-bores.mjs.txt`); meshes watertight at 0.05 and 0.5 with mesh volume within 1%;
every wall vertex and curve point on the cylinder (and curve on the sphere) to 1e-9; translation invariance and
`once_used_edges` empty; a ray-cast point sample against the analytic solid; a sphere-with-offset-hole family in the
wrong-solid sweep; the refusal sentences pinned; flip the existing refusal pin at `sphere-bore.test.mjs:149`.

## Slices

- **S1** (about 2-3 days): through bore, e > r, any axis. `SphTrim` enum and its compile-fix, `SphCyl`, `SphTool`,
  measures, builder and guards, the y-frame mesher, STEP refuses, everything else refuses.
- **S2:** blind bore with its floor and safety net. **S3:** e < r (pole branch of the bbox, mesh margin).
  **S4:** STEP for the sphere face. **S5:** sweep, docs, census.

## Falsification measurement, agreed BEFORE implementation

1. Before any builder: check the closed forms I, J and the blind form against OpenCascade on 20 seeded (R, r, e, floor)
   cases. Abort if any case disagrees beyond 1e-7 relative (the formulas are wrong).
2. Before committing to S1: prototype the y-frame mesher on the through case at e/r in {0.5, 0.99, 1.01, 2} and
   (e + r)/R in {0.5, 0.95}. If any fails watertight at 0.05 or 0.5, drop that range to a refusal rather than loosen the check.
3. Stop rule: if S1 leaves an unexplained mismatch against OpenCascade or the numeric oracle, stop and record it in
   `kernel-campaign.md` instead of widening scope.

## Pre-check results (2026-10-05, before any builder)

1. **Closed forms vs OpenCascade: PASS.** 20 seeded (R, r, e, floor) cases, half through and half blind, e + r up to 0.95 R:
   worst relative difference 1.2e-10 (every case under 2e-10), for V = 4/3 pi R^3 - 2I (through) and
   V = 4/3 pi R^3 - (I - f0 pi r^2) (blind). `I` MUST be integrated in theta with y = r sin(theta); a plain Simpson rule in y
   has a square-root singularity at y = +-r and gave 3.7e-7, which is above the 1e-7 bar. The kernel quadrature (the
   `bore_region` and removed-volume net) must use the substitution, or Gauss-Legendre in theta.
2. **y-frame mesher, topology: PASS.** A standalone JS prototype of the pole fan plus rim zipper (two halves about the
   pole d x n, hole arcs on the rim, straight wall rungs) was built for e/r in {0.5, 0.99, 1.01, 2} x (e+r)/R in {0.5, 0.95}
   at two densities (32 configurations). Every one had zero open or mismatched directed edges and no degenerate triangles,
   including e < r. Volume error is chord sag only: 2.3-2.7% at 24 columns/6 rows, 0.52-0.57% at 64/12 (the design's "within
   1%" is a statement about the production tolerance, which sets the density). Not yet shown: triangle quality at the window
   ends, and the production mesher's own sampling and seam handling; the prototype lives outside the repo.

## S1 result (2026-10-05)

Built as designed: `SphTrim { None, Square, Bore }` (about 17 reader sites, compile-driven; `is_none`/`is_some` keep the
whole-sphere guards refusing), `Curve::SphCyl`, `Cross::SphTool` (shares the `Tool` quadrature through `Cross::tool_bounds`),
`SphereSurf::bore_cap_measure`, `sphere_offset_bore` with a closed-form volume net that shares no algebra with the face
measures, the pole-fan sphere mesher (rim vertices taken from the same polylines the wall uses), `has_cross_trim` covering a
bored sphere, STEP refusing with "a bore across a sphere" (S4 later wrote it).

Measured on the merged build (not predicted):
- A through bore R=20, r=3, e=8 measures 32481.4215 (the independent pre-check value), to 1e-9 of the closed form.
- OpenCascade referee: nine (R, r, e, direction) cases agree on volume to 1e-7 and on face count (2); three bore axes,
  moved and turned, keep the volume.
- Mesh: closed and outward across e/r in {1.2, 2, 3} x (e+r)/R in {0.3, 0.5, 0.95} at chord 0.05 and 0.5; every wall vertex
  on its cylinder and every sphere vertex on the sphere to 1e-6; a ray-cast oracle agrees on 1,200 random points per case.
  The first mesher sampled at the bare chord step and was a steady 2.3x the plain sphere's volume shortfall (right at the mesh
  gate's deflection x area bound at fine tolerance); sampling at 0.7 of the step brings it to the plain sphere's.
- Sweep (15,000 scripts, seed 1, all families, against OpenCascade): 0 wrong before and after; 23 scripts moved from
  refused to agreeing with OpenCascade, none moved any other way.
- Gates unchanged: parity 78/0, mesh 78/0, STEP 77/0/1, occt 17/0. cargo 485; kernel +17 tests.
- One pin changed on purpose: `coaxial-sphere-cone.test.mjs` pinned "a cylinder off the ball's centre" as a refusal; it
  builds now and is held to its closed form.

What the 463 refusals turned out to be (single-step scripts only; 294 more are multi-step, mostly a second cut on an already
bored sphere, which refuses by design): 45 blind bores (S2), 32 with e <= r (S3), 50 counterbore or countersink recesses, 3 past
the 0.95 R limit. So S1 covered the plain through bore with e > r and the larger share waits on S2 and S3.

## S2 result (2026-10-05)

A blind bore builds: `SphTrim::Bore` gained `through` (a blind bore holes only the entry end), the builder accepts a floor
strictly between -s0 and s0 (s0 = sqrt(R^2 - (e + r)^2), the meeting curve's lowest point, so the whole floor disc lies inside
the sphere), entered from either end, and adds the floor disc. `Cross::SphTool` already carried a constant lower end, so the wall
needed no new type. The closed-form net is V = I - f0 pi r^2. A floor or tool end in the polar band the curve spans
(between s0 and fmax), or below -s0, still refuses.

Measured: seven blind cases agree with the closed form (1e-9) and OpenCascade (1e-7, 3 faces); five floor heights x both entry
ends agree in cargo; the mesh is closed and outward at chord 0.05 and 0.5 across the grid with floors at -0.6, 0 and +0.6 s0, and
the ray-cast oracle agrees with floors; the sweep (15,000 scripts, seed 1) has 0 wrong and 21 further scripts moved from refused to
agreeing with OpenCascade, none moved any other way. Gates unchanged (parity 78/0, mesh 78/0, STEP 77/0/1, occt 17/0); cargo 488.

## S3 result (2026-10-05)

`sphere_offset_bore` now builds when the bore swallows the sphere's own pole along its axis (`e <= r`, including `e = r` exactly), through
or blind. The topology is unchanged (a sphere face with one hole per end, the wall, and a floor when blind), and the pole-fan mesher and
the cap measures needed no change: the measure formulas are signed in x, and the meeting curve's polar angle about the mesher's pole
`d x n` is monotone for every e (d(psi)/d(phi) has the sign of R^2 - r^2 - e r cos(phi), positive while e + r < R). Three real changes:

1. The guard `e - r >= 1e-3 R` is gone.
2. **The tool-end guard was wrong for `e < r`, and it was a latent wrong solid.** A tool end must clear the highest sphere point over the
   bore disc: fmax off the pole (e > r), but R itself once the disc holds the pole. The S2 guard used fmax, so a tool ending between fmax and R
   would have left the cap above it uncut, and the closed-form net could not see it because the builder ignores the tool ends. The reach is now
   R - margin for `e <= r` (a blind `deep:` from the top face ends exactly at R and cuts the same solid) and fmax + margin otherwise. Pinned
   by `a_tool_end_below_the_pole_refuses_when_the_pole_is_swallowed`, which fails with the old guard.
3. The bored sphere's box was the whole +-R on every axis. Along a world axis the extreme is R unless the bore swallows that point of the
   sphere, and then it is the highest point of the meeting curve (dense sample plus golden refinement), so a through bore through the pole now
   has +-fmax along its axis, tilted bores included. `a_bored_spheres_box_is_exact_when_the_pole_is_swallowed` compares against a brute-force
   world-coordinate oracle on three axes (z, x, tilted 45 degrees) and fails without the change ([-20, 20] against [-19.77, 19.77]).

Measured: closed-form volume to 1e-9 across e/r in {0.05, 0.3, 0.5, 0.9, 0.99, 1.0} x (e+r)/R in {0.2, 0.5, 0.95}; the mesh closed, outward and on
its surfaces at chord 0.05 and 0.5 (e/r in {0.1, 0.5, 0.9, 1.0}); the OpenCascade referee at 1e-7 on eleven further through and blind cases
(`[20,3,2,0]`, `[20,3,3,0]`, `[20,3,0.5,0]`, `[20,6,5,0]`, `[20,8,3,4]`, `[20,9,8.9,0]`, `[20,5,0.01,0]` through; four blind) and the ray-cast
oracle on five of them. Sweep (15,000 scripts, seed 1): 0 wrong; refused 8022 to 7977, agreeing with OpenCascade 4747 to 4788, and four more
changed class to OCCT-HANG only because OpenCascade hung under load while the gates ran beside the sweep (brep-rs still refuses those four). Gates
unchanged (parity 78/0, mesh 78/0, STEP 77/0/1, occt 17/0); cargo 492. The two pins that expected `at: [1, 0]` and `at: [3.9, 0]` to refuse
were moved to cases that still refuse.

Still open: STEP for the sphere face (S4), counterbore and countersink recesses, a second cut on a bored sphere, and e + r > 0.95 R.

## S4 result (2026-10-05)

A bored sphere now exports to STEP, through or blind, any axis, moved parts included. The sphere face is written from its own wires: each
hole is the `SphCyl` meeting curve as the same checked B-spline fit `CylCyl` uses (a fit that misses the exact curve by 1e-7 of its size refuses),
the first loop is the face's outer bound by position only, and every loop is wound with the face on its left seen from outside (clockwise
about the hole it rings, decided from the sign of the loop's turning about its mean direction). The bore wall and the floor needed no new
code: their wires reach the same curve through `wire_segs`.

One real finding: **the surface must be written about the axis `d x n`, not the bore axis `d`.** At `e = r` the meeting curve runs
exactly through the bore axis's own pole, where `SPHERICAL_SURFACE` is singular, and OpenCascade's loop parametrisation collapsed (it read
back 1111 for a 32399 solid, a wrong solid on the OpenCascade side, caught by the read-back). About `d x n` the poles lie in the face for
every e, never on a curve (the same pole the mesher uses).

Measured: eight fixed cases (through and blind, e > r, e < r, e = r, a diagonal offset, a moved part) read back by OpenCascade agree with the
closed form to 1e-6 with a valid shape and the right face count; 60 random cases (any of three axes, through or blind, e from 0.01 up to the
0.94 R limit) all write, read back valid, and agree with the kernel's own volume to 3.3e-10 worst. STEP gate unchanged (77/0/1), cargo 492.
Not exercised: the left-handed (mirrored) branch of the loop winding, because a mirror of a bored sphere refuses earlier at the cross-trim guard.

## Risks

A bored sphere read as a whole sphere through a guard the enum change misses (the 49 other `Surface::Sphere` sites never
read `trim`; `has_*_trim` is the net); a face with only hole wires breaking `boundary.first()` assumptions; skinny
triangles or chord-dependent open meshes (note `mesh_solid` retries finer chords, which can hide this); the
edge-weld and mesh wildcards; the aabb equator and pole branches; the hole arm measuring recess depth from the current
top (S4h note), which will show up in sweeps.

## Not verified

Written from the Plan agent's read of the code and one Python check of the volume integral. Nothing was run in the kernel;
the mesher's star-shapedness and monotonicity claims are derived, not measured.
