# DRAFT (not filed) - solid.chamfer on all 12 edges of a box: no corner faces, volume differs from OCCT by 1.46e-3

Target: bherbruck/solidcraft, commit fe3717f2e400010a4cd0e7dd4f294e7091c25625 (0.9.0).

## Summary
Chamfering all 12 edges of a 40 x 40 x 20 mm box with distance 4 gives volume 29184 mm3 and 18 faces.
OCCT gives 29141.333 mm3 and 26 faces (the 18 plus 8 triangular corner faces). Thanks for the project; we
are reporting a difference between kernels and do not know which result solidcraft intends.

## Reproduce
`solidcraft-cli run scripts/chamfer-all-edges.json --results` (script is in this directory), or these two commands:
1. `solid.box` {"length":40,"width":40,"height":20,"center":[0,0,0],"body_name":"b"}
2. `solid.chamfer` {"distance":4,"body":"b","edges":[[0,-20,-10],[0,-20,10],[0,20,-10],[0,20,10],[-20,0,-10],[-20,0,10],[20,0,-10],[20,0,10],[-20,-20,0],[-20,20,0],[20,-20,0],[20,20,0]]}
Then `inspect.measure`. (We ran the same command JSON through a wasm wrapper over solidcraft-engine at the
commit above, not the CLI binary; `node chamfer-check.mjs` does that.)

## Actual (pasted from our run)
```
solidcraft: volume_mm3=29184 faces=18 edges=48 vertices=32 face_types={"plane":18}
half-space quadrature (N=4000): volume=29184.986  (OCCT live, from phase0: 29141.333333, 26 faces)
relative difference solidcraft vs half-space quadrature: 3.38e-5 (midpoint-grid error)
relative difference solidcraft vs OCCT (phase0, live): 1.46e-3
```

## Expected
OCCT (live, via replicad-opencascadejs, same box and edges): 29141.333333, 26 faces. A second, independent
kernel (brep-rs, our own) agrees with OCCT to 1.2e-16 relative. Our spec table records the same number.

## Why it matters
A box with every edge chamfered is the commonest chamfer case; a user comparing against FreeCAD/OCCT sees
0.15 % less material removed than they would get there, and a different face count/topology at each corner.

## What we verified
- solidcraft's single `solid.chamfer` equals an independent 12-cut wedge build to 1.3e-14 (29184, i.e. the
  union of 12 wedge prisms with no corner triangles).
- The plain intersection of the 12 half-spaces (|a|+|b| <= ha+hb-d, computed by quadrature in chamfer-check.mjs)
  also gives ~29185. So solidcraft's body is that intersection; OCCT/brep-rs additionally cut a triangle at
  each corner (26 - 18 = 8 three-edge planar faces, measured).

## What we do NOT know
- Which is the intended result for solidcraft. The half-space intersection is a legitimate solid, so this may be
  a design choice rather than a bug; we are asking, not asserting.
- Where in solidcraft/truck the corner treatment would live. We did not read the chamfer implementation.
- Whether FreeCAD gives 26 faces here: we did not run FreeCAD for this fixture (OCCT directly only).
