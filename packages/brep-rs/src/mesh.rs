//! Layer `mesh`: tessellation for three.js. Not exercised by the parity gate's
//! box/move fixtures, which compare volume and bounding box, so this is a stub
//! with the interface the spec names.

/// A triangle mesh: interleaved positions plus a flat index list.
pub struct Mesh {
    pub positions: Vec<[f64; 3]>,
    pub indices: Vec<u32>,
}
