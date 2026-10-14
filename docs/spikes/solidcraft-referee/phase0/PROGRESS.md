# Phase 0 progress (solidcraft referee, ModelDoc translator)

Files: `translate.mjs` (planner + per-feature executor), `run-phase0.mjs` (scorer), `asym-fixtures.mjs`, `COVERAGE.md`,
`results.json`, `ours/ours-<id>.json`, `last-run.txt` (rewritten by every run). Nothing outside this directory is touched.
Run: `SOLIDCRAFT_REFEREE_PKG=<pkg> node docs/spikes/solidcraft-referee/phase0/run-phase0.mjs [--only=..] [--out=<dir>]`.
Exit 2 with a message if the env var is unset. Exit 1 only on a real FAIL (currently box-round-chamfer) (geometry out of tolerance, a face-type mismatch
with no evidence-backed explanation, a rejected-control that was accepted, or a failing asymmetric positive).

## Round 3 results (78 parity fixtures + 14 asymmetric)
PASS 74, FAIL 1 (box-round-chamfer), CONVENTION 0, REFEREE-ARTIFACT 1, REFUSED 2, unexplained face-type mismatches 1
(the same fixture). The run exits 1. brep-rs passes 78/78 in the same run. Asymmetric: 14/14 positives PASS, 11/11 pick controls REJECTED, OCCT and brep-rs pick points coincide 11/11.

## Centre-of-mass score is now pick-sensitive
Round 2 used 3e-4 x diagonal, which a small feature slips under (critic: r=1 control 1.4e-4 passed). Now:
- COM bar 1e-6 x bbox diagonal for every all-planar result and every fixture that carries a negative control. True picks
  measure 2e-8 to 4e-7 there; the bar is not loosened to meet them.
- Looser bar 3e-5 x diagonal ONLY for curved results with no control (parity fixtures, partial revolves). Reason, measured:
  truck's tessellated sweeps miss COM by 1.4e-5 (revolve 90 deg) and 7.6e-6 (200 deg), and cone-bore-through 1.6e-6 and
  chamfer-cylinder-edge 1.5e-6 exceed 1e-6 on a correct build. A wrong sweep direction misses by ~1e-1, so 3e-5 still
  separates. The control for those parity picks is established by the asym fixtures, not re-run on them.
- A control is REJECTED only if it fails the score AND its dCOM is >= 10x the bar.

| fixture | true dCOM | control dCOM | control / bar | result |
|---|---|---|---|---|
| asym-fillet-short-edge (r3) | 3.9e-7 | 1.2e-3 | 1212x | rejected |
| asym-fillet-r1 | 4.5e-8 | 1.4e-4 | 138x | rejected |
| asym-fillet-r0p5 | 2.6e-8 | 3.5e-5 | 35x | rejected |
| asym-fillet-3x-r3 | 4.5e-8 | 1.4e-4 | 138x | rejected |
| asym-shell-open-side (t2) | 1.7e-16 | 4.7e-2 | 47326x | rejected |
| asym-shell-thin-3x (t0.3) | 2.9e-15 | 7.4e-2 | 73833x | rejected |
| asym-draft-face (8 deg) | 3.5e-17 | 1.6e-2 | 16281x | rejected |
| asym-draft-1deg-3x | 2.3e-16 | 2.0e-3 | 2035x | rejected |
| asym-cylinder-one-rim (r3) | 2.4e-7 | 6.5e-3 | 6468x | rejected |
| asym-cylinder-rim-r0p5 | 3.8e-8 | 1.9e-4 | 194x | rejected |
| asym-cylinder-rim-3x-r3 | 4.9e-8 | 7.6e-4 | 764x | rejected |

The weakest control is the r0.5 fillet at 35x. COM was sufficient for every case, so no second signal (affected-face
centroid, inspect.section, face_types) was needed or added. Volume and bbox of every control equal the true pick's, so COM
is the only discriminator; that is by construction, not a weakness.

## Face check is per surface type
OCCT faces are classified live (plane, cylinder, sphere, cone, torus, other) and compared with truck's `face_types`. A
mismatch needs a key whose evidence is computed on the live OCCT shape:
- `truck-merges-edge-connected-same-surface-faces`: truck count == edge-connected components of same-surface OCCT faces.
  This replaces round 2's distinct-surface count, which was too loose (it hid that truck keeps DISCONNECTED coplanar
  pieces apart).
- `truck-splits-cylinder-patch-over-180deg`: truck cylinder count == components + components whose summed angular span
  (face UV bounds) exceeds 180 degrees.
- `occt-other-surface-is-truck-plane` (blend: OCCT holds ruled loft faces as a non-analytic surface, truck as planes).
- `corner-convention` is only reachable through the CONVENTION classifier below.

tangent-union-cylinder (OCCT pl11 cy2, truck pl7 cy2) is now explained: planes = 7 edge-connected components (box top and
bottom are already merged into one face each; the two disconnected pieces of the x=+20 face stay separate, which is the +1
over 6 distinct planes), and the outer cylinder patch is one OCCT component spanning more than 180 degrees that truck keeps
as two faces. **The round-2 hypothesis that "coplanar top and bottom were left separate" was REFUTED**: top and bottom are
merged.

Caveats: this OCCT build does not bind gp_Cone, so all cones in one shape share one surface key (no fixture has two).
Truck-vs-OCCT per-type counts differ for these fixtures (all explained): cone / chamfer-cylinder-edge / cone-bore-through
(truck calls the cone `cone`, OCCT's key was `other` until the cone key was fixed), blend, groove-half, mirror,
coplanar-union-shared-face, tangent-union-cylinder, tangent-subtract-touching, boolean-cylinder-{union,intersect}-cylinder.

## box-round-chamfer is a FAIL; blend is a REFEREE-ARTIFACT
- `box-round-chamfer`: **FAIL**. Truck volume is 1.46e-3 off live OCCT (bar 1e-9) while brep-rs matches OCCT at 1.2e-16:
  two independent kernels agree and truck does not, so this is an unresolved truck divergence. A CONVENTION class is
  assignable only when volume, bbox and COM pass live OCCT at the applicable bar; this one does not. Diagnosis only (does
  not downgrade the outcome): truck's single `solid.chamfer` on all 12 edges equals an independent 12-cut wedge build to
  1.3e-14 (the union of wedge prisms, 29184, without the corner triangles); OCCT and brep-rs add 8 corner triangles
  (live: 8 three-edge planar faces = 26 - 18). Note the wedge build is truck's own, so it diagnoses, it does not validate.
- `blend` (bbox 1.0e-7): truck bbox equals the bbox of the lofted sketch outlines to 4.7e-14; OCCT's AddOptimal is the
  padded one.
- REFUSED (unchanged): `shell-2`, `shell-cylinder-closed`; `solid.shell` requires a face list.

## Partial revolve direction
Translator negates a partial angle. Reason, from the solidcraft source: `solid.revolve` defaults to
`convention: sketch_normal` (features.rs:20; revolve_convention_tests.rs): the sweep turns toward the sketch normal. The
translator's revolve frame is x_dir=u, y_dir=n, normal = u x n = -v, whereas OCCT turns right-handed about n (u toward
v). Opposite senses, hence the negation. A probe with `convention: legacy_axis_start` gave an identical COM; the param was
not adopted.
Evidence: the critic reported the sign rule held on 14 constructed cases (7 revolves + 6 grooves, 45/90/135/200/270 deg,
xy/xz/yz, offsets). I did not run those 14. What I ran: groove-half (parity) and three permanent fixtures in
asym-fixtures.mjs against live OCCT: revolve 90 deg xy (COM 1.4e-5), revolve 200 deg xz offset 5 (7.6e-6), groove 270
deg yz offset 4 (9.7e-8). All PASS at the sweep direction; the first two sit under the 3e-5 tessellation bar, not 1e-6.

## Remaining gaps
- Named picks depend on brep-rs `resolve`; OCCT/brep-rs agreement is asserted only on the 11 asymmetric pick fixtures.
- The circular-edge pick is a heuristic (centre + radius along a world axis), validated by COM.
- Pick controls cover fillet, shell open face, draft face and one cylinder rim; hole/pocket use coordinates, not picks.
- Unmapped (refused): extrude midplane/length2/reversed/taper/direction, circular pattern under 360, copying move,
  counterbore/countersink, whole-body draft. `rotate` and `datum` have no fixture.
- The 3e-5 tier cannot see a wrong-rim fillet of r about 0.1 mm or smaller on a ~45 mm curved part (critic measured 7.9e-6
  passing at r=0.1, failing at r=0.2); the pick-sensitivity claim covers features of about 0.2 mm or more.
- Face fidelity is verified by count per surface type only, not by face geometry.
- Parity-fixture picks run at the 3e-5 tier (curved bodies); their sensitivity rests on the asym controls, which show a
  >= 35x margin at 1e-6.
- compare.mjs cannot score parity fixtures (refs only from its baseline/); ours-<id>.json has its shape, nothing consumes it.
