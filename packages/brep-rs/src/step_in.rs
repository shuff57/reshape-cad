//! Layer `step_in`: rebuild a `topo::Solid` from a parsed STEP entity graph.
//!
//! REFUSES whatever it cannot represent EXACTLY, in plain words, and refuses
//! the whole solid rather than part of it (SPEC 4.5: never return a wrong
//! solid silently). A face's trim lives on the SURFACE in this kernel and in
//! the LOOPS in STEP, so a rebuilt face whose trim was guessed would measure
//! wrong with nothing to catch it.

// removed once implemented
#![allow(dead_code)]

/// Read one STEP part file into a solid, or refuse in plain words.
pub fn read_solid(text: &str) -> Result<crate::build::TSolid, String> {
    let _ = text;
    Err("brep-rs STEP import not built yet".to_string())
}