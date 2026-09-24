# W5: parallel-face leak in region_inside (Y1/Y2 bench blocker)

## Goal
Y1 full build (plate + pocket + 3 bores + leg) = 68151.77 exact, and the
Y2 doc-path join (holed flanged cylinder + standing cylinder) builds.
No wrong solid ships; every fix test-pinned.

## Pinned defect
A planar face of `other` that bounds only PART of the probe plane pushes
an unbounded half-plane into region_inside. Pinned sites:
- Y1: the pocket floor (z=5 face) pushes "(0,0,5)" on the leg-bottom
  rescue's zero-probe plane (z=10), de-facto-emptying region0; the leg
  bottom survives whole; the shell cracks; the manifold guard refuses.
- Y2: the same disease refuses the doc-path join with holed flanges.

## Steps
1. Instrument + reproduce: dump region0's pushed constants and skipped
   faces for the leg-bottom rescue. Confirm the exact leak site (hypothesis:
   the void-scan samples ONE in-plane direction, plane.u, and for the
   pocket floor that direction lands outside the solid -> the void face
   is not detected -> its constant is pushed).
2. Fix minimally: robust void detection (multi-direction beside-sampling)
   or per-face extent clipping, whichever the probe confirms.
3. Re-check the Y2 doc-path join with the same fix; debug its leak site if
   still refusing.
4. Gates: cargo suite, wasm rebuild, parity/mesh/STEP, npm test.
5. Measure Y1/Y2 finals through the app path; flip record.json y1/y2;
   update FUTURE.md; commit+push.

## Expected result
y1/y2 rows filled with measured exact volumes; every fix pinned by a test.

## OUTCOME (2026-09-23, main @ 544b292)
DONE. The leak was two-fold:
1. The void-scan sampled one frame-dependent in-plane direction; made
   direction-robust (both signs of both axes).
2. Coplanar contacts now resolve through the partner face's own wires
   (coplanar_face_wires) instead of the half-plane algebra: full cover
   drops, partial bites via clip_poly_by_poly into Bite/Complement with
   inner wires carried.
Results: Y1 final 68151.77 exact (in band, PASS); Y2 final 59901.9703
exact; height edit propagates exactly. record.json y1/y2 filled.
Pinned: y1_bench_final_exact, y2_bench_final_exact. Gates: cargo 228/228,
parity 68/68, mesh 68/68, STEP 60+8 refusals, npm test green.
Remaining W5 (narrowed): general oblique trimmed-face membership
(multi-piece region representation). Y2 spec doc defect needs the lead.
