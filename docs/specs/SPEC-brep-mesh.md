# SPEC — brep-rs mesh + edges for three.js (connect step 1, 2026-09-15)

Parent spec: `C:\Users\shuff57\Documents\GitHub\reshape-cad\docs\specs\SPEC-brep-kernel-rs.md`.
The consumer is `packages/kernel/src/engine-adapter.ts` (`EngineMesh`, `edges()`).
If any path in this spec does not exist, STOP and say so rather than guessing.

## WORK STYLE — read first

NEVER reason for more than a few paragraphs in one message: write geometry as Rust
plus `cargo test`, and let the gate judge. Make your first code edit within 6 tool
calls. Ignore any older message-center messages: this dispatch is mesh only.

## Goal

Replace the stub in `packages/brep-rs/src/mesh.rs` with a real tessellator, and export
it from wasm, so that `scripts/brep-mesh-gate.mjs` (LEAD-OWNED, do not edit) passes on
every fixture while `scripts/brep-parity-gate.mjs` stays 58/58.

## The wasm export (exact contract — the gate and step 2 call this)

In `packages/brep-rs/src/wasm.rs`:

```rust
#[wasm_bindgen]
pub fn mesh_feature(doc_json: &str, feature_id: &str, deflection: f64) -> String
```

Build the doc exactly as `measure_doc` does, take the built solid for `feature_id`, and
return JSON:

```json
{
  "positions": [x0,y0,z0, x1,y1,z1, ...],
  "indices":   [i0,i1,i2, ...],
  "faces":     [{"index":0,"start":0,"count":36}, ...],
  "edges":     [[x,y,z, x,y,z, ...], ...]
}
```

or `{"error": "<plain reason>"}` if the feature is missing or was refused.

- `faces[k]` is face k in **`solid.faces()` order** (the same order `measure_doc`'s
  `"faces"` count and `resolve()` use). `start` and `count` are offsets into
  `indices` (three.js `BufferGeometry.addGroup` units, so `count` is a multiple of 3).
  Ranges are contiguous, in order, and cover `indices` exactly. Every face gets a range
  with `count > 0`.
- `edges[j]` is edge j in **`solid.edges()` order**, a polyline with at least 2 points.
- Also add `"edges": solid.edges().len()` to each shape entry in `measure_doc`'s output,
  next to `"faces"`. The mesh gate compares the polyline count against it, and the
  parity gate ignores the extra field.
- Triangles wind counter-clockwise seen from outside (outward normal by the right-hand
  rule), matching the solid's face orientation, including reversed cavity faces.

## Tessellation rules (what the gate checks)

`deflection` is the chord tolerance in model units. The app default is 0.05, and the
gate runs 0.05 and 0.5.

1. **Edges are discretized once, from their curve.** A line has 2 points. An arc or
   circle gets `n = max(ceil(span / (2*acos(1 - d/r))), minimum)` segments, uniform in
   angle, with exact endpoints. Both faces bordering an edge use exactly those boundary
   points, so the mesh is watertight. Duplicated seam edges (the known boolean issue in
   `.msgbox/FUTURE.md`) must give the same points: sampling uniform in angle does, even
   when one copy runs the other way.
2. **Planar faces.** Triangulate the outer wire plus hole wires in the plane's (u,v)
   frame. The `earcutr` crate is allowed (pure Rust). Add it to `Cargo.toml` and report
   the gzipped size change. Planar faces need no interior points.
3. **Curved faces (cylinder, cone, sphere, torus, partial ranges, trimmed).** Sample the
   face's parameter domain with a grid whose spacing meets the deflection
   (`2*acos(1 - d/r)` in angle). Clip it to the trim loops in (u,v), and join the grid
   to the boundary points from rule 1 without splitting any boundary segment. A T-vertex
   on a face boundary is a crack. Emit sphere poles as fans with no zero-area triangles.
   Periodic seams must close: u=0 and u=2pi land on the same points.
4. **No degenerate triangles** (area < 1e-12), and no NaN.
5. **Reasonable size.** The gate fails any solid that has more than `4 * OCCT triangles + 200`
   at the same deflection.

## What `scripts/brep-mesh-gate.mjs` checks, per fixture, at deflection 0.05 and 0.5

- `faces.length` equals `measure_doc`'s `faces`, and the ranges are contiguous and complete.
- After welding positions within 1e-6, every mesh edge is used by exactly 2 triangles
  in opposite directions (closed and consistently oriented).
- Mesh signed volume > 0, and `|V_mesh - V_exact| <= deflection * A_mesh * 1.05 + 1e-9`,
  where V_exact comes from `measure_doc`.
- The mesh bbox is within the exact bbox grown by `deflection`, and vice versa.
- The triangle count is `<= 4 * OCCT's + 200` (OCCT tessellated by
  `packages/kernel/dist/occt-mesh.js` at the same deflection).
- `edges` has `solid.edges().len()` polylines, each with at least 2 points, all
  inside the bbox grown by `deflection`.

## Constraints

1. Edit only `packages/brep-rs/` (src/, Cargo.toml, Cargo.lock, rebuilt pkg/). Do NOT
   edit `scripts/brep-mesh-gate.mjs`, `scripts/brep-parity-gate.mjs`,
   `scripts/brep-parity-fixtures.mjs` or `scripts/brep-spend.mjs`. The lead holds
   claims on them.
2. `scripts/brep-parity-gate.mjs` must stay 58 passed / 0 failed, and `cargo test`
   must stay green.
3. Native tests: a watertight box mesh (12 triangles, closed), a cylinder volume within
   the bound, and a sphere with no degenerate triangles.
4. Work in small steps. Get the box fixtures passing the mesh gate first
   (`--kind box`), then extrude/prism/wedge (planar), then cylinder/cone, then
   sphere/torus, then booleans and cavities.

## Commands (from C:\Users\shuff57\Documents\GitHub\reshape-cad)

```
cd packages/brep-rs && wasm-pack build --release --target web && cd ../..
node scripts/brep-mesh-gate.mjs --kind box
node scripts/brep-mesh-gate.mjs                       # all fixtures
node scripts/brep-parity-gate.mjs                     # must stay 58/0
cd packages/brep-rs && cargo test --release && cd ../..
```

## Done means

`node scripts/brep-mesh-gate.mjs` exits 0 with every fixture passing at both
deflections. The parity gate is 58/0, and cargo test passes.

## Report (one message)

`node C:/Users/shuff57/.claude/bin/msg.mjs send --from opencode --to claude --re last --text "..."`

Status first (anything failed, skipped or refused goes in the first sentence).
Include: mesh-gate pass/fail per kind, with the worst volume-bound ratio and the worst
triangle ratio vs OCCT; the parity-gate tally; cargo test; gzipped wasm bytes before and
after; files changed; spend written as USD with no dollar sign; ONE design decision this
spec did not pin down; and the checks you could NOT perform (you have no image input, so
say you did not look at a render).
