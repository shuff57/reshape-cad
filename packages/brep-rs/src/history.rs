//! Layer `history`: per-operation naming history (§4.6).
//!
//! Every operation returns, alongside its shape, a history map: for each output
//! face and edge, which input face or edge it was `modified`/`generated` from,
//! or that an input was `deleted`. This is the shape OCCT's Modified/Generated
//! maps give `occt-build.ts` today.
//!
//! This slice carries the model plus the causes the box and move kinds can
//! produce: `primitive`, and `between` (an edge named by the pair of faces that
//! meet along it). `carried` and `split` are represented in the data model, and
//! the boolean that fills them in will not need this file reshaped.

use crate::build::{self, TEdge, TFace, TSolid};
use crate::geom::Surface;
use crate::math::{sub, Vec3};
use crate::topo;
use std::collections::HashMap;

/// What an operation did to one input part.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Fate {
    /// The part survived, under `PartRef` (a face/edge index in the output).
    Kept(PartRef),
    /// The part was deleted outright.
    Deleted,
    /// One part became several. Every piece is reported as modified from the
    /// single input, so an `OnPoint` discriminator can pick between them.
    Split(Vec<PartRef>),
}

/// A position in an operation's output, not a stable identity — identity is
/// handle identity, this is only how history is written down.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PartRef {
    Face(usize),
    Edge(usize),
}

/// One operation kept alive: the input feature ids it consumed, and the fate of
/// each input face/edge. A boolean builds `fates` from its kernel history;
/// `move` fills it with a `Kept` entry per part, since a rigid transform
/// relocates rather than re-creates.
#[derive(Clone)]
pub struct OpRecord {
    pub feature: String,
    pub kind: OpKind,
    pub inputs: Vec<String>,
    pub output: String,
    /// One entry per input face, in the input shape's own face order.
    pub face_fates: Vec<Fate>,
    /// One entry per input edge, in the input shape's own edge order.
    pub edge_fates: Vec<Fate>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OpKind {
    Boolean,
    Fillet,
    Shell,
    Transform,
}

/// One profile segment an extrude or revolve swept, paired with the outline
/// index it came from and the face it produced. This is the `swept`/`rounded`/
/// `cap` vocabulary (§4.6): a name is a segment's design index, not a face
/// position, so it survives a rebuild.
#[derive(Clone, Debug)]
pub struct SweepSeg {
    /// "edge" for a design edge, "corner" for a rounded/chamfered corner.
    pub role: String,
    /// The design edge or corner number the segment came from.
    pub index: usize,
    /// The output face this segment produced.
    pub face: usize,
}

/// One sweep kept alive after it produced its shape, mirroring `SweepRecord`
/// in occt-build.ts. `from` is the sketch it was pulled/spun from; `closed`
/// marks a full revolve, which has no caps (capOf() refuses one for the same
/// reason). Cap face indices are None when the sweep is closed.
#[derive(Clone, Debug)]
pub struct SweepRecord {
    pub from: String,
    pub segments: Vec<SweepSeg>,
    pub cap_bottom: Option<usize>,
    pub cap_top: Option<usize>,
    pub closed: bool,
}

/// Everything a build produced: the shapes, and the operation history behind
/// them, keyed by the feature that ran them.
#[derive(Default)]
pub struct History {
    pub shapes: HashMap<String, TSolid>,
    pub ops: HashMap<String, Vec<OpRecord>>,
    /// One entry per sweep (extrude, revolve), keyed by the feature that ran it.
    pub sweeps: HashMap<String, SweepRecord>,
    /// Feature ids in build order.
    pub order: Vec<String>,
}

impl History {
    pub fn new() -> Self {
        History::default()
    }

    pub fn insert(&mut self, id: &str, solid: TSolid) {
        self.shapes.insert(id.to_string(), solid);
        self.order.push(id.to_string());
    }

    /// The face of `feature` that faces `dir`, chosen by how far its centroid
    /// sits along that direction — NOT by face index, which a rebuild may
    /// change. Mirrors `resolvePrimitiveFace` in topo-resolve.ts.
    pub fn primitive_face(&self, feature: &str, part: &str) -> Option<TFace> {
        let solid = self.shapes.get(feature)?;
        if part == "side" {
            // The curved wall of a cylinder or cone: the face that is neither
            // cap. Mirrors resolvePrimitiveFace's own 'side' arm in
            // topo-resolve.ts: a cap's centroid sits AT its axis extreme,
            // while a curved wall's area centroid sits on the axis BETWEEN
            // the extremes, so the two-cap exclusion picks exactly the wall.
            let top = self.primitive_face(feature, "+z")?;
            let bottom = self.primitive_face(feature, "-z")?;
            let (top_c, bot_c) = {
                let tb = top.borrow();
                let bb = bottom.borrow();
                (build::face_area_centroid(&tb).1, build::face_area_centroid(&bb).1)
            };
            for f in solid.faces() {
                let (_, c) = {
                    let fb = f.borrow();
                    build::face_area_centroid(&fb)
                };
                if crate::math::len(sub(c, top_c)) >= 1e-7 && crate::math::len(sub(c, bot_c)) >= 1e-7 {
                    return Some(f);
                }
            }
            return None;
        }
        let dir = dir_vec(part);
        if dir == [0.0, 0.0, 0.0] {
            return None;
        }
        let mut best: Option<TFace> = None;
        let mut best_score = f64::NEG_INFINITY;
        let mut best_area = f64::NEG_INFINITY;
        for f in solid.faces() {
            let (area, c) = {
                let b = f.borrow();
                build::face_area_centroid(&b)
            };
            let score = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2];
            if score > best_score + 1e-7 || ((score - best_score).abs() <= 1e-7 && area > best_area) {
                best = Some(f);
                best_score = best_score.max(score);
                best_area = area;
            }
        }
        best
    }

    /// Resolve an edge by the two faces that meet along it. The pair is
    /// unordered: the edge where +z meets +x is the same as where +x meets +z,
    /// and this finds the shared handle either way (§4.2).
    pub fn edge_between(&self, a: &TFace, b: &TFace) -> Option<TEdge> {
        let edges_a: Vec<TEdge> = {
            let fa = a.borrow();
            fa.boundary
                .iter()
                .flat_map(|w| {
                    w.borrow().edges.iter().map(|u| u.edge.clone()).collect::<Vec<_>>()
                })
                .collect()
        };
        let edges_b: Vec<TEdge> = {
            let fb = b.borrow();
            fb.boundary
                .iter()
                .flat_map(|w| {
                    w.borrow().edges.iter().map(|u| u.edge.clone()).collect::<Vec<_>>()
                })
                .collect()
        };
        edges_a
            .into_iter()
            .find(|e| edges_b.iter().any(|e2| topo::same(e, e2)))
    }

    /// Resolve a `primitive` name to a face.
    pub fn resolve_primitive_face(&self, feature: &str, part: &str) -> Option<TFace> {
        self.primitive_face(feature, part)
    }

    /// The face index a `swept` (role "edge") or `rounded` (role "corner")
    /// name refers to -- the segment's own index within `feature`'s sweep. The
    /// `from` sketch id is checked rather than trusted, exactly as
    /// topo-resolve.ts does: a name written against one sketch and read back
    /// after the pull was retargeted at another refers to an edge that exists
    /// but is not the one meant.
    pub fn sweep_face_index(
        &self,
        feature: &str,
        from: &str,
        role: &str,
        index: usize,
    ) -> Option<usize> {
        let rec = self.sweeps.get(feature)?;
        if rec.from != from {
            return None;
        }
        rec.segments
            .iter()
            .find(|s| s.role == role && s.index == index)
            .map(|s| s.face)
    }

    /// The cap face index for a `cap` name's end. A closed (full-turn) sweep
    /// has no caps, so it returns None -- capOf()'s same refusal.
    pub fn sweep_cap_index(&self, feature: &str, end: &str) -> Option<usize> {
        let rec = self.sweeps.get(feature)?;
        if rec.closed {
            return None;
        }
        match end {
            "top" => rec.cap_top,
            "bottom" => rec.cap_bottom,
            _ => None,
        }
    }

    /// Resolve a `carried` name: the input face `parent` of `of_feature` was
    /// carried through the operation(s) recorded for `feature`. Finds the op
    /// record that consumed `of_feature`, locates `parent` in that input's own
    /// face order by handle identity, and returns the output face its `Kept`
    /// fate points at. A `Deleted` or absent fate means the name does not
    /// resolve -- a null, never a guess (§4.6).
    pub fn carried_face(&self, feature: &str, of_feature: &str, parent: &TFace) -> Option<TFace> {
        let recs = self.ops.get(feature)?;
        let rec = recs.iter().find(|r| r.inputs.iter().any(|i| i == of_feature))?;
        let input_solid = self.shapes.get(of_feature)?;
        let out_solid = self.shapes.get(feature)?;
        let in_faces = input_solid.faces();
        let idx = in_faces.iter().position(|f| std::rc::Rc::ptr_eq(f, parent))?;
        // face_fates concatenates each input's faces in `inputs` order.
        let mut offset = 0usize;
        for i in &rec.inputs {
            if i == of_feature {
                break;
            }
            offset += self
                .shapes
                .get(i)
                .map(|s: &TSolid| s.faces().len())
                .unwrap_or(0);
        }
        match rec.face_fates.get(offset + idx)? {
            Fate::Kept(PartRef::Face(fi)) => out_solid.faces().get(*fi).cloned(),
            Fate::Deleted | Fate::Split(_) => None,
            _ => None,
        }
    }
}

    /// The unit direction a primitive `part` faces.
pub fn dir_vec(part: &str) -> Vec3 {
    match part {
        "+x" => [1.0, 0.0, 0.0],
        "-x" => [-1.0, 0.0, 0.0],
        "+y" => [0.0, 1.0, 0.0],
        "-y" => [0.0, -1.0, 0.0],
        "+z" => [0.0, 0.0, 1.0],
        "-z" => [0.0, 0.0, -1.0],
        _ => [0.0, 0.0, 0.0],
    }
}

/// The area and centroid of a resolved face, for the `resolve()` wasm export.
pub fn face_measure(face: &TFace) -> (f64, Vec3) {
    let b = face.borrow();
    build::face_area_centroid(&b)
}

/// The length and centroid of a resolved edge.
pub fn edge_measure(edge: &TEdge) -> (f64, Vec3) {
    let b = edge.borrow();
    build::edge_length_centroid(&b)
}

/// The surface a planar face lies on.
pub fn face_surface(face: &TFace) -> Option<Surface> {
    match &face.borrow().surface {
        s @ Surface::Plane(_) => Some(s.clone()),
        _ => None,
    }
}
