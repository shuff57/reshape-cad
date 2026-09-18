//! Layer `build`: primitives, and the transforms (move, mirror, pattern) that
//! act on them (§4.4). Depends on `math`, `geom`, `topo`.

use crate::geom::{self, Cone, Curve, Cylinder, Plane, SphereSurf, Surface, TorusSurf};
use crate::math::{add, cross, scale, sub, Aabb, Transform, Vec3};
use crate::topo::{self, Edge, Face, Shell, Solid, Wire};
use std::cell::RefCell;
use std::rc::Rc;

pub type Curve3 = Curve;
pub type Surface3 = Surface;
pub type TSolid = Solid<Curve3, Surface3>;
pub type TFace = topo::FaceRef<Curve3, Surface3>;
pub type TEdge = topo::EdgeRef<Curve3>;

/// The fields of a `BoxFeature` this slice reads. `round`/`roundStyle` are
/// parsed and refused rather than silently dropped: a silently sharp box is the
/// exact failure occt-build.ts's `roundedEdges()` comment documents.
#[derive(Clone, Debug, Default)]
pub struct BoxFeature {
    pub id: String,
    pub size: Vec3,
    pub center: Vec3,
    pub rotate: Option<Vec3>,
    pub round: Option<f64>,
}

#[derive(Clone, Debug, Default)]
pub struct MoveFeature {
    pub id: String,
    pub target: String,
    pub offset: Vec3,
    pub copy: bool,
}

/// The eight corners of the local box, in a fixed index order:
/// idx = i*4 + j*2 + k, where i is the x bin, j the y bin and k the z bin.
fn corner_index(i: usize, j: usize, k: usize) -> usize {
    i * 4 + j * 2 + k
}

/// Build a centred box as a B-rep solid with six planar faces, twelve shared
/// edges and eight shared vertices. Faces are wound CCW seen from outside, so
/// the divergence-theorem volume is positive.
///
/// The shared-handle property (§4.2) is built in: the twelve edges are created
/// once, keyed by their unordered vertex-index pair, and every face that borders
/// an edge holds the SAME handle, with `forward` saying which way that face
/// uses it.
pub fn box_solid(size: Vec3, center: Vec3, rotate: Option<Vec3>) -> TSolid {
    let [w, d, h] = size;
    let lo = add(center, [-w / 2.0, -d / 2.0, -h / 2.0]);
    let hi = add(center, [w / 2.0, d / 2.0, h / 2.0]);

    let mut verts: Vec<topo::VertexRef> = Vec::with_capacity(8);
    for i in 0..2 {
        for j in 0..2 {
            for k in 0..2 {
                let p = [
                    if i == 0 { lo[0] } else { hi[0] },
                    if j == 0 { lo[1] } else { hi[1] },
                    if k == 0 { lo[2] } else { hi[2] },
                ];
                let _ = corner_index(i, j, k);
                verts.push(topo::vertex(p));
            }
        }
    }

    // Twelve edges, created once. Key is the unordered vertex-index pair; the
    // stored edge runs min-index -> max-index.
    let mut edges: Vec<(usize, usize, TEdge)> = Vec::new();
    let mut edge_of = |a: usize, b: usize| -> (TEdge, bool) {
        let (kai, kbi) = (a.min(b), a.max(b));
        let forward = a == kai;
        if let Some((_, _, e)) = edges.iter().find(|(x, y, _)| *x == kai && *y == kbi) {
            return (e.clone(), forward);
        }
        let e = topo::edge(
            verts[kai].clone(),
            verts[kbi].clone(),
            true,
            Curve::Segment {
                a: verts[kai].borrow().point,
                b: verts[kbi].borrow().point,
            },
        );
        edges.push((kai, kbi, e.clone()));
        (e, forward)
    };

    // Six quads as vertex-index rings, CCW seen from outside.
    let quads: [(Vec3, [usize; 4]); 6] = [
        ([0.0, 0.0, 1.0], [corner_index(0, 0, 1), corner_index(1, 0, 1), corner_index(1, 1, 1), corner_index(0, 1, 1)]),
        ([0.0, 0.0, -1.0], [corner_index(0, 1, 0), corner_index(1, 1, 0), corner_index(1, 0, 0), corner_index(0, 0, 0)]),
        ([1.0, 0.0, 0.0], [corner_index(1, 0, 0), corner_index(1, 1, 0), corner_index(1, 1, 1), corner_index(1, 0, 1)]),
        ([-1.0, 0.0, 0.0], [corner_index(0, 1, 0), corner_index(0, 0, 0), corner_index(0, 0, 1), corner_index(0, 1, 1)]),
        ([0.0, 1.0, 0.0], [corner_index(1, 1, 0), corner_index(0, 1, 0), corner_index(0, 1, 1), corner_index(1, 1, 1)]),
        ([0.0, -1.0, 0.0], [corner_index(0, 0, 0), corner_index(1, 0, 0), corner_index(1, 0, 1), corner_index(0, 0, 1)]),
    ];

    let mut faces: Vec<TFace> = Vec::new();
    for (n, ring) in quads {
        let p: Vec<Vec3> = ring.iter().map(|i| verts[*i].borrow().point).collect();
        let plane = Plane::new(p[0], n);
        let mut wire = Vec::new();
        for i in 0..4 {
            let (e, forward) = edge_of(ring[i], ring[(i + 1) % 4]);
            let (sa, sb) = if forward { (p[i], p[(i + 1) % 4]) } else { (p[(i + 1) % 4], p[i]) };
            wire.push(topo::EdgeUse {
                edge: e,
                forward,
                pcurve: topo::Pcurve {
                    start: plane.project(sa),
                    end: plane.project(sb),
                    mid: plane.project(scale(add(sa, sb), 0.5)),
                },
            });
        }
        let wref = Rc::new(RefCell::new(Wire { edges: wire }));
        faces.push(Rc::new(RefCell::new(Face {
            boundary: vec![wref],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        })));
    }

    let shell = Rc::new(RefCell::new(Shell { faces }));
    let solid = Solid { shells: vec![shell] };
    if let Some(r) = rotate {
        if r[0] != 0.0 || r[1] != 0.0 || r[2] != 0.0 {
            // About the box's OWN centre, matching occt-build.ts's ordering:
            // centre the shape, then turn it, then place it.
            let t = Transform::euler_deg(r[0], r[1], r[2]).about(center);
            return transform_solid(&solid, &t);
        }
    }
    solid
}

/// Build a hexahedron from eight corner positions, in `box_solid`'s corner
/// index order (idx = i*4 + j*2 + k, i the x bin, j the y bin, k the z bin):
/// the same twelve shared edges and six quad faces, but each face's plane is
/// read off its own ring by Newell's method instead of assumed axis-aligned.
/// This is what a drafted box needs -- five faces stay on their original
/// planes and the drafted face tilts, every one still planar.
pub fn corner_solid(verts: &[Vec3; 8]) -> TSolid {
    let at = |i: usize, j: usize, k: usize| verts[i * 4 + j * 2 + k];

    let mut vrefs: Vec<topo::VertexRef> = Vec::with_capacity(8);
    for v in verts {
        vrefs.push(topo::vertex(*v));
    }

    let mut edges: Vec<(usize, usize, TEdge)> = Vec::new();
    let mut edge_of = |a: usize, b: usize| -> (TEdge, bool) {
        let (kai, kbi) = (a.min(b), a.max(b));
        let forward = a == kai;
        if let Some((_, _, e)) = edges.iter().find(|(x, y, _)| *x == kai && *y == kbi) {
            return (e.clone(), forward);
        }
        let e = topo::edge(
            vrefs[kai].clone(),
            vrefs[kbi].clone(),
            true,
            Curve::Segment {
                a: vrefs[kai].borrow().point,
                b: vrefs[kbi].borrow().point,
            },
        );
        edges.push((kai, kbi, e.clone()));
        (e, forward)
    };

    let quads: [[usize; 4]; 6] = [
        [corner_index(0, 0, 1), corner_index(1, 0, 1), corner_index(1, 1, 1), corner_index(0, 1, 1)],
        [corner_index(0, 1, 0), corner_index(1, 1, 0), corner_index(1, 0, 0), corner_index(0, 0, 0)],
        [corner_index(1, 0, 0), corner_index(1, 1, 0), corner_index(1, 1, 1), corner_index(1, 0, 1)],
        [corner_index(0, 1, 0), corner_index(0, 0, 0), corner_index(0, 0, 1), corner_index(0, 1, 1)],
        [corner_index(1, 1, 0), corner_index(0, 1, 0), corner_index(0, 1, 1), corner_index(1, 1, 1)],
        [corner_index(0, 0, 0), corner_index(1, 0, 0), corner_index(1, 0, 1), corner_index(0, 0, 1)],
    ];

    let newell = |ring: &[Vec3]| -> Vec3 {
        let mut acc = [0.0, 0.0, 0.0];
        for i in 0..ring.len() {
            let j = (i + 1) % ring.len();
            acc = add(acc, cross(sub(ring[i], ring[0]), sub(ring[j], ring[0])));
        }
        acc
    };

    let mut faces: Vec<TFace> = Vec::new();
    for ring in &quads {
        let p: Vec<Vec3> = ring.iter().map(|i| vrefs[*i].borrow().point).collect();
        let nrm = crate::math::normalize(newell(&p));
        let plane = Plane::new(p[0], nrm);
        let mut wire = Vec::new();
        for i in 0..4 {
            let (e, forward) = edge_of(ring[i], ring[(i + 1) % 4]);
            let (sa, sb) = if forward { (p[i], p[(i + 1) % 4]) } else { (p[(i + 1) % 4], p[i]) };
            wire.push(topo::EdgeUse {
                edge: e,
                forward,
                pcurve: topo::Pcurve {
                    start: plane.project(sa),
                    end: plane.project(sb),
                    mid: plane.project(scale(add(sa, sb), 0.5)),
                },
            });
        }
        let wref = Rc::new(RefCell::new(Wire { edges: wire }));
        faces.push(Rc::new(RefCell::new(Face {
            boundary: vec![wref],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        })));
    }

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

/// Build a solid from an explicit planar polyhedron: `points` are the vertex
/// positions, and each entry of `faces_in` is (outward normal, ring of vertex
/// indices, CCW seen from outside). Any polygon size is allowed (triangle,
/// quad, ...). Edges are shared by vertex-index pair exactly like
/// `box_solid`/`corner_solid`, so two rings that name the same pair (in
/// either order) get the same edge handle -- what keeps the round-primitive
/// box (26 faces: 6 flat + 12 edge strips + 8 corner triangles) watertight.
pub fn polyhedron_solid(points: &[Vec3], faces_in: &[(Vec3, Vec<usize>)]) -> TSolid {
    let verts: Vec<topo::VertexRef> = points.iter().map(|p| topo::vertex(*p)).collect();
    let mut edges: Vec<(usize, usize, TEdge)> = Vec::new();
    let mut edge_of = |a: usize, b: usize| -> (TEdge, bool) {
        let (kai, kbi) = (a.min(b), a.max(b));
        let forward = a == kai;
        if let Some((_, _, e)) = edges.iter().find(|(x, y, _)| *x == kai && *y == kbi) {
            return (e.clone(), forward);
        }
        let e = topo::edge(
            verts[kai].clone(),
            verts[kbi].clone(),
            true,
            Curve::Segment {
                a: verts[kai].borrow().point,
                b: verts[kbi].borrow().point,
            },
        );
        edges.push((kai, kbi, e.clone()));
        (e, forward)
    };
    let mut faces: Vec<TFace> = Vec::new();
    for (n, ring) in faces_in {
        let p: Vec<Vec3> = ring.iter().map(|i| verts[*i].borrow().point).collect();
        let plane = Plane::new(p[0], *n);
        let m = ring.len();
        let mut wire = Vec::with_capacity(m);
        for i in 0..m {
            let (e, forward) = edge_of(ring[i], ring[(i + 1) % m]);
            let (sa, sb) = if forward { (p[i], p[(i + 1) % m]) } else { (p[(i + 1) % m], p[i]) };
            wire.push(topo::EdgeUse {
                edge: e,
                forward,
                pcurve: topo::Pcurve {
                    start: plane.project(sa),
                    end: plane.project(sb),
                    mid: plane.project(scale(add(sa, sb), 0.5)),
                },
            });
        }
        let wref = Rc::new(RefCell::new(Wire { edges: wire }));
        faces.push(Rc::new(RefCell::new(Face {
            boundary: vec![wref],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        })));
    }
    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

/// The round-primitive box, fillet style (SPEC-brep-round.md): the same 6
/// flat faces as `chamfer_box`/`polyhedron_solid` would give (each inset by
/// `rad`), but the 12 edge bevels are quarter-cylinders and the 8 corners
/// spherical octants, all tangent to their neighbours so the shell stays
/// watertight. Point naming: A sits on the Y face, B on the Z face, C on the
/// X face -- same convention the chamfer build uses.
pub fn fillet_box(hx: f64, hy: f64, hz: f64, rad: f64, center: Vec3) -> TSolid {
    let sgn = |s: usize| if s == 1 { 1.0 } else { -1.0 };
    let pt = |which: usize, sx: usize, sy: usize, sz: usize| -> Vec3 {
        let (x, y, z) = match which {
            0 => (sgn(sx) * (hx - rad), sgn(sy) * hy, sgn(sz) * (hz - rad)),
            1 => (sgn(sx) * (hx - rad), sgn(sy) * (hy - rad), sgn(sz) * hz),
            _ => (sgn(sx) * hx, sgn(sy) * (hy - rad), sgn(sz) * (hz - rad)),
        };
        add(center, [x, y, z])
    };
    let idx = |which: usize, sx: usize, sy: usize, sz: usize| which * 8 + sx * 4 + sy * 2 + sz;
    let verts: Vec<topo::VertexRef> = (0..24)
        .map(|i| topo::vertex(pt(i / 8, (i / 4) % 2, (i / 2) % 2, i % 2)))
        .collect();
    let av = |sx: usize, sy: usize, sz: usize| verts[idx(0, sx, sy, sz)].clone();
    let bv = |sx: usize, sy: usize, sz: usize| verts[idx(1, sx, sy, sz)].clone();
    let cv = |sx: usize, sy: usize, sz: usize| verts[idx(2, sx, sy, sz)].clone();

    let hp = std::f64::consts::FRAC_PI_2;
    let seg = |va: &topo::VertexRef, vb: &topo::VertexRef| -> TEdge {
        topo::edge(va.clone(), vb.clone(), true, Curve::Segment { a: va.borrow().point, b: vb.borrow().point })
    };
    let arc = |centre: Vec3, radius: f64, normal: Vec3, x_axis: Vec3, va: &topo::VertexRef, vb: &topo::VertexRef| -> TEdge {
        topo::edge(va.clone(), vb.clone(), true, Curve::Arc { center: centre, radius, normal, x_axis, sweep: hp })
    };
    // Whether `e`'s own intrinsic direction (its `a` endpoint) starts at
    // `from`. A strip's own two end arcs are always built to match how that
    // strip's wire uses them, but a corner sphere shares those SAME arc
    // handles under its own (independent) parity, so its wire below asks
    // this rather than assuming a fixed true/false.
    let dir = |e: &TEdge, from: &topo::VertexRef| -> bool { Rc::ptr_eq(&e.borrow().a, from) };

    use std::collections::HashMap;
    let mut long_a_varx: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut long_a_varz: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut long_b_varx: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut long_b_vary: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut long_c_vary: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut long_c_varz: HashMap<(usize, usize), TEdge> = HashMap::new();
    let mut arc_z: HashMap<(usize, usize, usize), TEdge> = HashMap::new();
    let mut arc_x: HashMap<(usize, usize, usize), TEdge> = HashMap::new();
    let mut arc_y: HashMap<(usize, usize, usize), TEdge> = HashMap::new();

    let mut faces: Vec<TFace> = Vec::with_capacity(26);

    // 4 Z-strips: axis +Z, e1/e2 -> C/A (swapped when sx!=sy, to keep
    // cross(e1,e2) == +axis -- otherwise the cylinder's own outward sense
    // flips and its volume contribution cancels instead of adding (found by
    // running `debug_fillet_box_face_breakdown`: the 4 Z-strip volume terms
    // were +,-,-,+ in (sx,sy) order, i.e. exactly this parity). Shortened by
    // `rad` at both z-ends; the end arcs are shared with the corner spheres.
    for sx in 0..2 {
        for sy in 0..2 {
            let origin = add(center, [sgn(sx) * (hx - rad), sgn(sy) * (hy - rad), 0.0]);
            let axis = [0.0, 0.0, 1.0];
            let flip = sx != sy;
            let (e1, e2) = if !flip { ([sgn(sx), 0.0, 0.0], [0.0, sgn(sy), 0.0]) } else { ([0.0, sgn(sy), 0.0], [sgn(sx), 0.0, 0.0]) };
            let (vmin, vmax) = (-(hz - rad), hz - rad);
            let (c_lo, a_lo, c_hi, a_hi) = (cv(sx, sy, 0), av(sx, sy, 0), cv(sx, sy, 1), av(sx, sy, 1));
            let (u0_lo, u0_hi, upi2_lo, upi2_hi) = if !flip { (&c_lo, &c_hi, &a_lo, &a_hi) } else { (&a_lo, &a_hi, &c_lo, &c_hi) };
            let arc_lo = arc(add(origin, [0.0, 0.0, vmin]), rad, axis, e1, u0_lo, upi2_lo);
            let arc_hi = arc(add(origin, [0.0, 0.0, vmax]), rad, axis, e1, u0_hi, upi2_hi);
            let long_a = long_a_varz.entry((sx, sy)).or_insert_with(|| seg(&a_lo, &a_hi)).clone();
            let long_c = long_c_varz.entry((sx, sy)).or_insert_with(|| seg(&c_lo, &c_hi)).clone();
            let (long_u0, long_upi2) = if !flip { (&long_c, &long_a) } else { (&long_a, &long_c) };
            let uses = vec![
                cyl_arc_use(&arc_lo, true, 0.0, hp, vmin, vmin),
                cyl_arc_use(long_upi2, true, hp, hp, vmin, vmax),
                cyl_arc_use(&arc_hi, false, hp, 0.0, vmax, vmax),
                cyl_arc_use(long_u0, false, 0.0, 0.0, vmax, vmin),
            ];
            faces.push(make_face(
                Surface::Cylinder(Cylinder { origin, axis, e1, e2, radius: rad, vmin, vmax, arc: Some(geom::ArcRange { start: 0.0, span: hp }) }),
                [[0.0, hp], [vmin, vmax]],
                uses,
            ));
            arc_z.insert((sx, sy, 0), arc_lo);
            arc_z.insert((sx, sy, 1), arc_hi);
        }
    }
    // 4 X-strips: axis +X, e1/e2 -> A/B (swapped when sy!=sz).
    for sy in 0..2 {
        for sz in 0..2 {
            let origin = add(center, [0.0, sgn(sy) * (hy - rad), sgn(sz) * (hz - rad)]);
            let axis = [1.0, 0.0, 0.0];
            let flip = sy != sz;
            let (e1, e2) = if !flip { ([0.0, sgn(sy), 0.0], [0.0, 0.0, sgn(sz)]) } else { ([0.0, 0.0, sgn(sz)], [0.0, sgn(sy), 0.0]) };
            let (vmin, vmax) = (-(hx - rad), hx - rad);
            let (a_lo, b_lo, a_hi, b_hi) = (av(0, sy, sz), bv(0, sy, sz), av(1, sy, sz), bv(1, sy, sz));
            let (u0_lo, u0_hi, upi2_lo, upi2_hi) = if !flip { (&a_lo, &a_hi, &b_lo, &b_hi) } else { (&b_lo, &b_hi, &a_lo, &a_hi) };
            let arc_lo = arc(add(origin, [vmin, 0.0, 0.0]), rad, axis, e1, u0_lo, upi2_lo);
            let arc_hi = arc(add(origin, [vmax, 0.0, 0.0]), rad, axis, e1, u0_hi, upi2_hi);
            let long_a = long_a_varx.entry((sy, sz)).or_insert_with(|| seg(&a_lo, &a_hi)).clone();
            let long_b = long_b_varx.entry((sy, sz)).or_insert_with(|| seg(&b_lo, &b_hi)).clone();
            let (long_u0, long_upi2) = if !flip { (&long_a, &long_b) } else { (&long_b, &long_a) };
            let uses = vec![
                cyl_arc_use(&arc_lo, true, 0.0, hp, vmin, vmin),
                cyl_arc_use(long_upi2, true, hp, hp, vmin, vmax),
                cyl_arc_use(&arc_hi, false, hp, 0.0, vmax, vmax),
                cyl_arc_use(long_u0, false, 0.0, 0.0, vmax, vmin),
            ];
            faces.push(make_face(
                Surface::Cylinder(Cylinder { origin, axis, e1, e2, radius: rad, vmin, vmax, arc: Some(geom::ArcRange { start: 0.0, span: hp }) }),
                [[0.0, hp], [vmin, vmax]],
                uses,
            ));
            arc_x.insert((0, sy, sz), arc_lo);
            arc_x.insert((1, sy, sz), arc_hi);
        }
    }
    // 4 Y-strips: axis +Y, e1/e2 -> B/C (swapped when sx!=sz).
    for sx in 0..2 {
        for sz in 0..2 {
            let origin = add(center, [sgn(sx) * (hx - rad), 0.0, sgn(sz) * (hz - rad)]);
            let axis = [0.0, 1.0, 0.0];
            let flip = sx != sz;
            let (e1, e2) = if !flip { ([0.0, 0.0, sgn(sz)], [sgn(sx), 0.0, 0.0]) } else { ([sgn(sx), 0.0, 0.0], [0.0, 0.0, sgn(sz)]) };
            let (vmin, vmax) = (-(hy - rad), hy - rad);
            let (b_lo, c_lo, b_hi, c_hi) = (bv(sx, 0, sz), cv(sx, 0, sz), bv(sx, 1, sz), cv(sx, 1, sz));
            let (u0_lo, u0_hi, upi2_lo, upi2_hi) = if !flip { (&b_lo, &b_hi, &c_lo, &c_hi) } else { (&c_lo, &c_hi, &b_lo, &b_hi) };
            let arc_lo = arc(add(origin, [0.0, vmin, 0.0]), rad, axis, e1, u0_lo, upi2_lo);
            let arc_hi = arc(add(origin, [0.0, vmax, 0.0]), rad, axis, e1, u0_hi, upi2_hi);
            let long_b = long_b_vary.entry((sx, sz)).or_insert_with(|| seg(&b_lo, &b_hi)).clone();
            let long_c = long_c_vary.entry((sx, sz)).or_insert_with(|| seg(&c_lo, &c_hi)).clone();
            let (long_u0, long_upi2) = if !flip { (&long_b, &long_c) } else { (&long_c, &long_b) };
            let uses = vec![
                cyl_arc_use(&arc_lo, true, 0.0, hp, vmin, vmin),
                cyl_arc_use(long_upi2, true, hp, hp, vmin, vmax),
                cyl_arc_use(&arc_hi, false, hp, 0.0, vmax, vmax),
                cyl_arc_use(long_u0, false, 0.0, 0.0, vmax, vmin),
            ];
            faces.push(make_face(
                Surface::Cylinder(Cylinder { origin, axis, e1, e2, radius: rad, vmin, vmax, arc: Some(geom::ArcRange { start: 0.0, span: hp }) }),
                [[0.0, hp], [vmin, vmax]],
                uses,
            ));
            arc_y.insert((sx, 0, sz), arc_lo);
            arc_y.insert((sx, 1, sz), arc_hi);
        }
    }

    // 6 flat faces, same rings as the chamfer build, reusing the long edges
    // the strips above already created.
    let xface = |sx: usize| -> TFace {
        let n = [sgn(sx), 0.0, 0.0];
        let ring: [(usize, usize); 4] = if sx == 1 { [(0, 0), (1, 0), (1, 1), (0, 1)] } else { [(1, 0), (0, 0), (0, 1), (1, 1)] };
        let p: Vec<Vec3> = ring.iter().map(|&(sy, sz)| pt(2, sx, sy, sz)).collect();
        let plane = Plane::new(p[0], n);
        let edge_for = |i: usize| -> (TEdge, bool) {
            let (sy0, sz0) = ring[i];
            let (sy1, sz1) = ring[(i + 1) % 4];
            if sy0 != sy1 {
                (long_c_vary[&(sx, sz0)].clone(), sy0 < sy1)
            } else {
                (long_c_varz[&(sx, sy0)].clone(), sz0 < sz1)
            }
        };
        let uses = (0..4).map(|i| planar_seg_use(&plane, &edge_for(i).0, edge_for(i).1, p[i], p[(i + 1) % 4])).collect();
        make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses)
    };
    let yface = |sy: usize| -> TFace {
        let n = [0.0, sgn(sy), 0.0];
        let ring: [(usize, usize); 4] = if sy == 1 { [(1, 0), (0, 0), (0, 1), (1, 1)] } else { [(0, 0), (1, 0), (1, 1), (0, 1)] };
        let p: Vec<Vec3> = ring.iter().map(|&(sx, sz)| pt(0, sx, sy, sz)).collect();
        let plane = Plane::new(p[0], n);
        let edge_for = |i: usize| -> (TEdge, bool) {
            let (sx0, sz0) = ring[i];
            let (sx1, sz1) = ring[(i + 1) % 4];
            if sx0 != sx1 {
                (long_a_varx[&(sy, sz0)].clone(), sx0 < sx1)
            } else {
                (long_a_varz[&(sx0, sy)].clone(), sz0 < sz1)
            }
        };
        let uses = (0..4).map(|i| planar_seg_use(&plane, &edge_for(i).0, edge_for(i).1, p[i], p[(i + 1) % 4])).collect();
        make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses)
    };
    let zface = |sz: usize| -> TFace {
        let n = [0.0, 0.0, sgn(sz)];
        let ring: [(usize, usize); 4] = if sz == 1 { [(0, 0), (1, 0), (1, 1), (0, 1)] } else { [(0, 1), (1, 1), (1, 0), (0, 0)] };
        let p: Vec<Vec3> = ring.iter().map(|&(sx, sy)| pt(1, sx, sy, sz)).collect();
        let plane = Plane::new(p[0], n);
        let edge_for = |i: usize| -> (TEdge, bool) {
            let (sx0, sy0) = ring[i];
            let (sx1, sy1) = ring[(i + 1) % 4];
            if sx0 != sx1 {
                (long_b_varx[&(sy0, sz)].clone(), sx0 < sx1)
            } else {
                (long_b_vary[&(sx0, sz)].clone(), sy0 < sy1)
            }
        };
        let uses = (0..4).map(|i| planar_seg_use(&plane, &edge_for(i).0, edge_for(i).1, p[i], p[(i + 1) % 4])).collect();
        make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses)
    };
    for sx in 0..2 { faces.push(xface(sx)); }
    for sy in 0..2 { faces.push(yface(sy)); }
    for sz in 0..2 { faces.push(zface(sz)); }

    // 8 corner spheres: an octant tangent to the 3 adjacent strips, sharing
    // their end arcs. axis picks the pole toward +sz*z; e1/e2 toward +sx*x
    // and +sy*y, so u=0 -> B (v=0 pole), the u=0 meridian is arc_y (B->C),
    // the v=hp equator is arc_z (C->A) and the u=hp meridian is arc_x (A->B).
    for sx in 0..2 {
        for sy in 0..2 {
            for sz in 0..2 {
                let centre = add(center, [sgn(sx) * (hx - rad), sgn(sy) * (hy - rad), sgn(sz) * (hz - rad)]);
                let axis = [0.0, 0.0, -sgn(sz)];
                // Same cross(e1,e2)==+axis requirement as the strips: swap
                // e1/e2 when the corner's own sign parity is odd, which
                // (per the same debug run) swaps which strip-shared arc sits
                // at u=0 vs u=hp, while the v=hp equator arc (arc_z) keeps
                // its slot either way.
                let flip = (sx + sy + sz) % 2 == 1;
                let (e1, e2) = if !flip { ([sgn(sx), 0.0, 0.0], [0.0, sgn(sy), 0.0]) } else { ([0.0, sgn(sy), 0.0], [sgn(sx), 0.0, 0.0]) };
                let (apt, bpt, cpt) = (av(sx, sy, sz), bv(sx, sy, sz), cv(sx, sy, sz));
                let ay = arc_y[&(sx, sy, sz)].clone();
                let az = arc_z[&(sx, sy, sz)].clone();
                let ax = arc_x[&(sx, sy, sz)].clone();
                // Intended traversal (independent of each arc's own flip,
                // fixed by the strips): slot0 B->{C,A}, az {C,A}->{A,C},
                // slot2 {A,C}->B -- `dir` reads the actual forward off
                // whichever end this shared arc happens to have been built
                // with, since the strip's own parity need not match this
                // corner's.
                let (slot0, slot2, az_from, slot2_from) = if !flip { (&ay, &ax, &cpt, &apt) } else { (&ax, &ay, &apt, &cpt) };
                let uses = vec![
                    cyl_arc_use(slot0, dir(slot0, &bpt), 0.0, 0.0, 0.0, hp),
                    cyl_arc_use(&az, dir(&az, az_from), 0.0, hp, hp, hp),
                    cyl_arc_use(slot2, dir(slot2, slot2_from), hp, hp, hp, 0.0),
                ];
                faces.push(make_face(
                    Surface::Sphere(SphereSurf { center: centre, radius: rad, axis, e1, e2, u_range: [0.0, hp], v_range: [0.0, hp], trim: None }),
                    [[0.0, hp], [0.0, hp]],
                    uses,
                ));
            }
        }
    }

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

/// Apply a rigid transform to every vertex point and geometry payload. Handle
/// sharing is preserved by `topo::Solid::map_geom`; vertex POINTS are moved
/// afterwards, and each face's plane frame and pcurves rebuilt from the moved
/// boundary so the stored surface sits on the transformed face.
pub fn transform_solid(solid: &TSolid, t: &Transform) -> TSolid {
    let moved = solid.map_geom(&|c: &Curve3| c.transform(t), &|s: &Surface3| s.transform(t));
    for v in moved.vertices() {
        let p = v.borrow().point;
        v.borrow_mut().point = t.apply(p);
    }
    for fc in moved.faces() {
        // Only a planar face has its pcurves rebuilt from the boundary; a
        // curved face's pcurves already follow its surface through map_geom.
        let plane = match &fc.borrow().surface {
            Surface3::Plane(p) => Some(p.clone()),
            _ => None,
        };
        let Some(plane) = plane else { continue };
        let pts = {
            let f = fc.borrow();
            face_ring_points(&f)
        };
        if pts.len() < 3 {
            continue;
        }
        let mut fb = fc.borrow_mut();
        for w in &mut fb.boundary {
            let uses = &mut w.borrow_mut().edges;
            for u in uses.iter_mut() {
                let (a, b) = {
                    let eb = u.edge.borrow();
                    let a = eb.a.borrow().point;
                    let b = eb.b.borrow().point;
                    (a, b)
                };
                let (sa, sb) = if u.forward { (a, b) } else { (b, a) };
                u.pcurve = topo::Pcurve {
                    start: plane.project(sa),
                    end: plane.project(sb),
                    mid: plane.project(scale(add(sa, sb), 0.5)),
                };
            }
        }
    }
    moved
}

/// Combine the shells of two solids into one solid with no boolean. This is
/// only valid when the pieces do NOT overlap: every face survives with its own
/// handle and the divergence-theorem volume sums both shells exactly. Callers
/// must check for overlap first (see `aabbs_overlap`) and refuse otherwise.
pub fn combine(a: &TSolid, b: &TSolid) -> TSolid {
    let mut shells = a.shells.clone();
    shells.extend(b.shells.iter().cloned());
    Solid { shells }
}

/// True when two bounding boxes overlap with positive interior in every axis./// CONSERVATIVE: it can say yes when only the boxes interpenetrate, but it is
/// never wrong when it says no. A pair that merely touches (mirror plane,
/// adjacent pattern instance) reports false, which is what lets disjoint
/// pieces be combined without a boolean.
pub fn aabbs_overlap(a: &Aabb, b: &Aabb) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    (0..3).all(|i| a.lo[i] < b.hi[i] - 1e-9 && b.lo[i] < a.hi[i] - 1e-9)
}

/// The ordered vertex ring of a face's outer wire, honouring each edge's
/// orientation flag. This is the polygon area and volume consume.
pub fn face_ring_points(face: &Face<Curve3, Surface3>) -> Vec<Vec3> {
    let Some(w) = face.boundary.first() else {
        return Vec::new();
    };
    let uses = w.borrow().edges.clone();
    let mut out = Vec::with_capacity(uses.len());
    for u in uses {
        let e = u.edge.borrow();
        // The USE carries the orientation: the shared edge has one intrinsic
        // direction, and each face that borders it traverses it either way.
        out.push(if u.forward {
            e.a.borrow().point
        } else {
            e.b.borrow().point
        });
    }
    out
}

/// The exact volume of a solid, by the divergence theorem. Every face
/// contributes its surface integral ∫∫ r·n dS: a planar face is `area · n·centroid`
/// (which works for a circular cap, where a triangle fan from a vertex ring would
/// not), a curved face integrates ∂r/∂u × ∂r/∂v over its parameter domain.
/// For an outward-wound closed boundary the sum is 3V.
pub fn solid_volume(solid: &TSolid) -> f64 {
    signed_volume(solid).abs()
}

/// The signed divergence-theorem sum, `acc / 3`: positive when the boundary is
/// wound outward, negative when a built solid came out inside-out. A swept
/// prism's walls are inverted whenever the sweep opposes the profile's own
/// handedness (`dot(cross(u_axis, v_axis), sweep) < 0`), so builders of a
/// negative-sweep tool check this sign rather than trusting `solid_volume`.
pub fn signed_volume(solid: &TSolid) -> f64 {
    let mut acc = 0.0;
    for fc in solid.faces() {
        let (surface, plane, edges) = {
            let f = fc.borrow();
            (
                f.surface.clone(),
                match &f.surface {
                    Surface3::Plane(p) => Some(p.clone()),
                    _ => None,
                },
                match &f.surface {
                    Surface3::Plane(_) => face_edges(&f),
                    _ => Vec::new(),
                },
            )
        };
        match (&surface, plane) {
            (Surface3::Plane(_), Some(p)) => {
                let (area, c) = geom::planar_measure(&p, &edges);
                acc += area * crate::math::dot(p.n, c);
            }
            _ => acc += surface.volume_term(),
        }
    }
    acc / 3.0
}

/// Build a copy of `solid` whose faces all wind outward, if a negative signed
/// volume says the whole solid came out inside-out. Used for a pocket tool
/// swept along a direction that opposes the profile's handedness; without this
/// the void shell's normals point the wrong way and the volume is wrong.
pub fn ensure_outward(solid: &TSolid) -> TSolid {
    if signed_volume(solid) >= 0.0 {
        return solid.clone();
    }
    let shells = solid
        .shells
        .iter()
        .map(|sh| {
            let faces = sh
                .borrow()
                .faces
                .iter()
                .map(|f| reversed_face(&f.borrow()))
                .collect();
            Rc::new(RefCell::new(Shell { faces }))
        })
        .collect();
    Solid { shells }
}

/// A face with its surface orientation reversed (outward normal flipped),
/// the boundary wires kept as-is. Planar and cylindrical faces -- everything a
/// swept tool can have -- reverse their frame; anything else is returned
/// unchanged, which a caller should treat as "could not fix".
fn reversed_face(face: &Face<Curve3, Surface3>) -> TFace {
    let surf = match &face.surface {
        Surface::Plane(p) => Surface::Plane(Plane { origin: p.origin, n: scale(p.n, -1.0), u: p.u, v: p.v }),
        Surface::Cylinder(c) => Surface::Cylinder(Cylinder {
            origin: c.origin,
            axis: c.axis,
            e1: c.e1,
            e2: scale(c.e2, -1.0),
            radius: c.radius,
            vmin: c.vmin,
            vmax: c.vmax,
            arc: c.arc.clone(),
        }),
        other => other.clone(),
    };
    Rc::new(RefCell::new(Face {
        boundary: face.boundary.clone(),
        forward: face.forward,
        surface: surf,
        uv_domain: face.uv_domain,
    }))
}

pub fn solid_aabb(solid: &TSolid) -> Aabb {
    let mut b = Aabb::empty();
    for fc in solid.faces() {
        let (surface, edges) = {
            let f = fc.borrow();
            (
                f.surface.clone(),
                match &f.surface {
                    // The curve's own aabb, not just its endpoints: a planar
                    // face can be bounded by an Arc (SPEC pinned math, a
                    // sphere-cut box wall), which bulges past the straight
                    // line between its vertices. For a segment-only face
                    // this is identical to the old vertex-ring box.
                    Surface3::Plane(_) => face_edges(&f),
                    _ => Vec::new(),
                },
            )
        };
        if matches!(surface, Surface3::Plane(_)) {
            for e in edges {
                b.union(&e.curve.aabb());
            }
        } else {
            b.union(&surface.aabb());
        }
    }
    b
}

/// The area and centroid of a face. A planar face is measured from its
/// boundary; an analytic curved face integrates over its parameter domain.
pub fn face_area_centroid(face: &Face<Curve3, Surface3>) -> (f64, Vec3) {
    match &face.surface {
        Surface3::Plane(p) => {
            let edges = face_edges(face);
            geom::planar_measure(p, &edges)
        }
        surface => surface.area_centroid(),
    }
}

/// The (curve, use-orientation) of every edge of a face's outer wire.
fn face_edges(face: &Face<Curve3, Surface3>) -> Vec<geom::EdgeOnFace> {
    let mut out = Vec::new();
    for w in &face.boundary {
        for u in &w.borrow().edges {
            out.push(geom::EdgeOnFace {
                curve: u.edge.borrow().curve.clone(),
                forward: u.forward,
            });
        }
    }
    out
}

/// The linear length of an edge and its centroid.
pub fn edge_length_centroid(edge: &Edge<Curve3>) -> (f64, Vec3) {
    (edge.curve.length(), edge.curve.centroid())
}

// ---------------------------------------------------------------------------
// Curved primitives (§4.4). Each is built directly as analytic B-rep: a curved
// lateral face, a cap on top and a cap on the bottom, sharing the rim edges
// the way a boolean later expects (§4.2).
// ---------------------------------------------------------------------------

/// One face assembled from a surface, a uv domain and a boundary of edge uses.
fn make_face(
    surface: Surface,
    uv_domain: [[f64; 2]; 2],
    uses: Vec<topo::EdgeUse<Curve3>>,
) -> TFace {
    let wref = Rc::new(RefCell::new(Wire { edges: uses }));
    Rc::new(RefCell::new(Face {
        boundary: vec![wref],
        forward: true,
        surface,
        uv_domain,
    }))
}


/// A cylinder centred on `center`, axis +Z, radius `radius`, height `height`.
pub fn cylinder_solid(center: Vec3, radius: f64, height: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let zlo = add(center, scale(z, -height / 2.0));
    let zhi = add(center, scale(z, height / 2.0));

    // One vertical seam vertex on each rim, at angle 0 (the e1 direction).
    let v_seam_lo = topo::vertex(add(zlo, scale(e1, radius)));
    let v_seam_hi = topo::vertex(add(zhi, scale(e1, radius)));

    let rim = |zc: Vec3| Curve::Circle {
        center: zc,
        radius,
        normal: z,
    };
    let seam_lo = topo::edge(
        v_seam_lo.clone(),
        v_seam_lo.clone(),
        true,
        rim(zlo),
    );
    let seam_hi = topo::edge(
        v_seam_hi.clone(),
        v_seam_hi.clone(),
        true,
        rim(zhi),
    );

    // Lateral face: seam edge up, then the top rim backwards. u = angle
    // (0 at e1, increasing toward e2), v = height from zlo to zhi.
    let lateral = make_face(
        Surface::Cylinder(Cylinder {
            origin: zlo,
            axis: z,
            e1,
            e2,
            radius,
            vmin: 0.0,
            vmax: height,
            arc: None,
        }),
        [[0.0, 0.0], [0.0, height]],
        vec![
            topo::EdgeUse {
                edge: seam_lo.clone(),
                forward: true,
                pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, height], mid: [0.0, height / 2.0] },
            },
            topo::EdgeUse {
                edge: seam_hi.clone(),
                forward: false,
                pcurve: topo::Pcurve { start: [2.0 * std::f64::consts::PI, height], end: [0.0, height], mid: [std::f64::consts::PI, height] },
            },
            topo::EdgeUse {
                edge: seam_lo.clone(),
                forward: false,
                pcurve: topo::Pcurve { start: [0.0, height], end: [0.0, 0.0], mid: [0.0, height / 2.0] },
            },
        ],
    );

    // The rim circles are SHARED handles: the wall's seam edges ARE the
    // caps' boundary circles, so a `between` name (cap meets wall) resolves
    // by handle identity in History::edge_between (W2: a cylinder rim is a
    // nameable edge, exactly as a box edge is). disk_face would build its
    // own copy of each circle, leaving two DIFFERENT handles for one rim;
    // disk_face_shared is the same thing with the handle supplied.
    let top = disk_face_shared(seam_hi.clone(), v_seam_hi.borrow().point, z);
    let bottom = disk_face_shared(seam_lo.clone(), v_seam_lo.borrow().point, scale(z, -1.0));

    let shell = Rc::new(RefCell::new(Shell {
        faces: vec![top, bottom, lateral],
    }));
    Solid { shells: vec![shell] }
}

/// A full-disk planar cap with one circular boundary edge. `v` is the plane's
/// own offset on the parent surface, used only for the pcurve bookkeeping.
fn disk_face(
    seam: topo::VertexRef,
    circle: Curve,
    normal: Vec3,
    u_axis: Vec3,
    v_axis: Vec3,
    radius: f64,
    _v: f64,
) -> TFace {
    let e = topo::edge(seam.clone(), seam.clone(), true, circle);
    let plane = Plane::new(seam.borrow().point, normal);
    let _ = (u_axis, v_axis, radius);
    let use_ = topo::EdgeUse {
        edge: e,
        forward: true,
        pcurve: topo::Pcurve {
            start: [0.0, 0.0],
            end: [0.0, 0.0],
            mid: [0.0, 0.0],
        },
    };
    make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], vec![use_])
}

/// A disk cap sharing a pre-built rim edge (unlike `disk_face`, which always
/// makes its own) -- needed so the same circle is the boundary of both the
/// cap and its adjoining round-primitive torus rim.
fn disk_face_shared(edge: TEdge, seam_point: Vec3, normal: Vec3) -> TFace {
    let plane = Plane::new(seam_point, normal);
    let use_ = topo::EdgeUse {
        edge,
        forward: true,
        pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
    };
    make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], vec![use_])
}

/// The round-primitive cylinder, fillet style (SPEC-brep-round.md): both rims
/// get a quarter-torus fillet between the (shortened) wall and a shrunken
/// cap -- 5 faces (wall, 2 caps, 2 rim fillets), matching OCCT's count.
pub fn round_cylinder(center: Vec3, radius: f64, height: f64, axis: Vec3, rad: f64) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let hh = height / 2.0 - rad;
    let cap_r = radius - rad;
    let zlo_wall = add(center, scale(z, -hh));
    let zhi_wall = add(center, scale(z, hh));
    let zlo_cap = add(center, scale(z, -(height / 2.0)));
    let zhi_cap = add(center, scale(z, height / 2.0));

    let rim_wall = |zc: Vec3| Curve::Circle { center: zc, radius, normal: z };
    let rim_cap = |zc: Vec3| Curve::Circle { center: zc, radius: cap_r, normal: z };
    let v_wall_lo = topo::vertex(add(zlo_wall, scale(e1, radius)));
    let v_wall_hi = topo::vertex(add(zhi_wall, scale(e1, radius)));
    let v_cap_lo = topo::vertex(add(zlo_cap, scale(e1, cap_r)));
    let v_cap_hi = topo::vertex(add(zhi_cap, scale(e1, cap_r)));
    let e_wall_lo = topo::edge(v_wall_lo.clone(), v_wall_lo.clone(), true, rim_wall(zlo_wall));
    let e_wall_hi = topo::edge(v_wall_hi.clone(), v_wall_hi.clone(), true, rim_wall(zhi_wall));
    let e_cap_lo = topo::edge(v_cap_lo.clone(), v_cap_lo.clone(), true, rim_cap(zlo_cap));
    let e_cap_hi = topo::edge(v_cap_hi.clone(), v_cap_hi.clone(), true, rim_cap(zhi_cap));

    let hp = std::f64::consts::FRAC_PI_2;
    let two_pi = 2.0 * std::f64::consts::PI;
    let pi = std::f64::consts::PI;

    let wall = make_face(
        Surface::Cylinder(Cylinder { origin: zlo_wall, axis: z, e1, e2, radius, vmin: 0.0, vmax: 2.0 * hh, arc: None }),
        [[0.0, 0.0], [0.0, 2.0 * hh]],
        vec![
            topo::EdgeUse { edge: e_wall_lo.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 2.0 * hh], mid: [0.0, hh] } },
            topo::EdgeUse { edge: e_wall_hi.clone(), forward: false, pcurve: topo::Pcurve { start: [two_pi, 2.0 * hh], end: [0.0, 2.0 * hh], mid: [pi, 2.0 * hh] } },
            topo::EdgeUse { edge: e_wall_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [0.0, 2.0 * hh], end: [0.0, 0.0], mid: [0.0, hh] } },
        ],
    );
    let top_cap = disk_face_shared(e_cap_hi.clone(), v_cap_hi.borrow().point, z);
    let bottom_cap = disk_face_shared(e_cap_lo.clone(), v_cap_lo.borrow().point, scale(z, -1.0));

    // The u=0 meridian, shared as the torus wire's own "vertical" edge --
    // the same seam-plus-arc shape `extrude_profile`'s partial-cylinder wall
    // uses. Its `normal` is chosen so y_axis = normal x_axis works out to the
    // torus's own axis, i.e. the point at v=hp lands on the cap, not off it
    // (checked against both rim positions in SPEC-brep-round.md's derivation).
    let meridian = |ring_c: Vec3, va: &topo::VertexRef, vb: &topo::VertexRef, arc_normal: Vec3| -> TEdge {
        topo::edge(va.clone(), vb.clone(), true, Curve::Arc { center: ring_c, radius: rad, normal: arc_normal, x_axis: e1, sweep: hp })
    };
    let torus_wire = |e_wall: TEdge, e_cap: TEdge, seam: TEdge| -> Vec<topo::EdgeUse<Curve3>> {
        vec![
            topo::EdgeUse { edge: e_wall, forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [two_pi, 0.0], mid: [pi, 0.0] } },
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [two_pi, 0.0], end: [two_pi, hp], mid: [two_pi, hp / 2.0] } },
            topo::EdgeUse { edge: e_cap, forward: false, pcurve: topo::Pcurve { start: [two_pi, hp], end: [0.0, hp], mid: [pi, hp] } },
            topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, hp], end: [0.0, 0.0], mid: [0.0, hp / 2.0] } },
        ]
    };

    let seam_top = meridian(add(zhi_wall, scale(e1, cap_r)), &v_wall_hi, &v_cap_hi, scale(e2, -1.0));
    let top_torus = make_face(
        Surface::Torus(TorusSurf { center: zhi_wall, axis: z, e1, e2, ring: cap_r, tube: rad, v_range: [0.0, hp] }),
        [[0.0, two_pi], [0.0, hp]],
        torus_wire(e_wall_hi, e_cap_hi, seam_top),
    );
    let seam_bot = meridian(add(zlo_wall, scale(e1, cap_r)), &v_wall_lo, &v_cap_lo, e2);
    // e2 negated (axis already flipped to -z for this rim): cross(e1,e2)
    // must equal the surface's own axis for its volume term to come out
    // with the right sign (found by `debug_round_cylinder_face_breakdown`:
    // the bottom rim's contribution had the opposite sign of the top's,
    // same class of bug as the box fillet's strip/sphere parity). The
    // meridian curve above is untouched -- it is defined in world space by
    // (e1, e2) directly, not through this struct.
    let bottom_torus = make_face(
        Surface::Torus(TorusSurf { center: zlo_wall, axis: scale(z, -1.0), e1, e2: scale(e2, -1.0), ring: cap_r, tube: rad, v_range: [0.0, hp] }),
        [[0.0, two_pi], [0.0, hp]],
        torus_wire(e_wall_lo, e_cap_lo, seam_bot),
    );

    let shell = Rc::new(RefCell::new(Shell { faces: vec![wall, top_cap, bottom_cap, top_torus, bottom_torus] }));
    Solid { shells: vec![shell] }
}

/// The round-primitive cylinder, CHAMFER style: the same 5-face topology as
/// `round_cylinder`, but each rim is a bounded 45-degree cone band between the
/// shortened wall (radius `radius` at v=0) and the shrunken cap (radius
/// `radius - rad` at v=rad*sqrt(2)). Fully analytic: the removed ring is a
/// right triangle of legs (rad, rad) by Pappus, so the closed form is
/// pi*R^2*h - 2*pi*rad^2*(R - rad/3) -- lead-pinned against OCCT at
/// 12949.644918 for r12 h30 rad3.
pub fn chamfer_cylinder(center: Vec3, radius: f64, height: f64, axis: Vec3, rad: f64) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let hh = height / 2.0 - rad;
    let cap_r = radius - rad;
    let zlo_wall = add(center, scale(z, -hh));
    let zhi_wall = add(center, scale(z, hh));
    let zlo_cap = add(center, scale(z, -(height / 2.0)));
    let zhi_cap = add(center, scale(z, height / 2.0));

    let rim_wall = |zc: Vec3| Curve::Circle { center: zc, radius, normal: z };
    let rim_cap = |zc: Vec3| Curve::Circle { center: zc, radius: cap_r, normal: z };
    let v_wall_lo = topo::vertex(add(zlo_wall, scale(e1, radius)));
    let v_wall_hi = topo::vertex(add(zhi_wall, scale(e1, radius)));
    let v_cap_lo = topo::vertex(add(zlo_cap, scale(e1, cap_r)));
    let v_cap_hi = topo::vertex(add(zhi_cap, scale(e1, cap_r)));
    let e_wall_lo = topo::edge(v_wall_lo.clone(), v_wall_lo.clone(), true, rim_wall(zlo_wall));
    let e_wall_hi = topo::edge(v_wall_hi.clone(), v_wall_hi.clone(), true, rim_wall(zhi_wall));
    let e_cap_lo = topo::edge(v_cap_lo.clone(), v_cap_lo.clone(), true, rim_cap(zlo_cap));
    let e_cap_hi = topo::edge(v_cap_hi.clone(), v_cap_hi.clone(), true, rim_cap(zhi_cap));

    let two_pi = 2.0 * std::f64::consts::PI;
    let pi = std::f64::consts::PI;
    let half_angle = std::f64::consts::FRAC_PI_4;
    let slant = rad * std::f64::consts::SQRT_2;

    let wall = make_face(
        Surface::Cylinder(Cylinder { origin: zlo_wall, axis: z, e1, e2, radius, vmin: 0.0, vmax: 2.0 * hh, arc: None }),
        [[0.0, 0.0], [0.0, 2.0 * hh]],
        vec![
            topo::EdgeUse { edge: e_wall_lo.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 2.0 * hh], mid: [0.0, hh] } },
            topo::EdgeUse { edge: e_wall_hi.clone(), forward: false, pcurve: topo::Pcurve { start: [two_pi, 2.0 * hh], end: [0.0, 2.0 * hh], mid: [pi, 2.0 * hh] } },
            topo::EdgeUse { edge: e_wall_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [0.0, 2.0 * hh], end: [0.0, 0.0], mid: [0.0, hh] } },
        ],
    );
    let top_cap = disk_face_shared(e_cap_hi.clone(), v_cap_hi.borrow().point, z);
    let bottom_cap = disk_face_shared(e_cap_lo.clone(), v_cap_lo.borrow().point, scale(z, -1.0));

    // The u=0 meridian, a straight segment from the wall rim to the cap rim --
    // the chamfer's own profile line (a fillet's would be an arc). Same
    // seam-plus-two-rims wire shape `round_cylinder`'s torus band uses.
    let meridian = |va: &topo::VertexRef, vb: &topo::VertexRef| -> TEdge {
        topo::edge(
            va.clone(),
            vb.clone(),
            true,
            Curve::Segment { a: va.borrow().point, b: vb.borrow().point },
        )
    };
    let band_wire = |e_wall: TEdge, e_cap: TEdge, seam: TEdge| -> Vec<topo::EdgeUse<Curve3>> {
        vec![
            topo::EdgeUse { edge: e_wall, forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [two_pi, 0.0], mid: [pi, 0.0] } },
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [two_pi, 0.0], end: [two_pi, slant], mid: [two_pi, slant / 2.0] } },
            topo::EdgeUse { edge: e_cap, forward: false, pcurve: topo::Pcurve { start: [two_pi, slant], end: [0.0, slant], mid: [pi, slant] } },
            topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, slant], end: [0.0, 0.0], mid: [0.0, slant / 2.0] } },
        ]
    };

    let seam_top = meridian(&v_wall_hi, &v_cap_hi);
    let top_band = make_face(
        Surface::Cone(Cone {
            base: zhi_wall,
            axis: z,
            e1,
            e2,
            base_radius: radius,
            half_angle,
            slant,
            v_range: [0.0, slant],
        }),
        [[0.0, two_pi], [0.0, slant]],
        band_wire(e_wall_hi, e_cap_hi, seam_top),
    );
    let seam_bot = meridian(&v_wall_lo, &v_cap_lo);
    // e2 negated (axis already flipped to -z): cross(e1, e2) must equal the
    // surface's own axis or the band's volume term comes out with the wrong
    // sign -- the same parity the bottom torus rim needed, same reasoning.
    let bottom_band = make_face(
        Surface::Cone(Cone {
            base: zlo_wall,
            axis: scale(z, -1.0),
            e1,
            e2: scale(e2, -1.0),
            base_radius: radius,
            half_angle,
            slant,
            v_range: [0.0, slant],
        }),
        [[0.0, two_pi], [0.0, slant]],
        band_wire(e_wall_lo, e_cap_lo, seam_bot),
    );

    let shell = Rc::new(RefCell::new(Shell { faces: vec![wall, top_cap, bottom_cap, top_band, bottom_band] }));
    Solid { shells: vec![shell] }
}

/// W2 (SPEC-brep-fillet.md): the `fillet` feature naming ONE rim of a
/// cylinder (between its cap and its wall). The treated rim gets the same
/// quarter-torus band `round_cylinder` pins at both rims; the opposite rim
/// keeps its full radius and its own edge handle, so the result is 4 faces
/// (wall, 2 caps, 1 band). `treated_top` selects the +axis rim. The removed
/// ring is one of the two congruent bands whose pair gives the OCCT-pinned
/// both-rims removal, so the volume is pi*R^2*h minus half that removal --
/// 13434.186898 for r12 h30 rad3.
pub fn round_cylinder_one_rim(center: Vec3, radius: f64, height: f64, axis: Vec3, rad: f64, treated_top: bool) -> TSolid {
    let ax = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(ax);
    let cap_r = radius - rad;
    let two_pi = 2.0 * std::f64::consts::PI;
    let pi = std::f64::consts::PI;
    let hp = std::f64::consts::FRAC_PI_2;

    // The wall runs from the untreated cap plane to `rad` short of the
    // treated one; v runs along +z from the wall's lower rim.
    let (z_lo_wall, z_hi_wall, z_cap_treated) = if treated_top {
        (
            add(center, scale(z, -height / 2.0)),
            add(center, scale(z, height / 2.0 - rad)),
            add(center, scale(z, height / 2.0)),
        )
    } else {
        (
            add(center, scale(z, -(height / 2.0 - rad))),
            add(center, scale(z, height / 2.0)),
            add(center, scale(z, -(height / 2.0))),
        )
    };
    let z_untreated = if treated_top { z_lo_wall } else { z_hi_wall };
    let z_treated_wall = if treated_top { z_hi_wall } else { z_lo_wall };

    let v_untreated = topo::vertex(add(z_untreated, scale(e1, radius)));
    let v_treated_wall = topo::vertex(add(z_treated_wall, scale(e1, radius)));
    let v_cap_treated = topo::vertex(add(z_cap_treated, scale(e1, cap_r)));
    // The untreated rim: ONE handle shared by the wall's rim use there and
    // the untreated cap (the same sharing cylinder_solid uses, so the
    // surviving rim stays nameable in the result).
    let e_untreated = topo::edge(
        v_untreated.clone(),
        v_untreated.clone(),
        true,
        Curve::Circle { center: z_untreated, radius, normal: z },
    );
    let e_wall_treated = topo::edge(
        v_treated_wall.clone(),
        v_treated_wall.clone(),
        true,
        Curve::Circle { center: z_treated_wall, radius, normal: z },
    );
    let e_cap_treated = topo::edge(
        v_cap_treated.clone(),
        v_cap_treated.clone(),
        true,
        Curve::Circle { center: z_cap_treated, radius: cap_r, normal: z },
    );

    // Wall: origin at the LOWER rim in z (v runs up along +z); the v=0 rim
    // doubles as the u=0 seam, exactly as cylinder_solid's lateral does.
    let e_v0 = if treated_top { e_untreated.clone() } else { e_wall_treated.clone() };
    let e_v1 = if treated_top { e_wall_treated.clone() } else { e_untreated.clone() };
    let wall = make_face(
        Surface::Cylinder(Cylinder { origin: z_lo_wall, axis: z, e1, e2, radius, vmin: 0.0, vmax: height - rad, arc: None }),
        [[0.0, 0.0], [0.0, height - rad]],
        vec![
            topo::EdgeUse { edge: e_v0.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, height - rad], mid: [0.0, (height - rad) / 2.0] } },
            topo::EdgeUse { edge: e_v1.clone(), forward: false, pcurve: topo::Pcurve { start: [two_pi, height - rad], end: [0.0, height - rad], mid: [pi, height - rad] } },
            topo::EdgeUse { edge: e_v0.clone(), forward: false, pcurve: topo::Pcurve { start: [0.0, height - rad], end: [0.0, 0.0], mid: [0.0, (height - rad) / 2.0] } },
        ],
    );
    let (untreated_normal, treated_normal) = if treated_top {
        (scale(z, -1.0), z)
    } else {
        (z, scale(z, -1.0))
    };
    let cap_untreated = disk_face_shared(e_untreated, v_untreated.borrow().point, untreated_normal);
    let cap_treated = disk_face_shared(e_cap_treated.clone(), v_cap_treated.borrow().point, treated_normal);

    // The band: round_cylinder's own torus pattern at the treated rim --
    // axis +z at the top, axis -z with e2 negated at the bottom (the same
    // parity note round_cylinder records for its bottom band), and the
    // meridian's normal chosen so its v=hp point lands on the cap.
    let meridian = |va: &topo::VertexRef, vb: &topo::VertexRef, arc_normal: Vec3| -> TEdge {
        topo::edge(va.clone(), vb.clone(), true, Curve::Arc { center: add(z_treated_wall, scale(e1, cap_r)), radius: rad, normal: arc_normal, x_axis: e1, sweep: hp })
    };
    let band_wire = |e_wall: TEdge, e_cap: TEdge, seam: TEdge| -> Vec<topo::EdgeUse<Curve3>> {
        vec![
            topo::EdgeUse { edge: e_wall, forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [two_pi, 0.0], mid: [pi, 0.0] } },
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [two_pi, 0.0], end: [two_pi, hp], mid: [two_pi, hp / 2.0] } },
            topo::EdgeUse { edge: e_cap, forward: false, pcurve: topo::Pcurve { start: [two_pi, hp], end: [0.0, hp], mid: [pi, hp] } },
            topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, hp], end: [0.0, 0.0], mid: [0.0, hp / 2.0] } },
        ]
    };
    let band = if treated_top {
        let seam = meridian(&v_treated_wall, &v_cap_treated, scale(e2, -1.0));
        make_face(
            Surface::Torus(TorusSurf { center: z_treated_wall, axis: z, e1, e2, ring: cap_r, tube: rad, v_range: [0.0, hp] }),
            [[0.0, two_pi], [0.0, hp]],
            band_wire(e_wall_treated, e_cap_treated, seam),
        )
    } else {
        let seam = meridian(&v_treated_wall, &v_cap_treated, e2);
        make_face(
            Surface::Torus(TorusSurf { center: z_treated_wall, axis: scale(z, -1.0), e1, e2: scale(e2, -1.0), ring: cap_r, tube: rad, v_range: [0.0, hp] }),
            [[0.0, two_pi], [0.0, hp]],
            band_wire(e_wall_treated, e_cap_treated, seam),
        )
    };

    let _ = pi;
    let shell = Rc::new(RefCell::new(Shell { faces: vec![wall, cap_untreated, cap_treated, band] }));
    Solid { shells: vec![shell] }
}

/// W2: the CHAMFER one-rim variant of [`round_cylinder_one_rim`] -- the
/// treated rim is a bounded 45-degree cone band (the removed ring is a right
/// triangle of legs (rad, rad) by Pappus: pi*rad^2*(R - rad/3)), 4 faces.
pub fn chamfer_cylinder_one_rim(center: Vec3, radius: f64, height: f64, axis: Vec3, rad: f64, treated_top: bool) -> TSolid {
    let ax = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(ax);
    let cap_r = radius - rad;
    let two_pi = 2.0 * std::f64::consts::PI;
    let pi = std::f64::consts::PI;
    let half_angle = std::f64::consts::FRAC_PI_4;
    let slant = rad * std::f64::consts::SQRT_2;

    let (z_lo_wall, z_hi_wall, z_cap_treated) = if treated_top {
        (
            add(center, scale(z, -height / 2.0)),
            add(center, scale(z, height / 2.0 - rad)),
            add(center, scale(z, height / 2.0)),
        )
    } else {
        (
            add(center, scale(z, -(height / 2.0 - rad))),
            add(center, scale(z, height / 2.0)),
            add(center, scale(z, -(height / 2.0))),
        )
    };
    let z_untreated = if treated_top { z_lo_wall } else { z_hi_wall };
    let z_treated_wall = if treated_top { z_hi_wall } else { z_lo_wall };

    let v_untreated = topo::vertex(add(z_untreated, scale(e1, radius)));
    let v_treated_wall = topo::vertex(add(z_treated_wall, scale(e1, radius)));
    let v_cap_treated = topo::vertex(add(z_cap_treated, scale(e1, cap_r)));
    let e_untreated = topo::edge(
        v_untreated.clone(),
        v_untreated.clone(),
        true,
        Curve::Circle { center: z_untreated, radius, normal: z },
    );
    let e_wall_treated = topo::edge(
        v_treated_wall.clone(),
        v_treated_wall.clone(),
        true,
        Curve::Circle { center: z_treated_wall, radius, normal: z },
    );
    let e_cap_treated = topo::edge(
        v_cap_treated.clone(),
        v_cap_treated.clone(),
        true,
        Curve::Circle { center: z_cap_treated, radius: cap_r, normal: z },
    );

    let e_v0 = if treated_top { e_untreated.clone() } else { e_wall_treated.clone() };
    let e_v1 = if treated_top { e_wall_treated.clone() } else { e_untreated.clone() };
    let wall = make_face(
        Surface::Cylinder(Cylinder { origin: z_lo_wall, axis: z, e1, e2, radius, vmin: 0.0, vmax: height - rad, arc: None }),
        [[0.0, 0.0], [0.0, height - rad]],
        vec![
            topo::EdgeUse { edge: e_v0.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, height - rad], mid: [0.0, (height - rad) / 2.0] } },
            topo::EdgeUse { edge: e_v1.clone(), forward: false, pcurve: topo::Pcurve { start: [two_pi, height - rad], end: [0.0, height - rad], mid: [pi, height - rad] } },
            topo::EdgeUse { edge: e_v0.clone(), forward: false, pcurve: topo::Pcurve { start: [0.0, height - rad], end: [0.0, 0.0], mid: [0.0, (height - rad) / 2.0] } },
        ],
    );
    let (untreated_normal, treated_normal) = if treated_top {
        (scale(z, -1.0), z)
    } else {
        (z, scale(z, -1.0))
    };
    let cap_untreated = disk_face_shared(e_untreated, v_untreated.borrow().point, untreated_normal);
    let cap_treated = disk_face_shared(e_cap_treated.clone(), v_cap_treated.borrow().point, treated_normal);

    // The band: chamfer_cylinder's own cone band pattern; the meridian is
    // the chamfer's straight profile line from the wall rim to the cap rim.
    let meridian = |va: &topo::VertexRef, vb: &topo::VertexRef| -> TEdge {
        topo::edge(
            va.clone(),
            vb.clone(),
            true,
            Curve::Segment { a: va.borrow().point, b: vb.borrow().point },
        )
    };
    let band_wire = |e_wall: TEdge, e_cap: TEdge, seam: TEdge| -> Vec<topo::EdgeUse<Curve3>> {
        vec![
            topo::EdgeUse { edge: e_wall, forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [two_pi, 0.0], mid: [pi, 0.0] } },
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [two_pi, 0.0], end: [two_pi, slant], mid: [two_pi, slant / 2.0] } },
            topo::EdgeUse { edge: e_cap, forward: false, pcurve: topo::Pcurve { start: [two_pi, slant], end: [0.0, slant], mid: [pi, slant] } },
            topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, slant], end: [0.0, 0.0], mid: [0.0, slant / 2.0] } },
        ]
    };
    let band = if treated_top {
        let seam = meridian(&v_treated_wall, &v_cap_treated);
        make_face(
            Surface::Cone(Cone { base: z_treated_wall, axis: z, e1, e2, base_radius: radius, half_angle, slant, v_range: [0.0, slant] }),
            [[0.0, two_pi], [0.0, slant]],
            band_wire(e_wall_treated, e_cap_treated, seam),
        )
    } else {
        let seam = meridian(&v_treated_wall, &v_cap_treated);
        // e2 negated (axis flipped to -z): cross(e1, e2) must equal the
        // band's own axis for its volume term's sign -- the same parity
        // chamfer_cylinder records for its bottom band.
        make_face(
            Surface::Cone(Cone { base: z_treated_wall, axis: scale(z, -1.0), e1, e2: scale(e2, -1.0), base_radius: radius, half_angle, slant, v_range: [0.0, slant] }),
            [[0.0, two_pi], [0.0, slant]],
            band_wire(e_wall_treated, e_cap_treated, seam),
        )
    };

    let _ = pi;
    let shell = Rc::new(RefCell::new(Shell { faces: vec![wall, cap_untreated, cap_treated, band] }));
    Solid { shells: vec![shell] }
}

/// A cone centred on `center`, base at -height/2, apex at +height/2.
pub fn cone_solid(center: Vec3, radius: f64, height: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let zlo = add(center, scale(z, -height / 2.0));
    let zhi = add(center, scale(z, height / 2.0));
    let slant = (radius * radius + height * height).sqrt();
    let half_angle = radius.atan2(height);

    let v_seam = topo::vertex(add(zlo, scale(e1, radius)));
    let apex_v = topo::vertex(zhi);

    let base_circle = Curve::Circle {
        center: zlo,
        radius,
        normal: scale(z, -1.0),
    };
    let base_rim = topo::edge(v_seam.clone(), v_seam.clone(), true, base_circle.clone());
    let seam_line = topo::edge(v_seam.clone(), apex_v.clone(), true, Curve::Segment {
        a: v_seam.borrow().point,
        b: apex_v.borrow().point,
    });

    // Lateral face: up the seam to the apex, then no top rim (degenerate), back
    // down. The apex is a degenerate edge in the parameter domain.
    let lateral = make_face(
        Surface::Cone(Cone {
            base: zlo,
            axis: z,
            e1,
            e2,
            base_radius: radius,
            half_angle,
            slant,
            v_range: [0.0, slant],
        }),
        [[0.0, 0.0], [0.0, slant]],
        vec![
            topo::EdgeUse {
                edge: seam_line.clone(),
                forward: true,
                pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, slant], mid: [0.0, slant / 2.0] },
            },
            topo::EdgeUse {
                edge: seam_line.clone(),
                forward: false,
                pcurve: topo::Pcurve { start: [2.0 * std::f64::consts::PI, slant], end: [0.0, 0.0], mid: [std::f64::consts::PI, slant / 2.0] },
            },
        ],
    );
    let base = disk_face(
        v_seam.clone(),
        base_circle,
        scale(z, -1.0),
        e1,
        scale(e2, -1.0),
        radius,
        0.0,
    );
    let _ = e2;
    let _ = base_rim;

    let shell = Rc::new(RefCell::new(Shell {
        faces: vec![base, lateral],
    }));
    Solid { shells: vec![shell] }
}

/// A sphere centred on `center`.
pub fn sphere_solid(center: Vec3, radius: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let seam_v = topo::vertex(add(center, scale(e1, radius)));
    let seam = topo::edge(
        seam_v.clone(),
        seam_v.clone(),
        true,
        Curve::Circle {
            center,
            radius,
            normal: z,
        },
    );
    let sphere = make_face(
        Surface::Sphere(SphereSurf::full(center, radius, z, e1, e2)),
        [[0.0, 0.0], [0.0, std::f64::consts::PI]],
        vec![
            topo::EdgeUse {
                edge: seam.clone(),
                forward: true,
                pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, std::f64::consts::PI], mid: [0.0, std::f64::consts::FRAC_PI_2] },
            },
            topo::EdgeUse {
                edge: seam,
                forward: false,
                pcurve: topo::Pcurve { start: [2.0 * std::f64::consts::PI, std::f64::consts::PI], end: [0.0, 0.0], mid: [std::f64::consts::PI, std::f64::consts::FRAC_PI_2] },
            },
        ],
    );
    let shell = Rc::new(RefCell::new(Shell { faces: vec![sphere] }));
    Solid { shells: vec![shell] }
}

/// A torus centred on `center`, ring radius `ring`, tube radius `tube`.
pub fn torus_solid(center: Vec3, ring: f64, tube: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    // Seam on the outer equator (v = 0), at u = 0.
    let seam_v = topo::vertex(add(center, scale(e1, ring + tube)));
    let seam = topo::edge(
        seam_v.clone(),
        seam_v.clone(),
        true,
        Curve::Circle {
            center,
            radius: ring + tube,
            normal: z,
        },
    );
    let uv = 2.0 * std::f64::consts::PI;
    let torus = make_face(
        Surface::Torus(TorusSurf::full(center, z, e1, e2, ring, tube)),
        [[0.0, uv], [0.0, uv]],
        vec![
            topo::EdgeUse {
                edge: seam.clone(),
                forward: true,
                pcurve: topo::Pcurve { start: [0.0, 0.0], end: [uv, 0.0], mid: [std::f64::consts::PI, 0.0] },
            },
            topo::EdgeUse {
                edge: seam,
                forward: false,
                pcurve: topo::Pcurve { start: [uv, uv], end: [0.0, uv], mid: [std::f64::consts::PI, uv] },
            },
        ],
    );
    let shell = Rc::new(RefCell::new(Shell { faces: vec![torus] }));
    Solid { shells: vec![shell] }
}

/// A regular n-gon prism, extruded along +Z, centred on `center`.
pub fn prism_solid(center: Vec3, sides: usize, radius: f64, height: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let n = sides.max(3).min(12);
    let zlo = add(center, scale(z, -height / 2.0));
    let zhi = add(center, scale(z, height / 2.0));
    let ang = |i: usize| 2.0 * std::f64::consts::PI * i as f64 / n as f64;
    let ring_lo: Vec<topo::VertexRef> = (0..n)
        .map(|i| topo::vertex(add(zlo, add(scale(e1, radius * ang(i).cos()), scale(e2, radius * ang(i).sin())))))
        .collect();
    let ring_hi: Vec<topo::VertexRef> = (0..n)
        .map(|i| topo::vertex(add(zhi, add(scale(e1, radius * ang(i).cos()), scale(e2, radius * ang(i).sin())))))
        .collect();

    let mut faces: Vec<TFace> = Vec::new();
    let mut sides_uses = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        let a = ring_lo[i].clone();
        let b = ring_lo[j].clone();
        let c = ring_hi[j].clone();
        let d = ring_hi[i].clone();
        // Outward normal of this quad.
        let p0 = a.borrow().point;
        let p1 = b.borrow().point;
        let p2 = d.borrow().point;
        let nrm = crate::math::normalize(cross(sub(p1, p0), sub(p2, p0)));
        let plane = Plane::new(p0, nrm);
        let uses = {
            let mk = |va: &topo::VertexRef, vb: &topo::VertexRef| -> topo::EdgeUse<Curve3> {
                let e = topo::edge(
                    va.clone(),
                    vb.clone(),
                    true,
                    Curve::Segment { a: va.borrow().point, b: vb.borrow().point },
                );
                topo::EdgeUse {
                    edge: e,
                    forward: true,
                    pcurve: topo::Pcurve {
                        start: plane.project(va.borrow().point),
                        end: plane.project(vb.borrow().point),
                        mid: plane.project(scale(add(va.borrow().point, vb.borrow().point), 0.5)),
                    },
                }
            };
            vec![mk(&a, &b), mk(&b, &c), mk(&c, &d), mk(&d, &a)]
        };
        sides_uses.push(());
        faces.push(make_face(
            Surface::Plane(plane),
            [[0.0, 1.0], [0.0, 1.0]],
            uses,
        ));
    }
    let top = polygon_cap_face(&ring_hi, z, zhi);
    let bottom = polygon_cap_face(&ring_lo, scale(z, -1.0), zlo);
    faces.push(top);
    faces.push(bottom);
    std::mem::drop(sides_uses);

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

/// A planar n-gon cap from an ordered vertex ring, wound so its normal is `n`.
fn polygon_cap_face(ring: &[topo::VertexRef], n: Vec3, _at: Vec3) -> TFace {
    let p: Vec<Vec3> = ring.iter().map(|v| v.borrow().point).collect();
    let plane = Plane::new(p[0], n);
    let mut uses = Vec::new();
    for i in 0..ring.len() {
        let va = &ring[i];
        let vb = &ring[(i + 1) % ring.len()];
        let (pa, pb) = (va.borrow().point, vb.borrow().point);
        let e = topo::edge(
            va.clone(),
            vb.clone(),
            true,
            Curve::Segment { a: pa, b: pb },
        );
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve {
                start: plane.project(pa),
                end: plane.project(pb),
                mid: plane.project(scale(add(pa, pb), 0.5)),
            },
        });
    }
    make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// A right wedge: a right-triangle profile in the XY plane, extruded along +Z,
/// centred on `center`. The triangle has corners (0,0), (width,0), (0,depth).
pub fn wedge_solid(center: Vec3, width: f64, depth: f64, height: f64, axis: Vec3) -> TSolid {
    let axis = crate::math::normalize(axis);
    let (e1, e2, z) = geom::frame(axis);
    let zlo = add(center, scale(z, -height / 2.0));
    let zhi = add(center, scale(z, height / 2.0));
    let local = |u: f64, v: f64, w: f64| {
        add(
            add(scale(e1, u - width / 2.0), scale(e2, v - depth / 2.0)),
            scale(z, w - height / 2.0),
        )
    };
    let tri = [[0.0, 0.0], [width, 0.0], [0.0, depth]];
    let lo: Vec<topo::VertexRef> = tri.iter().map(|p| topo::vertex(local(p[0], p[1], 0.0))).collect();
    let hi: Vec<topo::VertexRef> = tri.iter().map(|p| topo::vertex(local(p[0], p[1], height))).collect();
    let _ = (zlo, zhi);

    let mut faces: Vec<TFace> = Vec::new();
    // Three side quads.
    for i in 0..3 {
        let j = (i + 1) % 3;
        let a = lo[i].clone();
        let b = lo[j].clone();
        let c = hi[j].clone();
        let d = hi[i].clone();
        let p0 = a.borrow().point;
        let p1 = b.borrow().point;
        let p2 = d.borrow().point;
        let nrm = crate::math::normalize(cross(sub(p1, p0), sub(p2, p0)));
        let plane = Plane::new(p0, nrm);
        let uses = {
            let mk = |va: &topo::VertexRef, vb: &topo::VertexRef| -> topo::EdgeUse<Curve3> {
                let e = topo::edge(
                    va.clone(),
                    vb.clone(),
                    true,
                    Curve::Segment { a: va.borrow().point, b: vb.borrow().point },
                );
                topo::EdgeUse {
                    edge: e,
                    forward: true,
                    pcurve: topo::Pcurve {
                        start: plane.project(va.borrow().point),
                        end: plane.project(vb.borrow().point),
                        mid: plane.project(scale(add(va.borrow().point, vb.borrow().point), 0.5)),
                    },
                }
            };
            vec![mk(&a, &b), mk(&b, &c), mk(&c, &d), mk(&d, &a)]
        };
        // Wound so the normal points away from the solid.
        faces.push(make_face(
            Surface::Plane(plane),
            [[0.0, 1.0], [0.0, 1.0]],
            uses,
        ));
    }
    // Caps. The triangle (0,0),(w,0),(0,d) has area w*d/2; with outward +z the
    // top is wound CCW seen from +z.
    let top_plane = Plane::new(hi[0].borrow().point, z);
    faces.push(triangle_cap_face(&hi, z));
    faces.push(triangle_cap_face(&lo, scale(z, -1.0)));
    let _ = top_plane;

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

fn triangle_cap_face(ring: &[topo::VertexRef], n: Vec3) -> TFace {
    let p: Vec<Vec3> = ring.iter().map(|v| v.borrow().point).collect();
    let plane = Plane::new(p[0], n);
    let mut uses = Vec::new();
    for i in 0..ring.len() {
        let va = &ring[i];
        let vb = &ring[(i + 1) % ring.len()];
        let e = topo::edge(
            va.clone(),
            vb.clone(),
            true,
            Curve::Segment { a: va.borrow().point, b: vb.borrow().point },
        );
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve {
                start: plane.project(va.borrow().point),
                end: plane.project(vb.borrow().point),
                mid: plane.project(scale(add(va.borrow().point, vb.borrow().point), 0.5)),
            },
        });
    }
    make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// One segment of an extruded profile, in the sketch plane's (u, v)
/// coordinates. A `Line` becomes a planar wall; an `Arc` becomes a genuine
/// partial cylindrical wall, so a rounded corner or bowed edge is exact rather
/// than a sampled polygon.
#[derive(Clone, Debug)]
pub enum ProfileSeg {
    Line { a: [f64; 2], b: [f64; 2] },
    Arc {
        centre: [f64; 2],
        radius: f64,
        start: f64,
        sweep: f64,
    },
}

impl ProfileSeg {
    /// The segment's start and end points in (u, v).
    pub fn endpoints(&self) -> ([f64; 2], [f64; 2]) {
        match self {
            ProfileSeg::Line { a, b } => (*a, *b),
            ProfileSeg::Arc { centre, radius, start, sweep } => (
                [centre[0] + radius * start.cos(), centre[1] + radius * start.sin()],
                [
                    centre[0] + radius * (start + sweep).cos(),
                    centre[1] + radius * (start + sweep).sin(),
                ],
            ),
        }
    }
}

/// Extrude a profile (a closed loop of straight and circular segments) given in
/// the sketch plane's (u, v), along `sweep`. The solid spans from the profile
/// to the profile translated by `sweep`, matching OCCT's MakePrism. Returns
/// `Err` naming the problem, rather than a wrong or garbage solid, when the
/// profile cannot be trusted to close (SPEC-sketcher2 §7).
pub fn extrude_profile(
    segs: &[ProfileSeg],
    origin: Vec3,
    u_axis: Vec3,
    v_axis: Vec3,
    sweep: Vec3,
) -> Result<TSolid, String> {
    let n = segs.len();
    // ---- §7 guards: what the polygon path could never produce, a soup can ----
    // n == 1: (0 + 1) % 1 == 0, so the lone edge runs base_v[0] -> base_v[0]
    // and the profile cannot close -- UNLESS the lone segment is a full-circle
    // arc, whose corrected shoelace area below is a real disk. Same reading
    // for n == 2: a straight there-and-back digon has zero enclosed area and
    // is refused, while two half-circle arcs are a legitimate circle.
    let chord_area = |a: [f64; 2], b: [f64; 2]| a[0] * b[1] - b[0] * a[1];
    let mut profile_area2 = 0.0;
    for s in segs {
        let (p, q) = s.endpoints();
        profile_area2 += chord_area(p, q);
        if let ProfileSeg::Arc { radius, sweep: sw, .. } = s {
            profile_area2 += radius * radius * (sw - sw.sin());
        }
    }
    // A scale for the emit gate: the profile's own extent in the plane,
    // floored at 1.0 so a unit sketch never reads as degenerate.
    let mut hi = [f64::MIN; 2];
    let mut lo = [f64::MAX; 2];
    for s in segs {
        let (p, q) = s.endpoints();
        for pt in [p, q] {
            for k in 0..2 {
                hi[k] = hi[k].max(pt[k]);
                lo[k] = pt[k].min(lo[k]);
            }
        }
    }
    let profile_scale = ((hi[0] - lo[0]) * (hi[1] - lo[1]))
        .sqrt()
        .max(1.0);
    let eps_weld = 1e-7 * profile_scale;
    if n == 1 {
        return Err("a single segment cannot close an outline".to_string());
    }
    if n == 2 {
        let both_lines = segs.iter().all(|s| matches!(s, ProfileSeg::Line { .. }));
        if both_lines {
            return Err("a 2-gon has no interior and must refuse".to_string());
        }
    }
    // §7.1 (the rest of the fix): walls and caps are built assuming the walk
    // goes CCW with positive arc spans, and a CW arc chain otherwise produces
    // an inside-out solid even with the winding flag set, because a negative
    // span double-flips the cylinder's own (u, v) walk. Normalize instead:
    // a CW profile is reversed into its CCW twin before any face is built, so
    // every downstream path sees the one orientation it was written for.
    let segs: Vec<ProfileSeg> = if profile_area2 < 0.0 {
        let mut out: Vec<ProfileSeg> = Vec::with_capacity(segs.len());
        for i in (0..segs.len()).rev() {
            let (p, q) = segs[i].endpoints();
            match &segs[i] {
                ProfileSeg::Line { .. } => out.push(ProfileSeg::Line { a: q, b: p }),
                ProfileSeg::Arc { centre, radius, start, sweep } => {
                    // The same arc walked the other way: it starts where the
                    // original ended, runs the opposite sense, and sweeps the
                    // negated amount.
                    out.push(ProfileSeg::Arc {
                        centre: *centre,
                        radius: *radius,
                        start: *start + *sweep,
                        sweep: -*sweep,
                    });
                }
            }
        }
        out
    } else {
        segs.to_vec()
    };
    let n = segs.len();
    let at = |p: [f64; 2]| add(origin, add(scale(u_axis, p[0]), scale(v_axis, p[1])));
    let sweep_unit = crate::math::normalize(sweep);
    let height = crate::math::len(sweep);

    let base_v: Vec<topo::VertexRef> = segs
        .iter()
        .map(|s| topo::vertex(at(s.endpoints().0)))
        .collect();
    let top_v: Vec<topo::VertexRef> = base_v
        .iter()
        .map(|v| topo::vertex(add(v.borrow().point, sweep)))
        .collect();

    // One 3D curve per base and top segment.
    let base_curve = |s: &ProfileSeg| -> Curve {
        match s {
            ProfileSeg::Line { a, b } => Curve::Segment { a: at(*a), b: at(*b) },
            ProfileSeg::Arc { centre, radius, start, sweep } => Curve::Arc {
                center: at(*centre),
                radius: *radius,
                normal: sweep_unit,
                // Curve::Arc always begins at angle 0 from its x_axis, so the
                // axis is rotated to the arc's own start angle; otherwise the
                // edge would be the arc reflected back to angle 0.
                x_axis: add(scale(u_axis, start.cos()), scale(v_axis, start.sin())),
                sweep: *sweep,
            },
        }
    };
    let top_curve = |s: &ProfileSeg| -> Curve {
        match base_curve(s) {
            Curve::Segment { a, b } => Curve::Segment { a: add(a, sweep), b: add(b, sweep) },
            Curve::Arc { center, radius, normal, x_axis, sweep: sw } => Curve::Arc {
                center: add(center, sweep),
                radius,
                normal,
                x_axis,
                sweep: sw,
            },
            _ => base_curve(s),
        }
    };

    let e_base: Vec<TEdge> = (0..n)
        .map(|i| topo::edge(base_v[i].clone(), base_v[(i + 1) % n].clone(), true, base_curve(&segs[i])))
        .collect();
    let e_top: Vec<TEdge> = (0..n)
        .map(|i| topo::edge(top_v[i].clone(), top_v[(i + 1) % n].clone(), true, top_curve(&segs[i])))
        .collect();
    let vert: Vec<TEdge> = (0..n)
        .map(|i| {
            let (a, b) = (base_v[i].borrow().point, top_v[i].borrow().point);
            topo::edge(base_v[i].clone(), top_v[i].clone(), true, Curve::Segment { a, b })
        })
        .collect();

    let mut faces: Vec<TFace> = Vec::new();
    // A wall's outward normal must be independent of the sweep's sign: the cap
    // normals below (base = -sweep_unit, top = +sweep_unit) do not reverse when
    // the sweep does, and a normal of `cross(edge, sweep)` WOULD, turning every
    // wall inside-out for a negative sweep (a pocket). Read the profile's own
    // winding in the plane's true (right-handed) frame instead: for a CCW uv
    // profile the outward side is to the right of travel.
    let frame_normal = crate::math::normalize(cross(u_axis, v_axis));
    // §7.1: the chord-only shoelace is exactly 0 for a circle built from two
    // diametral arcs, so the CW version used to come out inside-out. The arc
    // contributes its circular-segment area r^2 (sweep - sin sweep) beyond the
    // chord, which makes the sum exact for any arc chain (a full circle from
    // one arc of sweep 2*pi contributes r^2 * 2*pi = 2 * pi r^2; a half-disk
    // contributes r^2 * pi = 2 * (pi r^2 / 2)).
    let mut a2 = profile_area2;
    let winding = if a2 >= 0.0 { 1.0 } else { -1.0 };
    // §7.2 emit gate: ProfileSeg carries no endpoints, so `endpoints()`
    // RECOMPUTES them, and nothing checked that segment i's end agrees with
    // segment i+1's start. A solve that moved an endpoint after the profile
    // was serialized used to build a gapped wire silently; now it refuses and
    // names both segments and the gap.
    for i in 0..n {
        let j = (i + 1) % n;
        let (_, end_i) = segs[i].endpoints();
        let (start_j, _) = segs[j].endpoints();
        let gap = ((end_i[0] - start_j[0]).powi(2) + (end_i[1] - start_j[1]).powi(2)).sqrt();
        if gap > eps_weld {
            return Err(format!(
                "segment {i}'s end and segment {j}'s start are {gap:.3} mm apart; the profile does not close"
            ));
        }
    }
    for i in 0..n {
        let j = (i + 1) % n;
        let (a_uv, b_uv) = segs[i].endpoints();
        let (ab, bb) = (at(a_uv), at(b_uv));
        match &segs[i] {
            ProfileSeg::Line { .. } => {
                let edge_world = sub(bb, ab);
                // Right of travel for a CCW profile, left for a CW one.
                let nrm = crate::math::normalize(cross(scale(edge_world, winding), frame_normal));
                let plane = Plane::new(ab, nrm);
                let uses = vec![
                    planar_seg_use(&plane, &e_base[i], true, ab, bb),
                    planar_seg_use(&plane, &vert[j], true, base_at(&base_v[j]), base_at(&top_v[j])),
                    planar_seg_use(&plane, &e_top[i], false, base_at(&top_v[j]), base_at(&top_v[i])),
                    planar_seg_use(&plane, &vert[i], false, base_at(&top_v[i]), base_at(&base_v[i])),
                ];
                faces.push(make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses));
            }
            ProfileSeg::Arc { centre, radius, start, sweep: sw } => {
                let centre_w = at(*centre);
                // The arc wall's cylinder frame must agree with the straight
                // walls' outward side; a CW profile flips the radial frame.
                // The arc wall's cylinder frame must agree with the straight
                // walls' outward side; a CW profile flips the radial frame.
                // (For arcs this only matters once the profile is normalized
                // to CCW below, where winding is always +1; the branch is kept
                // for safety.)
                let (e1, e2) = if winding >= 0.0 {
                    (u_axis, v_axis)
                } else {
                    (scale(u_axis, -1.0), scale(v_axis, -1.0))
                };
                let wall = Surface::Cylinder(Cylinder {
                    origin: centre_w,
                    axis: sweep_unit,
                    e1,
                    e2,
                    radius: *radius,
                    vmin: 0.0,
                    vmax: height,
                    arc: Some(geom::ArcRange { start: *start, span: *sw }),
                });
                let mut uses = Vec::new();
                // The base and top arcs ride the cylinder's own (u, v) space;
                // the two vertical seams sit at constant angle.
                uses.push(cyl_arc_use(&e_base[i], true, *start, *start + *sw, 0.0, height));
                uses.push(cyl_arc_use(&vert[j], true, *start + *sw, *start + *sw, 0.0, height));
                uses.push(cyl_arc_use(&e_top[i], false, *start + *sw, *start, height, height));
                uses.push(cyl_arc_use(&vert[i], false, *start, *start, height, 0.0));
                faces.push(make_face(wall, [[*start, *start + *sw], [0.0, height]], uses));
            }
        }
    }
    // Caps. Base's outward normal is -sweep, top's is +sweep.
    let base_plane = Plane::new(at(segs[0].endpoints().0), scale(sweep_unit, -1.0));
    let top_plane = Plane::new(add(at(segs[0].endpoints().0), sweep), sweep_unit);
    let base_uses = (0..n)
        .map(|i| {
            let (a, b) = segs[i].endpoints();
            planar_seg_use(&base_plane, &e_base[i], true, at(a), at(b))
        })
        .collect();
    let top_uses = (0..n)
        .map(|i| {
            let (a, b) = segs[i].endpoints();
            planar_seg_use(&top_plane, &e_top[i], true, add(at(a), sweep), add(at(b), sweep))
        })
        .collect();
    faces.push(make_face(Surface::Plane(base_plane), [[0.0, 1.0], [0.0, 1.0]], base_uses));
    faces.push(make_face(Surface::Plane(top_plane), [[0.0, 1.0], [0.0, 1.0]], top_uses));

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Ok(Solid { shells: vec![shell] })
}

/// Loft between two matching closed outlines given as world-space points,
/// paired by index -- the ruled case of OCCT's BRepOffsetAPI_ThruSections (a
/// `blend` of two straight-segment sketches on parallel planes). One planar
/// quad per matching segment pair plus two planar caps, every edge a shared
/// handle (§4.2) so a later boolean can consume the result. Returns None when
/// a side quad is not coplanar within 1e-9 relative, the outlines wind
/// opposite ways (a twisted loft) or a profile is degenerate -- the caller
/// refuses the blend in words instead of building a wrong solid.
pub fn blend_solid(lo: &[Vec3], hi: &[Vec3]) -> Option<TSolid> {
    let n = lo.len();
    if n < 3 || hi.len() != n {
        return None;
    }
    // Each side quad's four points must be coplanar: the fourth point's
    // distance from the other three's plane, relative to the quad's own size.
    for i in 0..n {
        let j = (i + 1) % n;
        let a = sub(lo[j], lo[i]);
        let b = sub(hi[j], lo[i]);
        let c = sub(hi[i], lo[i]);
        let nn = cross(a, b);
        let ln = crate::math::len(nn);
        let span = crate::math::len(a).max(crate::math::len(b)).max(crate::math::len(c));
        if ln <= 1e-30 || crate::math::dot(c, nn).abs() / (ln * span) > 1e-9 {
            return None;
        }
    }
    let newell = |ring: &[Vec3]| -> Vec3 {
        let mut acc = [0.0, 0.0, 0.0];
        for i in 0..ring.len() {
            let j = (i + 1) % ring.len();
            acc = add(acc, cross(sub(ring[i], ring[0]), sub(ring[j], ring[0])));
        }
        acc
    };
    let nn_lo = newell(lo);
    let nn_hi = newell(hi);
    if crate::math::len(nn_lo) <= 1e-12 || crate::math::len(nn_hi) <= 1e-12 {
        return None;
    }
    let axis = crate::math::normalize(nn_lo);
    // Opposite windings would pair the points into twisted sides.
    if crate::math::dot(nn_hi, axis) <= 0.0 {
        return None;
    }
    let centroid = |ring: &[Vec3]| -> Vec3 {
        let mut c = [0.0, 0.0, 0.0];
        for p in ring {
            c = add(c, *p);
        }
        scale(c, 1.0 / ring.len() as f64)
    };
    // Whether the shared winding normal points toward the hi outline or away
    // from it; the caps' windings and the side rings flip with it.
    let towards_hi = crate::math::dot(axis, sub(centroid(hi), centroid(lo))) > 0.0;

    let lo_v: Vec<topo::VertexRef> = lo.iter().map(|p| topo::vertex(*p)).collect();
    let hi_v: Vec<topo::VertexRef> = hi.iter().map(|p| topo::vertex(*p)).collect();
    let e_lo: Vec<TEdge> = (0..n)
        .map(|i| {
            let j = (i + 1) % n;
            topo::edge(lo_v[i].clone(), lo_v[j].clone(), true, Curve::Segment { a: lo[i], b: lo[j] })
        })
        .collect();
    let e_hi: Vec<TEdge> = (0..n)
        .map(|i| {
            let j = (i + 1) % n;
            topo::edge(hi_v[i].clone(), hi_v[j].clone(), true, Curve::Segment { a: hi[i], b: hi[j] })
        })
        .collect();
    let e_side: Vec<TEdge> = (0..n)
        .map(|i| {
            topo::edge(lo_v[i].clone(), hi_v[i].clone(), true, Curve::Segment { a: lo[i], b: hi[i] })
        })
        .collect();

    let mut faces: Vec<TFace> = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        // With the winding normal toward hi, the ring [P_i, P_{i+1}, Q_{i+1},
        // Q_i] faces outward; against it, [P_i, Q_i, Q_{i+1}, P_{i+1}] does.
        let ring: [Vec3; 4] = if towards_hi {
            [lo[i], lo[j], hi[j], hi[i]]
        } else {
            [lo[i], hi[i], hi[j], lo[j]]
        };
        let plane = Plane::new(ring[0], crate::math::normalize(newell(&ring)));
        let mut uses = Vec::with_capacity(4);
        if towards_hi {
            uses.push(planar_seg_use(&plane, &e_lo[i], true, ring[0], ring[1]));
            uses.push(planar_seg_use(&plane, &e_side[j], true, ring[1], ring[2]));
            uses.push(planar_seg_use(&plane, &e_hi[i], false, ring[2], ring[3]));
            uses.push(planar_seg_use(&plane, &e_side[i], false, ring[3], ring[0]));
        } else {
            uses.push(planar_seg_use(&plane, &e_side[i], true, ring[0], ring[1]));
            uses.push(planar_seg_use(&plane, &e_hi[i], true, ring[1], ring[2]));
            uses.push(planar_seg_use(&plane, &e_side[j], false, ring[2], ring[3]));
            uses.push(planar_seg_use(&plane, &e_lo[i], false, ring[3], ring[0]));
        }
        faces.push(make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses));
    }
    // Caps. The lo cap points away from the solid, the hi cap into the
    // direction hi lies in; each traverses its ring in the winding that makes
    // its plane normal outward.
    let lo_plane = Plane::new(lo[0], if towards_hi { scale(axis, -1.0) } else { axis });
    let hi_plane = Plane::new(hi[0], if towards_hi { axis } else { scale(axis, -1.0) });
    let lo_order: Vec<usize> = if towards_hi { (0..n).rev().collect() } else { (0..n).collect() };
    let hi_order: Vec<usize> = if towards_hi { (0..n).collect() } else { (0..n).rev().collect() };
    let cap_uses = |order: &[usize], pts: &[Vec3], edges: &[TEdge], plane: &Plane| -> Vec<topo::EdgeUse<Curve3>> {
        (0..n)
            .map(|k| {
                let a = order[k];
                let b = order[(k + 1) % n];
                let (m, forward) = if b == (a + 1) % n { (a, true) } else { (b, false) };
                planar_seg_use(plane, &edges[m], forward, pts[a], pts[b])
            })
            .collect()
    };
    faces.push(make_face(Surface::Plane(lo_plane.clone()), [[0.0, 1.0], [0.0, 1.0]], cap_uses(&lo_order, lo, &e_lo, &lo_plane)));
    faces.push(make_face(Surface::Plane(hi_plane.clone()), [[0.0, 1.0], [0.0, 1.0]], cap_uses(&hi_order, hi, &e_hi, &hi_plane)));

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Some(Solid { shells: vec![shell] })
}

/// Build a solid of revolution from a closed profile given in (radius, height)
/// coordinates, spun a full turn about `axis`. `e1` is the direction radius 0
/// points along at angle 0; the axis passes through the world origin.
///
/// The profile is read with its interior on a consistent side (its own winding
/// decides the 2D outward normal of each segment), and that normal picks the
/// direction each generated face points. Only segments PARALLEL or
/// PERPENDICULAR to the axis are built: they revolve to a cylinder and a planar
/// annulus, both of which this kernel measures exactly. A slanted segment would
/// revolve to a cone frustum and returns None rather than a wrong solid -- the
/// caller refuses that revolve in words instead.
///
/// Returns the solid and, per profile segment, the output face index it
/// produced (None for a degenerate segment on the axis), so `swept` history can
/// be written exactly as extrude writes it.
pub fn revolve_profile(
    profile: &[[f64; 2]],
    axis: Vec3,
    e1: Vec3,
    angle_deg: f64,
) -> Option<(TSolid, Vec<Option<usize>>)> {
    let n = profile.len();
    if n < 3 {
        return None;
    }
    if (angle_deg.abs() - 360.0).abs() > 1e-9 {
        return revolve_profile_partial(profile, axis, e1, angle_deg);
    }
    let axis = crate::math::normalize(axis);
    let e1 = crate::math::normalize(sub(e1, scale(axis, crate::math::dot(axis, e1))));
    let e2 = crate::math::normalize(cross(axis, e1));

    // Shoelace signed area, in (radius, height). Its sign says which way the
    // profile is wound, which decides each segment's outward 2D normal.
    let mut a2 = 0.0;
    for i in 0..n {
        let p = profile[i];
        let q = profile[(i + 1) % n];
        a2 += p[0] * q[1] - q[0] * p[1];
    }
    if a2.abs() < 1e-12 {
        return None;
    }
    let ccw = a2 > 0.0;

    let mut faces: Vec<TFace> = Vec::new();
    let mut map: Vec<Option<usize>> = Vec::with_capacity(n);
    for i in 0..n {
        let (r0, h0) = (profile[i][0], profile[i][1]);
        let (r1, h1) = (profile[(i + 1) % n][0], profile[(i + 1) % n][1]);
        let (dr, dh) = (r1 - r0, h1 - h0);
        let len = (dr * dr + dh * dh).sqrt();
        if len < 1e-12 {
            map.push(None);
            continue;
        }
        // Outward 2D normal (radius, height) of a CCW-wound profile; reversed
        // for a CW one.
        let (nr, nh) = if ccw {
            (dh / len, -dr / len)
        } else {
            (-dh / len, dr / len)
        };

        if dr.abs() < 1e-9 {
            // Parallel to the axis: a cylindrical wall of radius r0.
            let r = r0;
            if r < 1e-9 {
                map.push(None); // on the axis -- a degenerate wall
                continue;
            }
            let h_lo = h0.min(h1);
            let hh = (h1 - h0).abs();
            // e1 is flipped for an inward-pointing wall (the hole of an
            // annulus), which flips cross(r_u, r_v) to point toward the axis.
            let e1c = if nr >= 0.0 { e1 } else { scale(e1, -1.0) };
            let surf = Surface::Cylinder(Cylinder {
                origin: scale(axis, h_lo),
                axis,
                e1: e1c,
                e2,
                radius: r,
                vmin: 0.0,
                vmax: hh,
                arc: None,
            });
            let pa = add(scale(e1c, r), scale(axis, h_lo));
            let pb = add(scale(e1c, r), scale(axis, h_lo + hh));
            let seam = topo::edge(
                topo::vertex(pa),
                topo::vertex(pb),
                true,
                Curve::Segment { a: pa, b: pb },
            );
            let use_ = topo::EdgeUse {
                edge: seam,
                forward: true,
                pcurve: topo::Pcurve {
                    start: [0.0, 0.0],
                    end: [0.0, hh],
                    mid: [0.0, hh / 2.0],
                },
            };
            let f = make_face(
                surf,
                [[0.0, 2.0 * std::f64::consts::PI], [0.0, hh]],
                vec![use_],
            );
            map.push(Some(faces.len()));
            faces.push(f);
        } else if dh.abs() < 1e-9 {
            // Perpendicular to the axis: a planar annulus at height h0, with a
            // hole of radius r_lo when the profile does not reach the axis.
            let h = h0;
            let r_lo = r0.min(r1);
            let r_hi = r0.max(r1);
            if r_hi < 1e-12 {
                map.push(None);
                continue;
            }
            let nrm = if nh >= 0.0 { axis } else { scale(axis, -1.0) };
            let centre = scale(axis, h);
            let plane = Plane::new(centre, nrm);
            let zero_pc = topo::Pcurve {
                start: [0.0, 0.0],
                end: [0.0, 0.0],
                mid: [0.0, 0.0],
            };
            let outer = {
                let c = Curve::Circle {
                    center: centre,
                    radius: r_hi,
                    normal: axis,
                };
                let v = topo::vertex(add(centre, scale(e1, r_hi)));
                topo::EdgeUse {
                    edge: topo::edge(v.clone(), v, true, c),
                    // CCW about +axis when the face points along +axis; the
                    // hole is the same loop reversed.
                    forward: nh >= 0.0,
                    pcurve: zero_pc.clone(),
                }
            };
            let mut wires = vec![Rc::new(RefCell::new(Wire { edges: vec![outer] }))];
            if r_lo > 1e-9 {
                let c = Curve::Circle {
                    center: centre,
                    radius: r_lo,
                    normal: axis,
                };
                let v = topo::vertex(add(centre, scale(e1, r_lo)));
                let inner = topo::EdgeUse {
                    edge: topo::edge(v.clone(), v, true, c),
                    forward: nh < 0.0,
                    pcurve: zero_pc.clone(),
                };
                wires.push(Rc::new(RefCell::new(Wire { edges: vec![inner] })));
            }
            let f = Rc::new(RefCell::new(Face {
                boundary: wires,
                forward: true,
                surface: Surface::Plane(plane),
                uv_domain: [[0.0, 1.0], [0.0, 1.0]],
            }));
            map.push(Some(faces.len()));
            faces.push(f);
        } else {
            // Slanted: a cone frustum. Not built in this slice -- refusing is
            // the honest answer, never a solid that is not what was asked for.
            return None;
        }
    }
    Some((
        Solid {
            shells: vec![Rc::new(RefCell::new(Shell { faces }))],
        },
        map,
    ))
}

/// A partial-angle revolve: the same walls as a full turn, but each curved
/// wall is restricted to [0, angle], each annulus becomes a planar sector, and
/// two planar caps close the ends. Rotation is right-handed about `axis`: a
/// point at radius r, height h sits at
/// `h*axis + r*(e1 cos t + e2 sin t)`, matching OCCT's
/// `BRepPrimAPI_MakeRevol(face, gp_Ax1(origin, axis), angle)`.
fn revolve_profile_partial(
    profile: &[[f64; 2]],
    axis: Vec3,
    e1: Vec3,
    angle_deg: f64,
) -> Option<(TSolid, Vec<Option<usize>>)> {
    let n = profile.len();
    if n < 3 {
        return None;
    }
    let angle = angle_deg.to_radians();
    if angle.abs() < 1e-12 || (angle.abs() - std::f64::consts::TAU).abs() < 1e-12 {
        return None;
    }
    let axis = crate::math::normalize(axis);
    let e1 = crate::math::normalize(sub(e1, scale(axis, crate::math::dot(axis, e1))));
    let e2 = crate::math::normalize(cross(axis, e1));
    let at = |r: f64, h: f64, t: f64| {
        add(
            scale(axis, h),
            scale(add(scale(e1, t.cos()), scale(e2, t.sin())), r),
        )
    };

    let mut a2 = 0.0;
    for i in 0..n {
        let p = profile[i];
        let q = profile[(i + 1) % n];
        a2 += p[0] * q[1] - q[0] * p[1];
    }
    if a2.abs() < 1e-12 {
        return None;
    }
    let ccw = a2 > 0.0;

    let mut faces: Vec<TFace> = Vec::new();
    let mut map: Vec<Option<usize>> = Vec::with_capacity(n);
    for i in 0..n {
        let (r0, h0) = (profile[i][0], profile[i][1]);
        let (r1, h1) = (profile[(i + 1) % n][0], profile[(i + 1) % n][1]);
        let (dr, dh) = (r1 - r0, h1 - h0);
        let len = (dr * dr + dh * dh).sqrt();
        if len < 1e-12 {
            map.push(None);
            continue;
        }
        let (nr, nh) = if ccw {
            (dh / len, -dr / len)
        } else {
            (-dh / len, dr / len)
        };

        if dr.abs() < 1e-9 {
            // Parallel to the axis: a partial cylindrical wall. `e2` stays the
            // one right-handed frame (never recomputed from a flipped `e1`):
            // flipping `e1` alone is what makes an inward-pointing (hole) wall.
            // The flip MIRRORS the frame, so the arc's own range must be
            // reflected with it: a point at original angle t sits at u = pi - t
            // in the flipped frame, so the sector [0, angle] becomes
            // [pi - angle, pi]. Leaving the range at [0, angle] put the hole
            // wall on the OPPOSITE half of the circle -- invisible to volume
            // (a sector has the same volume wherever it sits) and to the 180-
            // degree groove fixture (mirror-symmetric), caught by W6's
            // 90-degree bbox as x reaching -10 instead of 0.
            let r = r0;
            if r < 1e-9 {
                map.push(None);
                continue;
            }
            let h_lo = h0.min(h1);
            let hh = (h1 - h0).abs();
            let (e1c, arc_start) = if nr >= 0.0 {
                (e1, 0.0)
            } else {
                (scale(e1, -1.0), std::f64::consts::PI - angle.abs())
            };
            let surf = Surface::Cylinder(Cylinder {
                origin: scale(axis, h_lo),
                axis,
                e1: e1c,
                e2,
                radius: r,
                vmin: 0.0,
                vmax: hh,
                arc: Some(geom::ArcRange { start: arc_start, span: angle.abs() }),
            });
            let pa = add(scale(e1c, r), scale(axis, h_lo));
            let pb = add(scale(e1c, r), scale(axis, h_lo + hh));
            let seam = topo::edge(
                topo::vertex(pa),
                topo::vertex(pb),
                true,
                Curve::Segment { a: pa, b: pb },
            );
            let use_ = topo::EdgeUse {
                edge: seam,
                forward: true,
                pcurve: topo::Pcurve { start: [arc_start, 0.0], end: [arc_start, hh], mid: [arc_start, hh / 2.0] },
            };
            let f = make_face(surf, [[arc_start, arc_start + angle.abs()], [0.0, hh]], vec![use_]);
            map.push(Some(faces.len()));
            faces.push(f);
        } else if dh.abs() < 1e-9 {
            // Perpendicular to the axis: a planar annulus sector at height h0,
            // bounded by two real arcs and two radial segments. The plane's
            // frame is (e1, ±e2) so the sector's angle is exactly the revolve
            // angle; `v`'s sign matches the face's outward normal.
            let h = h0;
            let r_lo = r0.min(r1);
            let r_hi = r0.max(r1);
            if r_hi < 1e-12 {
                map.push(None);
                continue;
            }
            let nrm = if nh >= 0.0 { axis } else { scale(axis, -1.0) };
            let vsign = crate::math::dot(nrm, axis).signum();
            let v = scale(e2, vsign);
            let centre = scale(axis, h);
            let plane = Plane { origin: centre, n: nrm, u: e1, v };
            let p_out0 = add(centre, scale(e1, r_hi));
            let dir1 = add(scale(e1, angle.cos()), scale(e2, angle.sin()));
            let p_out1 = add(centre, scale(dir1, r_hi));
            let p_in0 = add(centre, scale(e1, r_lo));
            let p_in1 = add(centre, scale(dir1, r_lo));
            let seg = |a: Vec3, b: Vec3| {
                topo::edge(topo::vertex(a), topo::vertex(b), true, Curve::Segment { a, b })
            };
            let arc = |center: Vec3, radius: f64, x_axis: Vec3, sweep: f64| {
                topo::edge(
                    topo::vertex(add(center, scale(x_axis, radius))),
                    topo::vertex(add(
                        center,
                        scale(add(scale(x_axis, sweep.cos()), scale(e2, sweep.sin())), radius),
                    )),
                    true,
                    // The arc's own frame is fixed to (e1, e2) about `axis` --
                    // NOT the face's outward normal, which flips for a lower
                    // annulus and would put its arc on the wrong side of the
                    // axis, dragging the tool's bbox across the revolve plane.
                    Curve::Arc { center, radius, normal: axis, x_axis, sweep },
                )
            };
            let uses = vec![
                planar_seg_use(&plane, &arc(centre, r_hi, e1, angle), true, p_out0, p_out1),
                planar_seg_use(&plane, &seg(p_out1, p_in1), true, p_out1, p_in1),
                planar_seg_use(&plane, &arc(centre, r_lo, dir1, -angle), true, p_in1, p_in0),
                planar_seg_use(&plane, &seg(p_in0, p_out0), true, p_in0, p_out0),
            ];
            let f = make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses);
            map.push(Some(faces.len()));
            faces.push(f);
        } else {
            return None;
        }
    }

    // Two planar caps, each a copy of the profile polygon, at angle 0 and
    // angle `angle`. Their outward normals point away from the swept material:
    // the cap at t=0 faces -dir(0), the one at t=angle faces +dir(angle).
    let dir_at = |t: f64| add(scale(e1, -t.sin()), scale(e2, t.cos()));
    let cap_face = |t: f64, outward: Vec3, faces: &mut Vec<TFace>| {
        let ring: Vec<Vec3> = profile.iter().map(|p| at(p[0], p[1], t)).collect();
        let plane = Plane::new(ring[0], outward);
        let mut uses = Vec::new();
        for k in 0..ring.len() {
            let a = ring[k];
            let b = ring[(k + 1) % ring.len()];
            let e = topo::edge(topo::vertex(a), topo::vertex(b), true, Curve::Segment { a, b });
            uses.push(planar_seg_use(&plane, &e, true, a, b));
        }
        faces.push(make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses));
    };
    cap_face(0.0, scale(dir_at(0.0), -1.0), &mut faces);
    cap_face(angle, dir_at(angle), &mut faces);

    Some((
        Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] },
        map,
    ))
}

fn base_at(v: &topo::VertexRef) -> Vec3 {
    v.borrow().point
}
/// A plane just for projecting an arc wall's pcurves. The wall's real surface
/// is the cylinder; this frame only needs to be perpendicular to the axis.
fn wall_plane(centre: Vec3, u_axis: Vec3, v_axis: Vec3) -> Plane {
    Plane::new(centre, crate::math::normalize(cross(u_axis, v_axis)))
}

/// One edge use of a cylindrical wall, in the cylinder's own (u = angle,
/// v = height) parameter space.
fn cyl_arc_use(
    e: &TEdge,
    forward: bool,
    u0: f64,
    u1: f64,
    v0: f64,
    v1: f64,
) -> topo::EdgeUse<Curve3> {
    topo::EdgeUse {
        edge: e.clone(),
        forward,
        pcurve: topo::Pcurve {
            start: [u0, v0],
            end: [u1, v1],
            mid: [(u0 + u1) / 2.0, (v0 + v1) / 2.0],
        },
    }
}

/// One edge use of a planar face, with the pcurve projected through `plane`.
fn planar_seg_use(
    plane: &Plane,
    e: &TEdge,
    forward: bool,
    sa: Vec3,
    sb: Vec3,
) -> topo::EdgeUse<Curve3> {
    topo::EdgeUse {
        edge: e.clone(),
        forward,
        pcurve: topo::Pcurve {
            start: plane.project(sa),
            end: plane.project(sb),
            mid: plane.project(scale(add(sa, sb), 0.5)),
        },
    }
}

/// Extrude a straight-edged polygon profile, given in the sketch plane's own
/// (u, v) coordinates, along `sweep` (a world vector). `origin` is the plane's
/// offset point; `u_axis`/`v_axis` are the world directions the sketch's u and v
/// land on (PLANE_AXES in occt-build.ts). The solid spans from the profile to
/// the profile translated by `sweep`, so a profile at z=0 extruded by +Z*h sits
/// with its base on z=0, exactly as OCCT's MakePrism does.
pub fn extrude_polygon(
    pts_uv: &[[f64; 2]],
    origin: Vec3,
    u_axis: Vec3,
    v_axis: Vec3,
    sweep: Vec3,
) -> TSolid {
    let n = pts_uv.len();
    let at = |p: [f64; 2]| add(origin, add(scale(u_axis, p[0]), scale(v_axis, p[1])));
    let base: Vec<Vec3> = pts_uv.iter().map(|p| at(*p)).collect();
    let top: Vec<Vec3> = base.iter().map(|p| add(*p, sweep)).collect();
    let base_v: Vec<topo::VertexRef> = base.iter().map(|p| topo::vertex(*p)).collect();
    let top_v: Vec<topo::VertexRef> = top.iter().map(|p| topo::vertex(*p)).collect();
    let sweep_unit = crate::math::normalize(sweep);

    // Base/top boundary edges, shared by the caps and the two lateral faces
    // that meet along them (§4.2 shared handles).
    let mut e_base: Vec<TEdge> = Vec::with_capacity(n);
    let mut e_top: Vec<TEdge> = Vec::with_capacity(n);
    for i in 0..n {
        let j = (i + 1) % n;
        e_base.push(topo::edge(
            base_v[i].clone(),
            base_v[j].clone(),
            true,
            Curve::Segment { a: base[i], b: base[j] },
        ));
        e_top.push(topo::edge(
            top_v[i].clone(),
            top_v[j].clone(),
            true,
            Curve::Segment { a: top[i], b: top[j] },
        ));
    }
    // One vertical edge per profile vertex, shared by the two adjacent sides.
    let vert: Vec<TEdge> = (0..n)
        .map(|i| {
            topo::edge(
                base_v[i].clone(),
                top_v[i].clone(),
                true,
                Curve::Segment { a: base[i], b: top[i] },
            )
        })
        .collect();

    let mut faces: Vec<TFace> = Vec::new();
    // Lateral faces. Outward normal is cross(edge direction, sweep): on the
    // ground plane edge (0)->(1) along +x with sweep +z gives -y, which is the
    // outward side of the y=0 edge. The same construction is correct on xz/yz
    // because the plane axes are chosen so n*dir == u x v (see PLANE_AXES).
    for i in 0..n {
        let j = (i + 1) % n;
        let e = sub(base[j], base[i]);
        let nrm = crate::math::normalize(cross(e, sweep));
        let plane = Plane::new(base[i], nrm);
        let uses = vec![
            planar_seg_use(&plane, &e_base[i], true, base[i], base[j]),
            planar_seg_use(&plane, &vert[j], true, base[j], top[j]),
            planar_seg_use(&plane, &e_top[i], false, top[j], top[i]),
            planar_seg_use(&plane, &vert[i], false, top[i], base[i]),
        ];
        faces.push(make_face(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], uses));
    }
    // Caps. The base cap's outward normal is -sweep, the top cap's is +sweep.
    let base_plane = Plane::new(base[0], scale(sweep_unit, -1.0));
    let top_plane = Plane::new(top[0], sweep_unit);
    let base_uses = (0..n)
        .map(|i| planar_seg_use(&base_plane, &e_base[i], true, base[i], base[(i + 1) % n]))
        .collect();
    let top_uses = (0..n)
        .map(|i| planar_seg_use(&top_plane, &e_top[i], true, top[i], top[(i + 1) % n]))
        .collect();
    faces.push(make_face(Surface::Plane(base_plane), [[0.0, 1.0], [0.0, 1.0]], base_uses));
    faces.push(make_face(Surface::Plane(top_plane), [[0.0, 1.0], [0.0, 1.0]], top_uses));

    let shell = Rc::new(RefCell::new(Shell { faces }));
    Solid { shells: vec![shell] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_has_six_faces_twelve_edges_eight_vertices() {
        let s = box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None);
        assert_eq!(s.faces().len(), 6);
        assert_eq!(s.edges().len(), 12);
        assert_eq!(s.vertices().len(), 8);
    }

    #[test]
    fn box_volume_is_exact() {
        let s = box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None);
        assert!((solid_volume(&s) - 24000.0).abs() < 1e-9);
    }

    #[test]
    fn box_aabb_is_tight_not_padded() {
        let s = box_solid([40.0, 30.0, 20.0], [5.0, -3.0, 2.0], None);
        let b = solid_aabb(&s);
        assert_eq!(b.lo, [-15.0, -18.0, -8.0]);
        assert_eq!(b.hi, [25.0, 12.0, 12.0]);
    }

    #[test]
    fn every_box_edge_is_shared_by_exactly_two_faces() {
        // §4.2: two faces that share an edge hold the SAME handle. An edge used
        // by exactly two face-wires is the observable consequence.
        let s = box_solid([10.0, 10.0, 10.0], [0.0, 0.0, 0.0], None);
        for e in s.edges() {
            let count = s
                .faces()
                .iter()
                .filter(|f| {
                    f.borrow().boundary.iter().any(|w| {
                        w.borrow().edges.iter().any(|u| topo::same(&u.edge, &e))
                    })
                })
                .count();
            assert_eq!(count, 2, "every box edge borders exactly two faces");
        }
    }

    #[test]
    fn move_translates_and_preserves_volume_and_topology() {
        let s = box_solid([20.0, 20.0, 20.0], [0.0, 0.0, 0.0], None);
        let t = Transform::translation([15.0, 5.0, 0.0]);
        let m = transform_solid(&s, &t);
        assert_eq!(m.faces().len(), 6);
        assert_eq!(m.edges().len(), 12);
        assert!((solid_volume(&m) - 8000.0).abs() < 1e-9);
        assert_eq!(solid_aabb(&m).lo, [5.0, -5.0, -10.0]);
        assert_eq!(solid_aabb(&m).hi, [25.0, 15.0, 10.0]);
    }

    #[test]
    fn move_preserves_shared_handles() {
        let s = box_solid([20.0, 20.0, 20.0], [0.0, 0.0, 0.0], None);
        let m = transform_solid(&s, &Transform::translation([15.0, 5.0, 0.0]));
        assert_eq!(m.edges().len(), 12, "shared handles must not be duplicated");
        assert_eq!(m.vertices().len(), 8);
    }

    fn close(got: f64, want: f64, tol: f64, what: &str) {
        let d = (got - want).abs() / want.abs().max(1.0);
        assert!(d < tol, "{what}: got {got}, want {want} (rel {d:e})");
    }

    #[test]
    fn cylinder_volume_and_bbox() {
        let s = cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
        let want = std::f64::consts::PI * 144.0 * 30.0;
        close(solid_volume(&s), want, 1e-12, "cylinder volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -12.0, 1e-12, "cyl lo x");
        close(b.hi[0], 12.0, 1e-12, "cyl hi x");
        close(b.lo[2], -15.0, 1e-12, "cyl lo z");
        close(b.hi[2], 15.0, 1e-12, "cyl hi z");
    }

    #[test]
    fn cone_volume_and_bbox() {
        let s = cone_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
        let want = std::f64::consts::PI * 144.0 * 30.0 / 3.0;
        close(solid_volume(&s), want, 1e-12, "cone volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -12.0, 1e-12, "cone lo x");
        close(b.hi[0], 12.0, 1e-12, "cone hi x");
        close(b.hi[2], 15.0, 1e-12, "cone hi z");
    }

    #[test]
    fn sphere_volume_and_bbox() {
        let s = sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let want = 4.0 / 3.0 * std::f64::consts::PI * 15.0f64.powi(3);
        close(solid_volume(&s), want, 1e-12, "sphere volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -15.0, 1e-12, "sphere lo x");
        close(b.hi[2], 15.0, 1e-12, "sphere hi z");
    }

    #[test]
    fn torus_volume_and_bbox() {
        let s = torus_solid([0.0, 0.0, 0.0], 14.0, 4.0, [0.0, 0.0, 1.0]);
        let want = 2.0 * std::f64::consts::PI * std::f64::consts::PI * 14.0 * 16.0;
        close(solid_volume(&s), want, 1e-12, "torus volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -18.0, 1e-12, "torus lo x");
        close(b.hi[2], 4.0, 1e-12, "torus hi z");
    }

    #[test]
    fn prism_hex_volume_and_bbox() {
        let s = prism_solid([0.0, 0.0, 0.0], 6, 10.0, 20.0, [0.0, 0.0, 1.0]);
        let want = 3.0f64.sqrt() / 2.0 * 100.0 * 6.0 / 2.0 * 20.0;
        close(solid_volume(&s), want, 1e-12, "hex prism volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -10.0, 1e-12, "prism lo x");
        close(b.hi[2], 10.0, 1e-12, "prism hi z");
    }

    #[test]
    fn wedge_volume_and_bbox() {
        let s = wedge_solid([0.0, 0.0, 0.0], 20.0, 10.0, 6.0, [0.0, 0.0, 1.0]);
        close(solid_volume(&s), 600.0, 1e-12, "wedge volume");
        let b = solid_aabb(&s);
        close(b.lo[0], -10.0, 1e-12, "wedge lo x");
        close(b.hi[1], 5.0, 1e-12, "wedge hi y");
    }

    // A rectangular half-ring profile: radius r in [4, 8], height y in [5, 12],
    // spun 180 degrees about +Y with radius 0 along +X (the xz-plane frame).
    const HALF_RING: [[f64; 2]; 4] = [[4.0, 5.0], [8.0, 5.0], [8.0, 12.0], [4.0, 12.0]];

    #[test]
    fn partial_revolve_half_ring_volume_is_positive_and_exact() {
        let (s, _) = revolve_profile(&HALF_RING, [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], 180.0)
            .expect("partial revolve builds");
        let want = std::f64::consts::PI * (64.0 - 16.0) * 7.0 / 2.0;
        assert!(signed_volume(&s) > 0.0, "half-ring tool must wind outward");
        close(solid_volume(&s), want, 1e-9, "half-ring tool volume");
    }

    #[test]
    fn groove_full_and_straddle_volumes() {
        // The three groove fixtures: a box with an enclosed revolved ring cut
        // out of it. Each ring sits strictly inside the 40x40x20 box.
        let cases: [(f64, [[f64; 2]; 4], f64); 2] = [
            (
                30944.424868,
                [[4.0, 5.0], [8.0, 5.0], [8.0, 12.0], [4.0, 12.0]],
                32000.0 - std::f64::consts::PI * (64.0 - 16.0) * 7.0,
            ),
            (
                31321.415987,
                [[3.0, -4.0], [6.0, -4.0], [6.0, 4.0], [3.0, 4.0]],
                32000.0 - std::f64::consts::PI * (36.0 - 9.0) * 8.0,
            ),
        ];
        for (want_occt, prof, want) in cases {
            let box_ = box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
            let (tool, _) = revolve_profile(&prof, [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], 360.0)
                .expect("full revolve builds");
            let cut = crate::ops::boolean("subtract", &box_, &tool).expect("groove cuts");
            close(solid_volume(&cut), want, 1e-9, "groove volume");
            close(solid_volume(&cut), want_occt, 1e-6, "groove volume vs OCCT");
        }
    }

    #[test]
    fn groove_half_volume() {
        let box_ = box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let (tool, _) = revolve_profile(&HALF_RING, [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], 180.0)
            .expect("partial revolve builds");
        let cut = crate::ops::boolean("subtract", &box_, &tool).expect("groove-half cuts");
        let want = 32000.0 - std::f64::consts::PI * (64.0 - 16.0) * 7.0 / 2.0;
        close(solid_volume(&cut), want, 1e-9, "groove-half volume");
    }

    // SPEC-sketcher2 §7: two pre-existing extrude_profile bugs, unreachable
    // from the polygon sketcher's own paths but trivially reachable from a
    // soup sketch's hand-built ProfileSeg chain. RED until the fixes land.

    #[test]
    fn two_arc_circle_cw_winds_cw() {
        // Two half-circle arcs swept clockwise (0 -> -pi -> -2pi). Their
        // chords are diametral, so the shoelace sum over chord endpoints
        // alone is exactly 0 for EITHER winding (§7.1) -- today's
        // `a2 >= 0.0` picks CCW regardless, and this CW circle comes out
        // inside-out.
        let pi = std::f64::consts::PI;
        let segs = vec![
            ProfileSeg::Arc { centre: [0.0, 0.0], radius: 5.0, start: 0.0, sweep: -pi },
            ProfileSeg::Arc { centre: [0.0, 0.0], radius: 5.0, start: -pi, sweep: -pi },
        ];
        let s = extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0])
            .expect("a two-arc circle is a valid closed profile");
        assert!(signed_volume(&s) > 0.0, "a CW two-arc circle must wind outward, not inside-out");
    }

    #[test]
    fn n1_profile_refuses() {
        // One segment can never enclose an area; base_v[0] -> base_v[0]
        // wraps the sole edge onto itself.
        let segs = vec![ProfileSeg::Line { a: [0.0, 0.0], b: [10.0, 0.0] }];
        let r = extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0]);
        assert!(r.is_err(), "a single segment has no interior and must refuse");
    }

    #[test]
    fn n2_gon_refuses() {
        // A straight there-and-back digon, zero enclosed area -- distinct
        // from the legitimate 2-arc circle above, which also has n == 2
        // but real area once the shoelace correction is in.
        let segs = vec![
            ProfileSeg::Line { a: [0.0, 0.0], b: [10.0, 0.0] },
            ProfileSeg::Line { a: [10.0, 0.0], b: [0.0, 0.0] },
        ];
        let r = extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0]);
        assert!(r.is_err(), "a 2-gon has no interior and must refuse");
    }

    #[test]
    fn emit_gate_refuses_drift() {
        // A line, an arc, and a closing line: every join is exact except
        // the arc-end -> closing-line-start join, drifted 0.4mm in u, as if
        // a solve moved the arc's endpoint after the profile was
        // serialized (§7.2). The emit gate must recompute endpoints and
        // refuse, naming both segments on either side of the gap (0-based
        // "segment N", matching the `endpoints()` index into `segs`).
        let pi = std::f64::consts::PI;
        let segs = vec![
            ProfileSeg::Line { a: [0.0, 0.0], b: [10.0, 0.0] },
            ProfileSeg::Arc { centre: [10.0, 5.0], radius: 5.0, start: -pi / 2.0, sweep: pi },
            ProfileSeg::Line { a: [10.4, 10.0], b: [0.0, 0.0] },
        ];
        let r = extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0]);
        let err = match r {
            Ok(_) => panic!("a 0.4mm drifted endpoint must refuse, not build a gapped wire"),
            Err(e) => e,
        };
        assert!(err.contains("segment 1"), "the refusal names the first segment: {err}");
        assert!(err.contains("segment 2"), "the refusal names the second segment: {err}");
        assert!(err.contains("0.4"), "the refusal names the drift distance: {err}");
    }
}

