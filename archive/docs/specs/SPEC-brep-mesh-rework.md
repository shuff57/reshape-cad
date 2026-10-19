# REWORK 1 of 1 — brep-rs mesh step (2026-09-15)

The parent work order is `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-mesh.md`,
and every rule in it still applies. If a path does not exist, STOP and say so.

## Where it stands (lead-verified after your last run)

- parity gate 58 passed / 0 failed; cargo test 48/48; wasm 142,439 bytes gzipped
- `node scripts/brep-mesh-gate.mjs`: **54 passed / 4 failed**

## The exact failures

```
FAIL groove-half [groove] -- d=0.05: 58 open/cracked edges | d=0.5: 26 open/cracked edges
FAIL coplanar-subtract-caps [combine] -- d=0.05 and 0.5: brep-rs cannot tessellate op1 yet
     (the boolean emits two zero-area planar faces, each a single zero-length segment)
FAIL boolean-cut-x-axis-cylinder [combine] -- d=0.05: 138 open/cracked edges
FAIL boolean-sphere-minus-box [combine] -- d=0.05: 40 open/cracked edges; volume 12241.6 vs exact 11251.4;
     bbox z mesh [-15,15] vs exact [-14.1421,14.1421] | d=0.5: 30 cracked, 4 flipped, same bbox miss
```

## Root cause (your own diagnosis, confirmed)

A curved face whose trim loop is not a constant-u/v rectangle gets gridded over the full
parameter domain and is never clipped to its loops.

## What to do

1. KEEP the structured-grid path for curved faces with a rectangular trim. It passes 54
   fixtures, so don't change its behaviour.
2. ADD a trimmed path, used only when a curved face's loops are NOT a constant-u/v
   rectangle:
   - map every boundary polyline point (the SAME points rule 1 already produces for the
     neighbouring faces) to (u,v) on the surface;
   - run `earcutr` on the uv outer loop plus hole loops;
   - refine: split only INTERIOR triangle edges (never a boundary segment) at their
     midpoint in uv, until each triangle's 3D midpoint chord error is <= deflection. The
     boundary stays shared with the neighbouring faces, so no cracks.
3. coplanar-subtract-caps: you MAY edit `ops.rs` to drop zero-area faces from a boolean
   result, but the parity gate must stay 58/0. Check its face-count bound.
4. Go one fixture at a time, in this order: boolean-sphere-minus-box,
   boolean-cut-x-axis-cylinder, groove-half, coplanar-subtract-caps. After each one:
   `wasm-pack build --release --target web`, then `node scripts/brep-mesh-gate.mjs`, and
   confirm the 54 still pass.

## Rules

- NEVER reason for more than a few paragraphs in one message. Never write more than
  about 150 lines in one edit.
- First code edit within 6 tool calls.
- Edit only `packages/brep-rs/`. Do not edit `scripts/brep-*.mjs`.
- Done means `node scripts/brep-mesh-gate.mjs` exits 0, parity is 58/0, and cargo test
  passes. Report as SPEC-brep-mesh.md says, status first.
