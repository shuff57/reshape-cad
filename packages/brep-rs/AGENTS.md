# packages/brep-rs

## OVERVIEW
Independent Rust B-rep kernel compiled to wasm (wasm-bindgen), the third `EngineAdapter` beside OCCT and FreeCAD; spec of record is docs/specs/SPEC-brep-kernel-rs.md.

## STRUCTURE
```
src/            One crate, layered; each layer depends only on layers above it
├── lib.rs      The layer list, the first thing to read
├── math.rs     Vectors, matrices, tolerances, root finding
├── geom.rs     Curves and surfaces; analytic types first-class, NURBS fallback
├── topo.rs     Vertex/edge/wire/face/shell/solid, shared-handle model
├── build.rs    Primitives, sweep, revolve, mirror, pattern, move
├── ops.rs      Booleans, fillet/chamfer, shell, draft
├── history.rs  Per-operation naming history (Fate, OpRecord, sweeps)
├── mesh.rs     Tessellation for three.js; planar faces via earcutr
├── step.rs     STEP read/write
├── step_read.rs  STEP part-file tokenizer and entity graph
├── step_in.rs  Rebuild a solid from a parsed STEP graph
└── wasm.rs     The ONLY module that knows about JS; JSON in, JSON out
pkg/            wasm-pack output, gitignored, served by the host app
```

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Gate contract exports | src/wasm.rs | `version`, `measure_doc`, `resolve`, `build_doc_json`, `mesh_feature`, `export_step`, `measure_step`, `face_size`, `edge_length`, `name_face`, `name_edge` |
| Doc build + refusals | src/wasm.rs `build_doc()` | One branch per Feature.kind; unimplemented kinds get a plain-sentence refusal, never a silent skip |
| Build cache | src/wasm.rs `cached_build()` | thread_local memo keyed by the exact doc JSON string, so build → mesh → resolve → measure parses once |
| Topology identity | src/topo.rs | Identity is handle identity (`Rc<RefCell<T>>`), never geometry; shared edges are one handle with orientation flipped |
| Naming | src/history.rs + wasm.rs | A TopoName is a path through history, not a position; `resolve` enriches hits with faceIndex/edgeIndex |

## CONVENTIONS
- **Build and test**: `cd packages/brep-rs && wasm-pack build --release --target web --out-dir pkg`, then `cargo test --release`. Rebuild the wasm before running any gate, or you measure the old binary.
- **No package.json at the crate root, ever**: the root workspace glob is `packages/*`, so one here would pull the crate into `npm test --workspaces` and CI. wasm-pack's own `pkg/package.json` is the allowed exception.
- **JSON at the wasm boundary**: serde_json Values, not typed structs, so the Node gates stay independent of Rust types.
- **Tests are `#[cfg(test)]` modules** inside each layer, run natively with cargo, not in wasm.
- **Size budget**: gzipped wasm must stay under OCCT's 7,250,252 bytes. Release profile is `opt-level = "z"`, `lto = true`, `panic = "abort"`; no unused dependencies.

## ANTI-PATTERNS
- **Never edit scripts/brep-*.mjs or scripts/brep-parity-fixtures.mjs.** The parity, mesh, step and spend scripts are lead-owned; a builder who can edit its own gate eventually will.
- **Never return a wrong solid silently.** Refuse per-feature in `refusals` with a plain sentence naming what is not supported, exactly as the existing `build_doc()` branches do. A refusal is honest; a wrong solid is a defect.
- **No faceted approximations.** Sampling a curve into flat facets to make a number match fails the gate (more than 2x OCCT's face count plus 4). Booleans must intersect real analytic and NURBS surfaces in any orientation, coplanar and tangent faces included; reshape-cad produces those constantly (flush pocket floors, holes through faces).
- **Do not repeat the rejected 2.5D Z-slab combine** (SPEC §4.5, 2026-09-15): it passed ten fixtures, refused anything off-axis, and is why the face-count check exists.
- **Do not add a truck-* dependency.** Truck is an architecture reference only; read it, never import it or copy files verbatim.
- **Do not let `topo` and `geom` import each other.** `topo` is generic over its geometry types, the way truck keeps its own topology crate independent (lib.rs header, SPEC §4.1).
- **Do not change wasm export names or JSON shapes.** The lead-owned gates and `BrepRsEngineAdapter` parse them literally; a renamed field fails loudly at first call.