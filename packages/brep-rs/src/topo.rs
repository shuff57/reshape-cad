//! Layer `topo`: vertex / edge / wire / face / shell / solid (§4.2).
//!
//! Shared-handle model, as in truck: two faces that share an edge hold the SAME
//! edge handle (`Rc::ptr_eq`), and identity is handle identity, never geometry.
//! A face that uses an edge in reverse holds the same handle with the USE's
//! `forward` flipped, not a twin object.
//!
//! DEPARTURE 1: `Rc<RefCell<T>>`, not truck's `Arc<Mutex<T>>`. The wasm target
//! is single-threaded.
//!
//! DEPARTURE 2: a parameter-space curve (pcurve) is stored for every
//! (edge, face) use, on the [`EdgeUse`] in that face's wire, so an edge's
//! position in its own face's u/v space is one lookup away.
//!
//! TOPO/GEOM INDEPENDENCE. This module knows nothing about `crate::geom`. It is
//! generic over the curve payload `C` and surface payload `S`; the concrete
//! `Curve`/`Surface` come in at the `build` layer. That is what keeps the two
//! from importing each other.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::math::{Aabb, Vec3};

#[derive(Clone, Debug)]
pub struct Vertex {
    pub point: Vec3,
}

/// A parameter-space point pair plus a midway point, in the parent face's own
/// frame. Fractional (0..1) across the face, matching the `OnPoint` contract in
/// topo-name.ts.
#[derive(Clone, Copy, Debug)]
pub struct Pcurve {
    pub start: [f64; 2],
    pub end: [f64; 2],
    pub mid: [f64; 2],
}

/// One (edge, face) use: the shared edge handle, which way this face traverses
/// it, and where it sits in this face's u/v space. DEPARTURE 2.
#[derive(Clone)]
pub struct EdgeUse<C> {
    pub edge: EdgeRef<C>,
    pub forward: bool,
    pub pcurve: Pcurve,
}

/// `curve` is the geometry payload (a `geom::Curve` once instantiated). The two
/// vertex handles are the edge's endpoints; `forward` there is the edge's own
/// intrinsic direction, while each use carries its own orientation.
#[derive(Clone, Debug)]
pub struct Edge<C> {
    pub a: VertexRef,
    pub b: VertexRef,
    pub forward: bool,
    pub curve: C,
}

#[derive(Clone)]
pub struct Wire<C> {
    pub edges: Vec<EdgeUse<C>>,
}

/// Boundary wires, first is outer and the rest are holes, an orientation flag
/// and a surface. `uv_domain` is the face's own parameter rectangle on that
/// surface, ((u0,u1),(v0,v1)); a planar face leaves it as the unit placeholder
/// and is measured from its boundary instead.
#[derive(Clone)]
pub struct Face<C, S> {
    pub boundary: Vec<WireRef<C>>,
    pub forward: bool,
    pub surface: S,
    pub uv_domain: [[f64; 2]; 2],
}

#[derive(Clone)]
pub struct Shell<C, S> {
    pub faces: Vec<FaceRef<C, S>>,
}

#[derive(Clone)]
pub struct Solid<C, S> {
    pub shells: Vec<ShellRef<C, S>>,
}

pub type VertexRef = Rc<RefCell<Vertex>>;
pub type EdgeRef<C> = Rc<RefCell<Edge<C>>>;
pub type WireRef<C> = Rc<RefCell<Wire<C>>>;
pub type FaceRef<C, S> = Rc<RefCell<Face<C, S>>>;
pub type ShellRef<C, S> = Rc<RefCell<Shell<C, S>>>;
pub type SolidRef<C, S> = Rc<RefCell<Solid<C, S>>>;

pub fn vertex(point: Vec3) -> VertexRef {
    Rc::new(RefCell::new(Vertex { point }))
}

pub fn edge<C>(a: VertexRef, b: VertexRef, forward: bool, curve: C) -> EdgeRef<C> {
    Rc::new(RefCell::new(Edge {
        a,
        b,
        forward,
        curve,
    }))
}

/// True when two handles are the same object. This is the ONLY identity test
/// in the kernel — never a geometric comparison (§4.2).
pub fn same<C>(a: &EdgeRef<C>, b: &EdgeRef<C>) -> bool {
    Rc::ptr_eq(a, b)
}

fn key<T>(ptr: *const T) -> usize {
    ptr as usize
}

impl<C: Clone, S: Clone> Solid<C, S> {
    /// Every face, depth-first over the shells, with duplicates removed by
    /// handle identity.
    pub fn faces(&self) -> Vec<FaceRef<C, S>> {
        let mut out: Vec<FaceRef<C, S>> = Vec::new();
        for sh in &self.shells {
            for f in &sh.borrow().faces {
                if !out.iter().any(|u| Rc::ptr_eq(u, f)) {
                    out.push(f.clone());
                }
            }
        }
        out
    }

    /// Every edge, with duplicates removed by handle identity. Two faces that
    /// share an edge contribute it once.
    pub fn edges(&self) -> Vec<EdgeRef<C>> {
        let mut out: Vec<EdgeRef<C>> = Vec::new();
        for f in self.faces() {
            for w in &f.borrow().boundary {
                for u in &w.borrow().edges {
                    if !out.iter().any(|e| Rc::ptr_eq(e, &u.edge)) {
                        out.push(u.edge.clone());
                    }
                }
            }
        }
        out
    }

    pub fn vertices(&self) -> Vec<VertexRef> {
        let mut out: Vec<VertexRef> = Vec::new();
        for e in self.edges() {
            let e = e.borrow();
            for v in [&e.a, &e.b] {
                if !out.iter().any(|u| Rc::ptr_eq(u, v)) {
                    out.push(v.clone());
                }
            }
        }
        out
    }

    /// The tight axis-aligned bounding box of every vertex.
    pub fn aabb(&self) -> Aabb {
        let mut b = Aabb::empty();
        for v in self.vertices() {
            b.expand(v.borrow().point);
        }
        b
    }

    /// A deep copy whose handle sharing is preserved: two faces that shared an
    /// edge in the original share the corresponding edge in the copy. Geometry
    /// payloads are mapped through `f`/`g`, so `build` can transform a solid
    /// without `topo` ever naming `geom`.
    pub fn map_geom<C2: Clone, S2: Clone>(
        &self,
        f: &dyn Fn(&C) -> C2,
        g: &dyn Fn(&S) -> S2,
    ) -> Solid<C2, S2> {
        let mut vertices: HashMap<usize, VertexRef> = HashMap::new();
        let mut edges: HashMap<usize, EdgeRef<C2>> = HashMap::new();
        let mut shells = Vec::new();
        for sh in &self.shells {
            let mut faces = Vec::new();
            for face in &sh.borrow().faces {
                let face = face.borrow();
                let mut boundary = Vec::new();
                for w in &face.boundary {
                    let mut new_uses = Vec::new();
                    for u in &w.borrow().edges {
                        let addr = key(Rc::as_ptr(&u.edge));
                        let mapped = edges.entry(addr).or_insert_with(|| {
                            let eb = u.edge.borrow();
                            let va = {
                                let ka = key(Rc::as_ptr(&eb.a));
                                vertices
                                    .entry(ka)
                                    .or_insert_with(|| {
                                        Rc::new(RefCell::new(Vertex {
                                            point: eb.a.borrow().point,
                                        }))
                                    })
                                    .clone()
                            };
                            let vb = {
                                let kb = key(Rc::as_ptr(&eb.b));
                                vertices
                                    .entry(kb)
                                    .or_insert_with(|| {
                                        Rc::new(RefCell::new(Vertex {
                                            point: eb.b.borrow().point,
                                        }))
                                    })
                                    .clone()
                            };
                            Rc::new(RefCell::new(Edge {
                                a: va,
                                b: vb,
                                forward: eb.forward,
                                curve: f(&eb.curve),
                            }))
                        });
                        new_uses.push(EdgeUse {
                            edge: mapped.clone(),
                            forward: u.forward,
                            pcurve: u.pcurve,
                        });
                    }
                    boundary.push(Rc::new(RefCell::new(Wire { edges: new_uses })));
                }
                faces.push(Rc::new(RefCell::new(Face {
                    boundary,
                    forward: face.forward,
                    surface: g(&face.surface),
                    uv_domain: face.uv_domain,
                })));
            }
            shells.push(Rc::new(RefCell::new(Shell { faces })));
        }
        Solid { shells }
    }
}
