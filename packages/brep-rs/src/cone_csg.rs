//! A cone joined to, cut by, or cutting a box (W3 S1b, SPEC-brep-cone-booleans.md), for a box with a face square to the cone's axis.
//!
//! The same frame as `cone_keep.rs` (the cone's base centre the origin, its axis +z, the box `lo <= p <= hi`), and the same idea: the
//! flat faces are built from flat regions (`cone_region.rs`), and the cone's slanted face is whatever the flat faces use ONCE.
//!
//!   * every box plane: the box's rectangle, `minus` the cone's section by that plane (a join, or the box minus the cone: the box
//!     outside the cone) or `meet` it (the cone minus the box: the cone's section is a wall of the notch, facing inward);
//!   * the cone's base plane: the base disk against the rectangle the box leaves at that height, `minus` it (the base outside the box)
//!     or `meet` it (the box minus the cone: the base is a wall of the pocket, facing up).
//!
//! Faces that are not convex come out with holes, and the slanted face can have several loops: outer loops and holes are told apart
//! by which way each runs round the axis. What stands behind the answer is what stands behind `keep`: every edge used twice, one
//! lump, the volume against an independent cross-section integral (`cone_box::overlap_volume`), origin-free volume, a closed mesh.

use crate::build::{TFace, TSolid};
use crate::cone_box::{overlap_volume, AlignedBox, ConeSpec};
use crate::cone_region::{combine, Face2, Op, Piece, Region};
use crate::geom::{Cone, Curve, Plane, Surface};
use crate::math::{add, cross, dot, len, normalize, scale, sub, Transform, Vec3};
use crate::topo::{self, EdgeUse, Pcurve, Shell, Solid, Wire};
use std::cell::RefCell;
use std::f64::consts::{PI, TAU};
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    /// cone OR box
    Join,
    /// cone minus box
    CutCone,
    /// box minus cone
    CutBox,
}

struct Spec {
    mode: Mode,
    r: f64,
    h: f64,
    lo: Vec3,
    hi: Vec3,
    scale_len: f64,
}

/// One edge of a flat face's loop, in 3D, from where it starts to where it ends.
struct Edge3 {
    from: Vec3,
    to: Vec3,
    curve: Curve,
}

/// A flat piece, in the plane with coordinate `k` held at `pos` (k = 0: x, 1: y, 2: z), as a curve in 3D. `(a, b)` are the other two
/// coordinates in the order the 2D loop uses: (y, z) for x, (x, z) for y, (x, y) for z.
fn edge3(sp: &Spec, k: usize, pos: f64, piece: &Piece) -> Edge3 {
    let to3 = |p: (f64, f64)| -> Vec3 {
        match k {
            0 => [pos, p.0, p.1],
            1 => [p.0, pos, p.1],
            _ => [p.0, p.1, pos],
        }
    };
    let (from, to) = (to3(piece.start()), to3(piece.end()));
    let curve = match piece {
        Piece::Seg(..) => Curve::Segment { a: from, b: to },
        Piece::Arc { c, r, a0, sw } => Curve::Arc { center: to3(*c), radius: *r, normal: [0.0, 0.0, 1.0], x_axis: [a0.cos(), a0.sin(), 0.0], sweep: *sw },
        Piece::Hyp { d, h, r, s0, s1 } => {
            let (cc, p, q) = if k == 0 { ([pos, 0.0, *h], [0.0, 0.0, -h * d / r], [0.0, *d, 0.0]) } else { ([0.0, pos, *h], [0.0, 0.0, -h * d / r], [*d, 0.0, 0.0]) };
            let _ = sp;
            Curve::Hyperbola { c: cc, p, q, s0: *s0, s1: *s1 }
        }
    };
    Edge3 { from, to, curve }
}

fn reverse_loop(l: &[Piece]) -> Vec<Piece> {
    l.iter().rev().map(|p| p.reversed()).collect()
}

struct Pool(Vec<topo::VertexRef>, f64);
impl Pool {
    fn at(&mut self, p: Vec3) -> topo::VertexRef {
        for v in &self.0 {
            if len(sub(v.borrow().point, p)) < self.1 {
                return v.clone();
            }
        }
        let v = topo::vertex(p);
        self.0.push(v.clone());
        v
    }
}

/// A flat face from its loops (the first the outer one). `normal` is the face's outward normal; the loops run counter-clockwise about it.
fn flat_face(sp: &Spec, k: usize, pos: f64, f2: &Face2, normal: Vec3, flip: bool) -> Option<TFace> {
    let nab = match k {
        0 => [1.0, 0.0, 0.0],
        1 => [0.0, -1.0, 0.0],
        _ => [0.0, 0.0, 1.0],
    };
    let turn = |l: &Vec<Piece>| if flip { reverse_loop(l) } else { l.clone() };
    let mut loops: Vec<Vec<Piece>> = vec![turn(&f2.outer)];
    loops.extend(f2.holes.iter().map(turn));
    let _ = nab;
    let sample = loops[0][0].at(0.5);
    let o = match k {
        0 => [pos, sample.0, sample.1],
        1 => [sample.0, pos, sample.1],
        _ => [sample.0, sample.1, pos],
    };
    let plane = Plane::new(o, normal);
    let mut pool = Pool(Vec::new(), 1e-9 * sp.scale_len);
    let mut wires = Vec::new();
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for l in &loops {
        let mut uses = Vec::new();
        for pc in l {
            let e = edge3(sp, k, pos, pc);
            let (va, vb) = (pool.at(e.from), pool.at(e.to));
            let (pa, pb) = (va.borrow().point, vb.borrow().point);
            let mid = e.curve.point_at(0.5);
            let pcv = Pcurve { start: plane.project(pa), end: plane.project(pb), mid: plane.project(mid) };
            for q in [pcv.start, pcv.end, pcv.mid] {
                for i in 0..2 {
                    lo[i] = lo[i].min(q[i]);
                    hi[i] = hi[i].max(q[i]);
                }
            }
            uses.push(EdgeUse { edge: topo::edge(va, vb, true, e.curve), forward: true, pcurve: pcv });
        }
        let (first, last) = (uses.first()?.edge.borrow().a.borrow().point, uses.last()?.edge.borrow().b.borrow().point);
        if len(sub(first, last)) > 1e-7 * sp.scale_len {
            return None;
        }
        wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
    }
    Some(Rc::new(RefCell::new(topo::Face { boundary: wires, forward: true, surface: Surface::Plane(plane), uv_domain: [[lo[0], hi[0]], [lo[1], hi[1]]] })))
}

/// One edge the flat faces use once: it is on the cone. `fwd` is the direction the flat face uses it, so the cone's use is the opposite.
struct Rim {
    edge: topo::EdgeRef<Curve>,
    fwd: bool,
}

impl Rim {
    fn cone_ends(&self) -> (topo::VertexRef, topo::VertexRef) {
        let e = self.edge.borrow();
        if self.fwd {
            (e.b.clone(), e.a.clone())
        } else {
            (e.a.clone(), e.b.clone())
        }
    }
    /// The edge's samples in the cone face's direction, as flat (x, y) points.
    fn xy(&self, defl: f64) -> Vec<(f64, f64)> {
        let mut pts = crate::mesh::curve_points(&self.edge.borrow().curve, defl);
        if self.fwd {
            pts.reverse();
        }
        pts.iter().map(|p| (p[0], p[1])).collect()
    }
}

fn shoelace(poly: &[(f64, f64)]) -> f64 {
    let mut a = 0.0;
    for i in 0..poly.len() {
        let (p, q) = (poly[i], poly[(i + 1) % poly.len()]);
        a += p.0 * q.1 - q.0 * p.1;
    }
    0.5 * a
}

fn inside(poly: &[(f64, f64)], p: (f64, f64)) -> bool {
    let mut c = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0 {
            c = !c;
        }
        j = i;
    }
    c
}

fn assemble(base: Vec3, apex: Vec3, r: f64, bx: &crate::ball_box::BoxSpec, mode: Mode, verify_mesh: bool) -> Result<TSolid, &'static str> {
    let h = len(sub(apex, base));
    if h < 1e-9 || r < 1e-9 {
        return Err("degenerate cone");
    }
    let z = scale(sub(apex, base), 1.0 / h);
    let k = (0..3).find(|&i| dot(bx.axes[i], z).abs() > 1.0 - 1e-9).ok_or("the box is tilted to the cone's axis")?;
    let (ix, iy) = ((k + 1) % 3, (k + 2) % 3);
    let x = normalize(sub(bx.axes[ix], scale(z, dot(bx.axes[ix], z))));
    let y = cross(z, x);
    if dot(y, bx.axes[iy]).abs() < 1.0 - 1e-9 {
        return Err("the box frame is not square");
    }
    let cc = sub(bx.c, base);
    let ctr = [dot(cc, x), dot(cc, y), dot(cc, z)];
    let half = [bx.half[ix], bx.half[iy], bx.half[k]];
    let lo = [ctr[0] - half[0], ctr[1] - half[1], ctr[2] - half[2]];
    let hi = [ctr[0] + half[0], ctr[1] + half[1], ctr[2] + half[2]];
    let scale_len = r.max(h);
    let sp = Spec { mode, r, h, lo, hi, scale_len };
    // a box face in the cone's base plane or its apex plane is a contact along an area, which is not built here
    for zz in [lo[2], hi[2]] {
        if zz.abs() < 1e-7 * scale_len || (zz - h).abs() < 1e-7 * scale_len {
            return Err("a box face lies in the cone's base plane or at its apex");
        }
    }
    let mut faces: Vec<TFace> = Vec::new();
    let tilt = 0.5772; // where a whole circle starts: off every axis
    // the box's six planes
    for (kk, pos, sigma) in [(0usize, lo[0], -1.0f64), (0, hi[0], 1.0), (1, lo[1], -1.0), (1, hi[1], 1.0), (2, lo[2], -1.0), (2, hi[2], 1.0)] {
        let rect = match kk {
            0 => Region::rect(lo[1], hi[1], lo[2], hi[2]),
            1 => Region::rect(lo[0], hi[0], lo[2], hi[2]),
            _ => Region::rect(lo[0], hi[0], lo[1], hi[1]),
        };
        let section: Option<Region> = if kk < 2 {
            if (r - pos.abs()).abs() < 1e-7 * scale_len {
                return Err("a box face is nearly tangent to the cone's base");
            }
            Region::cone_section(pos, h, r)
        } else if pos > 0.0 && pos < h {
            Some(Region::disk((0.0, 0.0), r * (1.0 - pos / h), tilt))
        } else {
            None
        };
        let op = if mode == Mode::CutCone { Op::Meet } else { Op::Minus };
        let f2 = combine(&rect, section.as_ref(), op, scale_len)?;
        let out_sign = if mode == Mode::CutCone { -sigma } else { sigma };
        let normal = match kk {
            0 => [out_sign, 0.0, 0.0],
            1 => [0.0, out_sign, 0.0],
            _ => [0.0, 0.0, out_sign],
        };
        // loops run counter-clockwise about (a x b): +x, -y, +z
        let nab = match kk {
            0 => 1.0,
            1 => -1.0,
            _ => 1.0,
        };
        let flip = out_sign * nab < 0.0;
        for f in &f2 {
            faces.push(flat_face(&sp, kk, pos, f, normal, flip).ok_or("a flat face would not close")?);
        }
    }
    // the cone's base plane
    {
        let disk = Region::disk((0.0, 0.0), r, tilt);
        let sect = if lo[2] < 0.0 && hi[2] > 0.0 { Some(Region::rect(lo[0], hi[0], lo[1], hi[1])) } else { None };
        let op = if mode == Mode::CutBox { Op::Meet } else { Op::Minus };
        let f2 = combine(&disk, sect.as_ref(), op, scale_len)?;
        let out = if mode == Mode::CutBox { 1.0 } else { -1.0 };
        for f in &f2 {
            faces.push(flat_face(&sp, 2, 0.0, f, [0.0, 0.0, out], out < 0.0).ok_or("the base would not close")?);
        }
    }
    if faces.is_empty() {
        return Err("no face");
    }
    crate::ops::drop_degenerate_faces(&mut faces);
    crate::ops::split_t_junctions(&mut faces);
    crate::ops::weld_shared_edges(&mut faces);
    let counts = crate::ops::edge_use_counts(&faces);
    if counts.values().any(|&n| n > 2) {
        return Err("an edge used more than twice");
    }
    let mut rims: Vec<Rim> = Vec::new();
    for f in &faces {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                if counts.get(&(Rc::as_ptr(&u.edge) as *const () as usize)) == Some(&1) {
                    rims.push(Rim { edge: u.edge.clone(), fwd: u.forward });
                }
            }
        }
    }
    // chain the rim into loops, each use run in the cone face's direction
    let mut taken = vec![false; rims.len()];
    let mut loops: Vec<Vec<usize>> = Vec::new();
    for s in 0..rims.len() {
        if taken[s] {
            continue;
        }
        taken[s] = true;
        let start = rims[s].cone_ends().0;
        let mut lp = vec![s];
        let mut at = rims[s].cone_ends().1;
        while !Rc::ptr_eq(&at, &start) {
            let next: Vec<usize> = (0..rims.len()).filter(|&j| !taken[j] && Rc::ptr_eq(&rims[j].cone_ends().0, &at)).collect();
            if next.len() != 1 {
                return Err("the rim does not chain into loops");
            }
            taken[next[0]] = true;
            lp.push(next[0]);
            at = rims[next[0]].cone_ends().1;
        }
        loops.push(lp);
    }
    // outer loops and holes by which way each runs round the axis, seen from above, against the face's own sense
    let polys: Vec<Vec<(f64, f64)>> = loops.iter().map(|lp| lp.iter().flat_map(|&i| rims[i].xy(1e-3 * scale_len).into_iter().rev().skip(1).rev()).collect()).collect();
    let sense = if mode == Mode::CutBox { -1.0 } else { 1.0 };
    let signed: Vec<f64> = polys.iter().map(|p| shoelace(p) * sense).collect();
    let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
    for (i, s) in signed.iter().enumerate() {
        if *s > 0.0 {
            groups.push((i, vec![]));
        }
    }
    for (i, s) in signed.iter().enumerate() {
        if *s < 0.0 {
            let probe = polys[i][0];
            let home = (0..groups.len()).filter(|&g| inside(&polys[groups[g].0], probe)).min_by(|&p, &q| signed[groups[p].0].partial_cmp(&signed[groups[q].0]).unwrap());
            match home {
                Some(g) => groups[g].1.push(i),
                None => return Err("a hole in the cone's face with nothing round it"),
            }
        } else if *s == 0.0 {
            return Err("a loop of no area on the cone");
        }
    }
    let slant = (r * r + h * h).sqrt();
    let e2 = if mode == Mode::CutBox { [0.0, -1.0, 0.0] } else { [0.0, 1.0, 0.0] };
    let surface = Surface::Cone(Cone { base: [0.0; 3], axis: [0.0, 0.0, 1.0], e1: [1.0, 0.0, 0.0], e2, base_radius: r, half_angle: r.atan2(h), slant, v_range: [0.0, slant], bounded: true });
    for (outer, holes) in &groups {
        let wires: Vec<_> = std::iter::once(outer)
            .chain(holes.iter())
            .map(|&li| {
                let uses: Vec<EdgeUse<Curve>> = loops[li].iter().map(|&i| EdgeUse { edge: rims[i].edge.clone(), forward: !rims[i].fwd, pcurve: Pcurve { start: [0.0; 2], end: [0.0; 2], mid: [0.0; 2] } }).collect();
                Rc::new(RefCell::new(Wire { edges: uses }))
            })
            .collect();
        faces.push(Rc::new(RefCell::new(topo::Face { boundary: wires, forward: true, surface: surface.clone(), uv_domain: [[0.0, TAU], [0.0, slant]] })));
    }
    if crate::ops::edge_use_counts(&faces).values().any(|&n| n != 2) {
        return Err("the shell is not closed");
    }
    if crate::ball_box::lump_count(&faces, false) != 1 {
        return Err("more than one lump");
    }
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    let (v_cone, v_box) = (PI * r * r * h / 3.0, 8.0 * half[0] * half[1] * half[2]);
    let ov = overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi });
    let want = match mode {
        Mode::Join => v_cone + v_box - ov,
        Mode::CutCone => v_cone - ov,
        Mode::CutBox => v_box - ov,
    };
    let got = crate::build::solid_volume(&solid);
    if !got.is_finite() || (got - want).abs() > 2e-6 * v_cone.max(v_box) {
        return Err("the volume disagrees with the independent integral");
    }
    if !crate::ops::volume_is_translation_invariant(&solid) {
        return Err("the volume depends on the origin");
    }
    if verify_mesh && !crate::ops::mesh_is_closed_coarse(&solid) {
        return Err("the mesh is not closed");
    }
    let t = Transform { m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]], t: base };
    let world = crate::build::transform_solid(&solid, &t);
    if (crate::build::solid_volume(&world) - got).abs() > 1e-9 * v_cone.max(v_box) {
        return Err("moving it into place changed its volume");
    }
    Ok(world)
}

/// `cone` joined to, cut by, or cutting a box, with the reason it gave up.
pub fn csg_why(base: Vec3, apex: Vec3, r: f64, bx: &crate::ball_box::BoxSpec, mode: Mode) -> Result<TSolid, &'static str> {
    assemble(base, apex, r, bx, mode, true)
}

/// The boolean entry: a whole cone against a cuboid, in either order. `intersect` is `cone_keep`'s.
pub fn cone_box_csg(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let pick = |c: &TSolid, bx: &TSolid, cone_first: bool| -> Option<TSolid> {
        let crate::convex_pair::Body::Cone { base, apex, r } = crate::convex_pair::as_cone(c)? else { return None };
        let bs = crate::ball_box::as_box(bx)?;
        let mode = match (op, cone_first) {
            ("union", _) => Mode::Join,
            ("subtract", true) => Mode::CutCone,
            ("subtract", false) => Mode::CutBox,
            _ => return None,
        };
        csg_why(base, apex, r, &bs, mode).ok()
    };
    pick(a, b, true).or_else(|| pick(b, a, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ball_box::BoxSpec;
    use std::collections::BTreeMap;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 11) as f64) / (1u64 << 53) as f64
        }
        fn range(&mut self, a: f64, b: f64) -> f64 {
            a + (b - a) * self.next()
        }
    }

    fn spec(lo: [f64; 3], hi: [f64; 3], phi: f64) -> BoxSpec {
        let x = [phi.cos(), phi.sin(), 0.0];
        let z = [0.0, 0.0, 1.0];
        let y = cross(z, x);
        let c = add(add(scale(x, 0.5 * (lo[0] + hi[0])), scale(y, 0.5 * (lo[1] + hi[1]))), scale(z, 0.5 * (lo[2] + hi[2])));
        BoxSpec { c, axes: [x, y, z], half: [0.5 * (hi[0] - lo[0]), 0.5 * (hi[1] - lo[1]), 0.5 * (hi[2] - lo[2])] }
    }

    /// The solid's own checks, then the mesh: closed, the right size, inside the exact box.
    fn check(r: f64, h: f64, lo: [f64; 3], hi: [f64; 3], phi: f64, mode: Mode) -> Result<f64, String> {
        let bx = spec(lo, hi, phi);
        let solid = csg_why([0.0; 3], [0.0, 0.0, h], r, &bx, mode).map_err(|e| e.to_string())?;
        let exact = crate::build::solid_volume(&solid);
        let ov = overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi });
        let (vc, vb) = (PI * r * r * h / 3.0, (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]));
        let want = match mode {
            Mode::Join => vc + vb - ov,
            Mode::CutCone => vc - ov,
            Mode::CutBox => vb - ov,
        };
        if (exact - want).abs() > 3e-6 * vc.max(vb) {
            return Err(format!("WRONG exact {exact} oracle {want}"));
        }
        let defl = 0.002 * r.max(h);
        let mesh = crate::mesh::mesh_solid(&solid, defl).ok_or("WRONG no mesh".to_string())?;
        if !crate::mesh::mesh_is_closed(&mesh) {
            return Err("WRONG mesh open".to_string());
        }
        let (mut mv, mut area) = (0.0, 0.0);
        for t in mesh.indices.chunks(3) {
            let p = |i: u32| mesh.positions[i as usize];
            mv += dot(p(t[0]), cross(p(t[1]), p(t[2]))) / 6.0;
            area += 0.5 * len(cross(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0]))));
        }
        if (mv - exact).abs() > defl * area + 1e-6 * exact.max(1e-9) {
            return Err(format!("WRONG mesh volume {mv} exact {exact}"));
        }
        let bb = crate::build::solid_aabb(&solid);
        let (mut mlo, mut mhi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in &mesh.positions {
            for a in 0..3 {
                mlo[a] = mlo[a].min(p[a]);
                mhi[a] = mhi[a].max(p[a]);
            }
        }
        for a in 0..3 {
            if mlo[a] < bb.lo[a] - 1e-7 || mhi[a] > bb.hi[a] + 1e-7 || mlo[a] - bb.lo[a] > 3.0 * defl + 1e-7 || bb.hi[a] - mhi[a] > 3.0 * defl + 1e-7 {
                return Err(format!("WRONG box {bb:?} vs mesh {mlo:?} {mhi:?}"));
            }
        }
        Ok(exact)
    }

    fn random_box(rng: &mut Rng, r: f64, h: f64) -> ([f64; 3], [f64; 3]) {
        let (mut lo, mut hi) = ([0.0; 3], [0.0; 3]);
        for k in 0..2 {
            let (a, w) = (rng.range(-1.3, 1.0) * r, rng.range(0.2, 1.8) * r);
            lo[k] = a;
            hi[k] = a + w;
        }
        let (a, w) = (rng.range(-0.4, 1.0) * h, rng.range(0.15, 1.3) * h);
        lo[2] = a;
        hi[2] = a + w;
        (lo, hi)
    }

    /// The stop rule: over random cones and boxes, whatever builds is exact (volume against the independent integral, mesh closed and
    /// the right size, box inside the faceting's own), in all three operations; what refuses says why.
    #[test]
    fn random_joins_and_cuts_never_build_a_wrong_solid() {
        let mut rng = Rng(17);
        let mut built = [0usize; 3];
        let mut tried = [0usize; 3];
        let mut why: BTreeMap<String, usize> = BTreeMap::new();
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..1200 {
            let (r, h) = (rng.range(5.0, 15.0), rng.range(5.0, 25.0));
            let (lo, hi) = random_box(&mut rng, r, h);
            let phi = rng.range(0.0, TAU);
            // a box turned about the axis: the oracle wants its extents in its own frame, which `spec` keeps
            if overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi }) < 1e-3 * r * r * h {
                continue;
            }
            for (mi, mode) in [Mode::Join, Mode::CutCone, Mode::CutBox].into_iter().enumerate() {
                tried[mi] += 1;
                match check(r, h, lo, hi, if phi < 3.0 { 0.0 } else { phi }, mode) {
                    Ok(_) => built[mi] += 1,
                    Err(e) if e.starts_with("WRONG") => wrong.push(format!("{mode:?} {e}: r {r} h {h} lo {lo:?} hi {hi:?}")),
                    Err(e) => *why.entry(format!("{mode:?}: {e}")).or_insert(0) += 1,
                }
            }
        }
        eprintln!("cone x box join/cut: built {built:?} of {tried:?}; refused: {why:#?}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        for mi in 0..3 {
            assert!(built[mi] * 2 >= tried[mi], "mode {mi}: only {} of {} built", built[mi], tried[mi]);
        }
    }

    /// Boxes snapped to the values where a cone is awkward: whatever builds is exact, the rest refuses.
    #[test]
    fn snapped_boxes_never_build_a_wrong_join_or_cut() {
        let mut rng = Rng(9);
        let mut built = 0usize;
        let mut tried = 0usize;
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..1500 {
            let (r, h) = (10.0, 20.0);
            let pick_xy = |rng: &mut Rng| -> f64 {
                let z = [0.25, 0.5, 0.75][(rng.next() * 3.0) as usize % 3] * h;
                let opts = [0.0, r, -r, 0.5 * r, -0.5 * r, r * (1.0 - z / h), -r * (1.0 - z / h), 2.0 * r, -2.0 * r, 3.0, -3.0];
                opts[(rng.next() * opts.len() as f64) as usize % opts.len()]
            };
            let pick_z = |rng: &mut Rng| -> f64 {
                let opts = [0.0, h, -5.0, h + 5.0, 0.5 * h, 0.25 * h, 0.75 * h, 3.0, 17.0];
                opts[(rng.next() * opts.len() as f64) as usize % opts.len()]
            };
            let (mut lo, mut hi) = ([0.0; 3], [0.0; 3]);
            for k in 0..2 {
                let (a, b) = (pick_xy(&mut rng), pick_xy(&mut rng));
                lo[k] = a.min(b);
                hi[k] = a.max(b);
            }
            let (a, b) = (pick_z(&mut rng), pick_z(&mut rng));
            lo[2] = a.min(b);
            hi[2] = a.max(b);
            if (0..3).any(|k| hi[k] - lo[k] < 1e-3) {
                continue;
            }
            for mode in [Mode::Join, Mode::CutCone, Mode::CutBox] {
                tried += 1;
                match check(r, h, lo, hi, 0.0, mode) {
                    Ok(_) => built += 1,
                    Err(e) if e.starts_with("WRONG") => wrong.push(format!("{mode:?} {e}: lo {lo:?} hi {hi:?}")),
                    Err(_) => {}
                }
            }
        }
        eprintln!("snapped join/cut: built {built} of {tried}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        assert!(built > 0);
    }

    /// The same through the public boolean, the whole pair moved and turned: the frame is found from the solids.
    #[test]
    fn the_public_boolean_joins_and_cuts_a_moved_pair() {
        use crate::build::{box_solid, cone_solid, solid_volume, transform_solid};
        let mut rng = Rng(29);
        let (mut built, mut tried) = (0, 0);
        for _ in 0..50 {
            let (r, h) = (rng.range(5.0, 12.0), rng.range(6.0, 20.0));
            let size = [rng.range(0.4, 2.2) * r, rng.range(0.4, 2.2) * r, rng.range(0.2, 1.4) * h];
            let ctr = [rng.range(-0.6, 0.6) * r, rng.range(-0.6, 0.6) * r, rng.range(0.0, 1.0) * h];
            let lo = [ctr[0] - size[0] / 2.0, ctr[1] - size[1] / 2.0, ctr[2] - size[2] / 2.0];
            let hi = [ctr[0] + size[0] / 2.0, ctr[1] + size[1] / 2.0, ctr[2] + size[2] / 2.0];
            let ov = overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi });
            if ov < 1e-3 * r * r * h {
                continue;
            }
            let (vc, vb) = (PI * r * r * h / 3.0, size[0] * size[1] * size[2]);
            let cone = cone_solid([0.0, 0.0, h / 2.0], r, h, [0.0, 0.0, 1.0]);
            let bx = box_solid(size, ctr, None);
            let axis = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t = Transform::translation([rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)]).then(&Transform::rotation(axis, rng.range(0.0, TAU)));
            let (ca, ba) = (transform_solid(&cone, &t), transform_solid(&bx, &t));
            tried += 1;
            for (op, a, b, truth) in [("union", &ca, &ba, vc + vb - ov), ("union", &ba, &ca, vc + vb - ov), ("subtract", &ca, &ba, vc - ov), ("subtract", &ba, &ca, vb - ov)] {
                if let Some(res) = crate::ops::boolean(op, a, b) {
                    let got = solid_volume(&res);
                    assert!((got - truth).abs() <= 3e-6 * vc.max(vb), "{op} of a moved pair: {got} vs {truth} (r {r} h {h} lo {lo:?} hi {hi:?})");
                    built += 1;
                }
            }
        }
        eprintln!("public boolean join/cut: {built} built over {tried} moved pairs");
        assert!(built >= 2 * tried, "built {built} over {tried} pairs");
    }
}
