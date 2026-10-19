# DRAFT (not filed) - solid.shell of a box with a box joined on its top face, top opened: result is 2-7% under two independent references; the stub's walls stop at z=8.657, not 5

Target: bherbruck/solidcraft, commit fe3717f2e400010a4cd0e7dd4f294e7091c25625 (0.9.0).

## Summary
Base box 40x30x10 (centred, top at z=5) with a second box joined on its top face, then `solid.shell`
(thickness 1) with the base's top face picked by point. The shell builds, no error, but its volume is below
both references in all 6 variants. In the centred 10x10x8 case the stub's outer walls start at z=8.657
instead of z=5 (4.20 instead of 5 for an 8 mm footprint); a 10x10x3.657 slab of the wall is missing.

## Reproduce
`SOLIDCRAFT_REFEREE_PKG2=<pkg> node shell-stub-probe.mjs [centre|offset-x|corner|edge-flush|tall|low]`.
Commands (centre case; the script prints all six):
1. solid.box {length 40, width 30, height 10, center [0,0,0], body_name b1}
2. solid.box {length 10, width 10, height 8, center [0,0,9], body_name b2}
3. solid.combine {target b1, tools [b2], operation join}
4. solid.shell {faces [[-17,-12,5]], thickness 1, body b1}
5. model.faces {body b1}   (and inspect.measure at the end)
Other variants differ only in step 2: size/centre = [10,10,8]/[10,0,9], [10,10,8]/[15,10,9],
[10,10,8]/[15,0,9], [8,8,30]/[-8,5,20], [12,12,2]/[5,-5,6].

## Actual (pasted, face listing trimmed to the relevant rows; wasm build of phase2/wrapper2, 2026-10-14)
```
centre: size [10,10,8] centre [0,0,9]  solidcraft volume 2644.345622159777  [P 2776, L 2856]
offset-x: size [10,10,8] centre [10,0,9]  solidcraft volume 2644.3456221597767  [P 2776, L 2856]
corner: size [10,10,8] centre [15,10,9]  solidcraft volume 2713.8298771310065  [P 2776, L 2812]
edge-flush: size [10,10,8] centre [15,0,9]  solidcraft volume 2680.9162826709507  [P 2776, L 2832]
tall: size [8,8,30] centre [-8,5,20]  solidcraft volume 3182.3562606759406  [P 3300, L 3364]
low: size [12,12,2] centre [5,-5,6]  solidcraft volume 2524.0000000000005  [P 2612, L 2708]

-- model.faces BEFORE shell (join only), stub faces and base top:
F1:+z            area 1100.000  centroid z 5.000  normal [0,0,1]

-- model.faces AFTER shell (volume 2644.346: the stub outer walls F2:* centroid z 10.829 area 43.43 => span z 8.657..13, not 5..13):
F1:+z            area  136.000  centroid z 5.000  normal [0,0,1]
F2:+x            area   43.429  centroid z 10.829  normal [1,0,0]
F4:inner:F1:+z   area   36.000  centroid z 8.657  normal [0,0,-1]
```
Before the shell the stub walls F2:* are 80 mm2 each (z 5..13). After it they are 43.429 mm2 with centroid
z 10.829, i.e. z 8.657..13, and the inner ceiling F4:inner:F1:+z (36 mm2, normal -z) sits at z 8.657.

## Expected
A hollow part that keeps the stub's tube attached to the base. Two independent references (box primitives +
booleans on live OCCT, matched by a 0.1 mm voxel estimator; OCCT's own shell is NOT used, it no-ops here;
`../phase4/verify-stub-reference.mjs`, `../phase4/stub-reference-results.json`, VERIFY.md 5b):

| variant | solidcraft | plane offset P | connected erosion L |
|---|---|---|---|
| centre, offset-x | 2644.346 | 2776 | 2856 |
| corner | 2713.830 | 2776 | 2812 |
| edge-flush | 2680.916 | 2776 | 2832 |
| tall | 3182.356 | 3300 | 3364 |
| low | 2524.000 | 2612 | 2708 |

Two shell conventions at the stub foot: P moves every remaining face 1 mm inward along its plane (the tube
then rests on nothing); L keeps material within 1 mm of every non-open face (the stub stays attached). Both
are above solidcraft in every row, by 2.2-4.7% (P) and 3.5-7.4% (L). So solidcraft removed more material
than either reading allows; the choice of convention does not change the verdict.

## What we do NOT know
- Why the tube ends at 8.657 (10 mm footprint) / 4.2015 (8 mm footprint); the missing 131.65 mm3 for the
  10 mm case equals (10^2-8^2)*3.657. We did not find the cause in the engine.
- Whether a 100 mm2 face at z=5 normal +z in F1:+z (area 136 = 36 + 100) is the stub's floor; not checked.
- Whether it is the shell or the join that is wrong: model.faces before the shell is exact (F2 walls 80 mm2).
- Not tested: solidcraft-cli (not built here); other thicknesses.

No refusal or diagnostic is raised, so the short stub wall is silent.
