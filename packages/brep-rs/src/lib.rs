//! brep-rs — an independent Rust B-rep kernel, compiled to wasm.
//!
//! Layering (SPEC-brep-kernel-rs §4.1). Each layer depends only on layers
//! above it in this list:
//!
//! ```text
//! math      vectors, points, matrices, tolerances, root finding
//! geom      curves and surfaces (§4.3)
//! topo      vertex/edge/wire/face/shell/solid (§4.2)
//! build     primitives, sweep, revolve, mirror, pattern, move (§4.4)
//! ops       booleans, fillet/chamfer, shell, draft (§4.5)
//! history   per-operation naming history (§4.6)
//! mesh      tessellation for three.js
//! step      STEP read/write
//! step_read STEP part-file tokenizer and entity graph
//! step_in   rebuild a solid from a parsed STEP graph
//! wasm      wasm-bindgen surface, the only module that knows about JS (§4.7)
//! ```
//!
//! `topo` and `geom` do not import each other: `topo` is generic over its
//! geometry types, the way truck keeps `truck-topology` independent of
//! `truck-geometry`.

pub mod math;
pub mod geom;
pub mod topo;
pub mod build;
pub mod ops;
pub mod history;
pub mod mesh;
pub mod step;
pub mod step_read;
pub mod step_in;
pub mod wasm;
