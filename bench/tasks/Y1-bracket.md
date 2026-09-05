# Y1 — L-bracket (yardstick task)

## Goal

Build an L-shaped bracket from two rectangular plates joined at 90 degrees,
then remove material from it: a shallow rectangular recess on the big face and
three small through holes.

## Steps

1. Draw a rectangle 80 mm by 60 mm and pad it 10 mm. This is the big plate.
2. Draw a rectangle 60 mm by 40 mm on the end face of the big plate (the face
   at the far end of the 80 mm side, full 60 mm width) and pad it 10 mm in the
   direction perpendicular to the big plate, so the two plates form an L
   standing 50 mm tall overall.
3. On the big outer face, draw a rectangle 30 mm by 20 mm, positioned
   anywhere clear of the holes, and pocket it 5 mm deep.
4. On the same big outer face, place three circles of 6 mm diameter at
   (15, 15), (65, 15) and (40, 45) measured in mm from the corner of the
   plate, and cut them through the full 10 mm thickness of the big plate.

## Dimensions

| Feature | Size (mm) |
|---|---|
| Big plate | 80 × 60 × 10 |
| Second leg | 60 × 40 × 10, at 90° to the big plate |
| Recess (pocket) | 30 × 20 × 5 deep |
| Holes | 3 × Ø6 through, centres at (15,15), (65,15), (40,45) from the plate corner |

## Finished-state assertion

The solid's volume is **68 151.77 mm³ ± 1 %** (accept 67 470.25 – 68 833.29 mm³).

Derivation: big plate 80·60·10 = 48 000; leg 60·40·10 = 24 000; recess
30·20·5 = 3 000; holes 3 · π·3²·10 = 848.23. Sum 48 000 + 24 000 − 3 000 −
848.23 = 68 151.77 mm³. (The holes pass only through the 10 mm big plate;
the recess sits within it and does not intersect the holes.)

Also: the model contains exactly 3 through holes.