# Y2 — Flanged cylinder with edit (yardstick task)

## Goal

Build a cylinder standing on a round flange, dress the flange edge with a
fillet, add a row of four small holes in the flange, then change the cylinder
height and recompute. The point is to test that parameter edits propagate
through features created after the edited one.

## Steps

1. Draw a circle 40 mm in diameter and pad it 30 mm. This is the cylinder.
2. On the base plane, draw a circle 70 mm in diameter and pad it 6 mm, joined
   to the base of the cylinder. (Either order of the two pads is fine; the
   result is a 30 mm tall cylinder on a 6 mm tall, 70 mm dia flange.)
3. Fillet the top edge of the flange (the 70 mm circular edge at height 6 mm)
   with a 3 mm radius.
4. On the flange top face, place four circles 5 mm in diameter in a line along
   one axis, hole centres 12 mm apart (pitch 12 mm), symmetric about the
   cylinder axis, and cut them through the 6 mm flange. A linear pattern
   feature is the natural way; four separate cuts are equivalent.
5. EDIT: change the cylinder height from 30 mm to 45 mm and recompute the
   model.

## Dimensions

| Feature | Size (mm) |
|---|---|
| Cylinder | Ø40 × 30 (later edited to Ø40 × 45) |
| Flange | Ø70 × 6 at the base |
| Fillet | R3 on the flange top edge |
| Holes | 4 × Ø5 through the flange, pitch 12 mm, centred line |

## Finished-state assertion

Volume before the edit: **53 703.00 mm³ ± 1 %** (accept 53 165.97 – 54 240.02).
Volume after the edit (cylinder 45 mm): **72 552.55 mm³ ± 1 %** (accept
71 827.03 – 73 278.08).

Derivation: flange ring π·35²·6 − π·20²·6 = 14 922.57; cylinder π·20²·30 =
37 699.11; four holes 4 · π·2.5²·6 = 471.24; fillet removes
0.215 · π · 3³ = 18.24 mm³ (standard rounded-edge constant). Before =
37 699.11 + 14 922.57 + 471.24 − 18.24 = 53 703.00 mm³ (raw sum 53 721.23).
After the edit the cylinder contributes π·20²·45 = 56 548.67, so after =
72 552.55 mm³ (raw sum 72 570.79). The fillet is unchanged by the height edit,
so the difference between the two states is exactly the cylinder growth
π·20²·15 = 18 849.56 mm³.

Also: after the edit the model still contains exactly 4 holes and 1 fillet.