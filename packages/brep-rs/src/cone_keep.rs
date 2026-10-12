//! `cone AND box` as an exact solid (W3 S1, SPEC-brep-cone-booleans.md), for a box with a face square to the cone's axis.
//!
//! Frame: the cone's base centre is the origin, its axis is +z, the base has radius `r` and the apex is at height `h`. Every box plane
//! is then square to the axis (it cuts the cone in a circle) or parallel to it (a hyperbola, or two generators when it holds the axis).
//!
//! The solid is convex, and its faces are:
//!
//! * the box's z-faces (and the cone's base where the box reaches below it): a rectangle meeting a disk, which `ball_box.rs` already
//!   builds exactly;
//! * the box's vertical faces: a rectangle meeting the region under a hyperbola, built here;
//! * the cone's slanted face: whatever edges the plane faces use ONCE. Nothing else touches them, so they are exactly where the
//!   cone surface is cut, and the cone face is the region those loops bound (`Cone::bounded`). It is never described on its own, so it
//!   cannot disagree with the faces next to it.
//!
//! What stands behind the answer: every edge handle used twice, one lump, the divergence-theorem volume against an independent
//! integral of exact cross-section areas (`cone_box::overlap_volume`), origin-free volume and a closed mesh.

use crate::ball_box::{box_halves, circle_of, inside_piece, lump_count, planar_face, BoxSpec, Item, Piece};
use crate::build::{TFace, TSolid};
use crate::cone_box::{overlap_volume, AlignedBox, ConeSpec};
use crate::geom::{Cone, Curve, Plane, Surface};
use crate::math::{add, cross, dot, len, normalize, scale, sub, Transform, Vec3};
use crate::topo::{self, EdgeUse, Pcurve, Shell, Solid, Wire};
use std::cell::RefCell;
use std::f64::consts::{PI, TAU};
use std::rc::Rc;

/// One piece of a vertical face's loop, in the canonical frame.
enum VItem {
    Seg(Vec3, Vec3),
    Hyp { from: Vec3, to: Vec3, curve: Curve },
}

fn reversed(items: Vec<VItem>) -> Vec<VItem> {
    items
        .into_iter()
        .rev()
        .map(|it| match it {
            VItem::Seg(a, b) => VItem::Seg(b, a),
            VItem::Hyp { from, to, curve: Curve::Hyperbola { c, p, q, s0, s1 } } => VItem::Hyp { from: to, to: from, curve: Curve::Hyperbola { c, p, q, s0: s1, s1: s0 } },
            other => other,
        })
        .collect()
}

/// The loop of the part of the vertical box face at `pos` along axis `k` (0: x, 1: y) that lies inside the cone: the rectangle
/// `[a_lo, a_hi] x [z0, z1]` (`a` is the other horizontal coordinate) meeting the region under the cone's hyperbola, traversed
/// counter-clockwise in `(a, z)`. `Ok(None)`: no area. `Err`: a degenerate contact the construction does not handle.
fn vertical_loop(c: &ConeSpec, k: usize, pos: f64, a_lo: f64, a_hi: f64, z0: f64, z1: f64) -> Result<Option<Vec<VItem>>, &'static str> {
    let scale_len = c.r.max(c.h);
    let tiny = 1e-9 * scale_len;
    let d = pos.abs();
    let w0 = c.w(z0);
    // a plane that only touches the cone's widest circle at a point (a box exactly as wide as the base) leaves no face
    if w0 - d < 1e-9 * scale_len {
        return Ok(None);
    }
    if w0 - d < 1e-7 * scale_len {
        return Err("a box face is nearly tangent to the cone");
    }
    let ac = (w0 * w0 - d * d).sqrt();
    let (ma, mb) = (a_lo.max(-ac), a_hi.min(ac));
    if mb - ma <= tiny {
        return Ok(None);
    }
    if mb - ma < 1e-6 * scale_len {
        return Err("a box face leaves a sliver of the cone");
    }
    let wt = c.w(z1);
    let has_top = wt > d;
    if has_top && wt - d < 1e-7 * scale_len {
        return Err("a box face is nearly tangent to the cone's top circle");
    }
    let at = if has_top { (wt * wt - d * d).sqrt() } else { 0.0 };
    let straight = d < 1e-9 * scale_len;
    let zh = |a: f64| c.h * (1.0 - (d * d + a * a).sqrt() / c.r);
    let p3 = |a: f64, z: f64| if k == 0 { [pos, a, z] } else { [a, pos, z] };
    let hyp = |from: f64, to: f64| -> VItem {
        let (pa, pb) = (p3(from, zh(from)), p3(to, zh(to)));
        if straight {
            return VItem::Seg(pa, pb);
        }
        let (cc, p, q) = if k == 0 {
            ([pos, 0.0, c.h], [0.0, 0.0, -c.h * d / c.r], [0.0, d, 0.0])
        } else {
            ([0.0, pos, c.h], [0.0, 0.0, -c.h * d / c.r], [d, 0.0, 0.0])
        };
        VItem::Hyp { from: pa, to: pb, curve: Curve::Hyperbola { c: cc, p, q, s0: (from / d).asinh(), s1: (to / d).asinh() } }
    };
    let zt = |a: f64| if has_top { z1.min(zh(a)) } else { zh(a) };
    let mut items: Vec<VItem> = Vec::new();
    // the bottom, left to right
    items.push(VItem::Seg(p3(ma, z0), p3(mb, z0)));
    // the right wall, where the box (not the hyperbola) bounds the face
    if mb < ac - tiny {
        items.push(VItem::Seg(p3(mb, z0), p3(mb, zt(mb))));
    }
    // the top, right to left: the cone's hyperbola, with the box's top level where the hyperbola climbs above it
    let mut cuts: Vec<f64> = vec![mb];
    let mut inner: Vec<f64> = Vec::new();
    if has_top {
        inner.push(at);
        inner.push(-at);
    }
    if straight {
        inner.push(0.0);
    }
    inner.sort_by(|a, b| b.total_cmp(a));
    for x in inner {
        if x < mb - tiny && x > ma + tiny {
            cuts.push(x);
        }
    }
    cuts.push(ma);
    for w in cuts.windows(2) {
        let (hi, lo) = (w[0], w[1]);
        let mid = 0.5 * (hi + lo);
        if has_top && mid.abs() <= at {
            items.push(VItem::Seg(p3(hi, z1), p3(lo, z1)));
        } else {
            items.push(hyp(hi, lo));
        }
    }
    // the left wall
    if ma > -ac + tiny {
        items.push(VItem::Seg(p3(ma, zt(ma)), p3(ma, z0)));
    }
    Ok(Some(items))
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

fn vertical_face(items: Vec<VItem>, normal: Vec3, scale_len: f64) -> Option<TFace> {
    let mut pts: Vec<Vec3> = Vec::new();
    for it in &items {
        match it {
            VItem::Seg(a, b) => pts.extend([*a, *b]),
            VItem::Hyp { from, to, .. } => pts.extend([*from, *to]),
        }
    }
    let o = scale(pts.iter().fold([0.0; 3], |s, p| add(s, *p)), 1.0 / pts.len() as f64);
    let plane = Plane::new(o, normal);
    let mut pool = Pool(Vec::new(), 1e-9 * scale_len);
    let mut uses = Vec::new();
    for it in &items {
        let (va, vb, curve) = match it {
            VItem::Seg(a, b) => (pool.at(*a), pool.at(*b), Curve::Segment { a: *a, b: *b }),
            VItem::Hyp { from, to, curve } => (pool.at(*from), pool.at(*to), curve.clone()),
        };
        let (pa, pb) = (va.borrow().point, vb.borrow().point);
        let mid = curve.point_at(0.5);
        uses.push(EdgeUse { edge: topo::edge(va, vb, true, curve), forward: true, pcurve: Pcurve { start: plane.project(pa), end: plane.project(pb), mid: plane.project(mid) } });
    }
    if len(sub(uses.last()?.edge.borrow().b.borrow().point, uses.first()?.edge.borrow().a.borrow().point)) > 1e-7 * scale_len {
        return None;
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for u in &uses {
        for q in [u.pcurve.start, u.pcurve.end, u.pcurve.mid] {
            for i in 0..2 {
                lo[i] = lo[i].min(q[i]);
                hi[i] = hi[i].max(q[i]);
            }
        }
    }
    Some(crate::build::make_face(Surface::Plane(plane), [[lo[0], hi[0]], [lo[1], hi[1]]], uses))
}

fn ptr_eq(a: &topo::VertexRef, b: &topo::VertexRef) -> bool {
    Rc::ptr_eq(a, b)
}

/// One edge the plane faces use once: it is on the cone. `fwd` is the direction the plane face uses it, so the cone's use is the opposite.
struct Rim {
    edge: topo::EdgeRef<Curve>,
    fwd: bool,
}

impl Rim {
    /// The vertices the CONE face's use runs from and to.
    fn cone_ends(&self) -> (topo::VertexRef, topo::VertexRef) {
        let e = self.edge.borrow();
        if self.fwd {
            (e.b.clone(), e.a.clone())
        } else {
            (e.a.clone(), e.b.clone())
        }
    }
}

/// `cone AND box`. `base`, `apex`, `r`: the cone. `None` when the pair is not a clean crossing the construction can vouch for.
pub fn keep(base: Vec3, apex: Vec3, r: f64, bx: &BoxSpec) -> Option<TSolid> {
    keep_why(base, apex, r, bx).ok()
}

/// `keep`, with the reason it gave up.
pub fn keep_why(base: Vec3, apex: Vec3, r: f64, bx: &BoxSpec) -> Result<TSolid, &'static str> {
    assemble(base, apex, r, bx, true)
}

fn assemble(base: Vec3, apex: Vec3, r: f64, bx: &BoxSpec, verify_mesh: bool) -> Result<TSolid, &'static str> {
    let h = len(sub(apex, base));
    if h < 1e-9 || r < 1e-9 {
        return Err("degenerate cone");
    }
    let z = scale(sub(apex, base), 1.0 / h);
    // a box with one axis along the cone's
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
    let cone = ConeSpec { r, h };
    let scale_len = r.max(h);
    let (z0, z1) = (lo[2].max(0.0), hi[2].min(h));
    if z1 - z0 <= 1e-7 * scale_len {
        return Err("the box misses the cone's height");
    }
    let id = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut faces: Vec<TFace> = Vec::new();
    // z-faces: the box's bottom (or the cone's base, where the box reaches below it) and the box's top (none when it holds the apex)
    let mut zface = |level: f64, up: bool, bz: [f64; 2]| -> Result<(), &'static str> {
        let rr = cone.w(level);
        if rr < 1e-7 * scale_len {
            return Ok(());
        }
        let o = [0.0, 0.0, level];
        let b = BoxSpec { c: [ctr[0], ctr[1], 0.5 * (bz[0] + bz[1]) - level], axes: id, half: [half[0], half[1], 0.5 * (bz[1] - bz[0])] };
        let halves = box_halves(b.c, b.axes, b.half);
        let i = if up { 4 } else { 5 };
        // the whole circle, when the rectangle holds it or only touches it (a box exactly as wide as the circle)
        let tol = 1e-9 * scale_len;
        let holds = b.c[0] - b.half[0] <= -rr + tol && b.c[0] + b.half[0] >= rr - tol && b.c[1] - b.half[1] <= -rr + tol && b.c[1] + b.half[1] >= rr - tol;
        let items = if holds {
            let ci = circle_of(&halves[i], rr).ok_or("a circle would not build")?;
            Some(vec![Item::Circle(ci.at(0.0), true)])
        } else {
            inside_piece(rr, &halves, &b, i)?
        };
        if let Some(items) = items {
            faces.push(planar_face(rr, &halves, i, &Piece { outer: items, hole: None }, o, false).ok_or("a flat face would not build")?);
        }
        Ok(())
    };
    // the bottom face sits at z0: a box face when lo_z >= 0, else the cone's own base
    if lo[2] >= 0.0 {
        zface(z0, false, [lo[2], hi[2]])?;
    } else {
        zface(0.0, false, [0.0, 1.0])?;
    }
    if hi[2] < h - 1e-9 * scale_len {
        zface(z1, true, [lo[2], hi[2]])?;
    }
    // vertical faces
    for (axis, pos, sigma) in [(0usize, lo[0], -1.0), (0, hi[0], 1.0), (1, lo[1], -1.0), (1, hi[1], 1.0)] {
        let (a_lo, a_hi) = if axis == 0 { (lo[1], hi[1]) } else { (lo[0], hi[0]) };
        let Some(items) = vertical_loop(&cone, axis, pos, a_lo, a_hi, z0, z1)? else { continue };
        // counter-clockwise in (a, z) is counter-clockwise about +x for an x-face and about -y for a y-face
        let ccw_normal_sign = if axis == 0 { 1.0 } else { -1.0 };
        let items = if sigma * ccw_normal_sign > 0.0 { items } else { reversed(items) };
        let normal = if axis == 0 { [sigma, 0.0, 0.0] } else { [0.0, sigma, 0.0] };
        faces.push(vertical_face(items, normal, scale_len).ok_or("a vertical face would not close")?);
    }
    if faces.is_empty() {
        return Err("no face");
    }
    crate::ops::drop_degenerate_faces(&mut faces);
    crate::ops::split_t_junctions(&mut faces);
    crate::ops::weld_shared_edges(&mut faces);
    // the edges used once are the cone's rim; every other edge must be shared by exactly two
    let counts = crate::ops::edge_use_counts(&faces);
    if counts.values().any(|&n| n > 2) {
        return Err("an edge used more than twice");
    }
    let mut rims: Vec<Rim> = Vec::new();
    for f in &faces {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                let key = Rc::as_ptr(&u.edge) as *const () as usize;
                if counts.get(&key) == Some(&1) {
                    rims.push(Rim { edge: u.edge.clone(), fwd: u.forward });
                }
            }
        }
    }
    if rims.is_empty() {
        return Err("no rim on the cone");
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
        while !ptr_eq(&at, &start) {
            let next: Vec<usize> = (0..rims.len()).filter(|&j| !taken[j] && ptr_eq(&rims[j].cone_ends().0, &at)).collect();
            if next.len() != 1 {
                return Err("the rim does not chain into loops");
            }
            taken[next[0]] = true;
            lp.push(next[0]);
            at = rims[next[0]].cone_ends().1;
        }
        loops.push(lp);
    }
    // a loop that goes once round the axis, as opposed to one that only sweeps part of the way
    let apex_p = [0.0, 0.0, h];
    let encircles = |lp: &Vec<usize>| -> bool {
        let mut total = 0.0;
        let mut prev: Option<f64> = None;
        for &i in lp {
            let e = rims[i].edge.borrow();
            // along the cone face's own use: the plane face ran this edge with its curve when `fwd`, so the cone's use runs against it
            let mut pts = crate::mesh::curve_points(&e.curve, 1e-3 * scale_len);
            if rims[i].fwd {
                pts.reverse();
            }
            for p in pts {
                if len(sub(p, apex_p)) < 1e-9 * scale_len {
                    return false;
                }
                if p[0].hypot(p[1]) < 1e-9 * scale_len {
                    continue;
                }
                let a = p[1].atan2(p[0]);
                if let Some(q) = prev {
                    let mut d = a - q;
                    while d > PI {
                        d -= TAU;
                    }
                    while d < -PI {
                        d += TAU;
                    }
                    total += d;
                }
                prev = Some(a);
            }
        }
        total.abs() > PI
    };
    let ring: Vec<usize> = (0..loops.len()).filter(|&i| encircles(&loops[i])).collect();
    if ring.len() > 2 {
        return Err("more than two rings round the axis");
    }
    let mut groups: Vec<Vec<usize>> = Vec::new();
    if !ring.is_empty() {
        groups.push(ring.clone());
    }
    for i in 0..loops.len() {
        if !ring.contains(&i) {
            groups.push(vec![i]);
        }
    }
    let slant = (r * r + h * h).sqrt();
    let surface = Surface::Cone(Cone { base: [0.0; 3], axis: [0.0, 0.0, 1.0], e1: [1.0, 0.0, 0.0], e2: [0.0, 1.0, 0.0], base_radius: r, half_angle: r.atan2(h), slant, v_range: [0.0, slant], bounded: true, u_range: [0.0, std::f64::consts::TAU] });
    for g in &groups {
        let wires: Vec<_> = g
            .iter()
            .map(|&li| {
                let uses: Vec<EdgeUse<Curve>> = loops[li]
                    .iter()
                    .map(|&i| EdgeUse { edge: rims[i].edge.clone(), forward: !rims[i].fwd, pcurve: Pcurve { start: [0.0; 2], end: [0.0; 2], mid: [0.0; 2] } })
                    .collect();
                Rc::new(RefCell::new(Wire { edges: uses }))
            })
            .collect();
        faces.push(Rc::new(RefCell::new(topo::Face { boundary: wires, forward: true, surface: surface.clone(), uv_domain: [[0.0, TAU], [0.0, slant]] })));
    }
    if crate::ops::edge_use_counts(&faces).values().any(|&n| n != 2) {
        return Err("the shell is not closed");
    }
    if lump_count(&faces, false) != 1 {
        return Err("more than one lump");
    }
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    let v_cone = PI * r * r * h / 3.0;
    let want = overlap_volume(&cone, &AlignedBox { lo, hi });
    let got = crate::build::solid_volume(&solid);
    if !got.is_finite() || (got - want).abs() > 2e-6 * v_cone {
        return Err("the volume disagrees with the independent integral");
    }
    if !crate::ops::volume_is_translation_invariant(&solid) {
        return Err("the volume depends on the origin");
    }
    if verify_mesh && !crate::ops::mesh_is_closed_coarse(&solid) {
        return Err("the mesh is not closed");
    }
    // into the world: x, y, z are the columns of the rotation
    let t = Transform { m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]], t: base };
    let world = crate::build::transform_solid(&solid, &t);
    let moved = crate::build::solid_volume(&world);
    if (moved - got).abs() > 1e-9 * v_cone {
        return Err("moving it into place changed its volume");
    }
    Ok(world)
}

/// The boolean entry: a whole cone against a cuboid, in either order. Only `intersect` is built.
pub fn cone_box_boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "intersect" {
        return None;
    }
    let pick = |c: &TSolid, bx: &TSolid| -> Option<TSolid> {
        let crate::convex_pair::Body::Cone { base, apex, r } = crate::convex_pair::as_cone(c)? else { return None };
        keep(base, apex, r, &crate::ball_box::as_box(bx)?)
    };
    pick(a, b).or_else(|| pick(b, a))
}

#[cfg(test)]
mod tests {
    use super::*;
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

    /// A box with one axis along z, turned `phi` about z, from its extents in its own frame; `k` says which of its axes is z.
    fn spec(lo: [f64; 3], hi: [f64; 3], phi: f64, k: usize) -> BoxSpec {
        let x = [phi.cos(), phi.sin(), 0.0];
        let z = [0.0, 0.0, 1.0];
        let y = cross(z, x);
        let local = [x, y, z];
        let c = add(add(scale(x, 0.5 * (lo[0] + hi[0])), scale(y, 0.5 * (lo[1] + hi[1]))), scale(z, 0.5 * (lo[2] + hi[2])));
        let hf = [0.5 * (hi[0] - lo[0]), 0.5 * (hi[1] - lo[1]), 0.5 * (hi[2] - lo[2])];
        // right-handed axes with z in slot k: (x, y, z) cycled
        let (axes, half) = match k {
            0 => ([z, x, y], [hf[2], hf[0], hf[1]]),
            1 => ([y, z, x], [hf[1], hf[2], hf[0]]),
            _ => (local, hf),
        };
        BoxSpec { c, axes, half }
    }

    /// The cone, the box and the solid's own checks, then the mesh: closed, and its volume close to the exact one.
    fn check(r: f64, h: f64, lo: [f64; 3], hi: [f64; 3], phi: f64, k: usize) -> Result<f64, String> {
        let bx = spec(lo, hi, phi, k);
        let solid = keep_why([0.0; 3], [0.0, 0.0, h], r, &bx).map_err(|e| e.to_string())?;
        let exact = crate::build::solid_volume(&solid);
        // box extents in the box's own frame are what the oracle wants; the oracle has x and y square to z
        let want = overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi });
        if (exact - want).abs() > 3e-6 * PI * r * r * h / 3.0 {
            return Err(format!("WRONG exact {exact} oracle {want}"));
        }
        let defl = 0.002 * r.max(h);
        let mesh = crate::mesh::mesh_solid(&solid, defl).ok_or("WRONG no mesh".to_string())?;
        if !crate::mesh::mesh_is_closed(&mesh) {
            return Err("WRONG mesh open".to_string());
        }
        let mv: f64 = mesh
            .indices
            .chunks(3)
            .map(|t| {
                let p = |i: u32| mesh.positions[i as usize];
                dot(p(t[0]), cross(p(t[1]), p(t[2]))) / 6.0
            })
            .sum();
        // a chord of the faceting cuts off at most `defl` of the surface, so the mesh is short by at most `defl` times its area
        let area: f64 = mesh
            .indices
            .chunks(3)
            .map(|t| {
                let p = |i: u32| mesh.positions[i as usize];
                0.5 * len(cross(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0]))))
            })
            .sum();
        if (mv - exact).abs() > defl * area + 1e-6 * exact.max(1e-9) {
            return Err(format!("WRONG mesh volume {mv} exact {exact}"));
        }
        // the faces' exact box holds every mesh vertex and is not looser than the faceting's own sag
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

    #[test]
    fn the_hyperbola_lies_on_the_cone_and_on_its_plane() {
        let (r, h, d) = (10.0, 20.0, 3.0);
        let c = Curve::Hyperbola { c: [d, 0.0, h], p: [0.0, 0.0, -h * d / r], q: [0.0, d, 0.0], s0: -0.7, s1: 1.1 };
        for i in 0..=20 {
            let p = c.point_at(i as f64 / 20.0);
            assert!((p[0] - d).abs() < 1e-12);
            let rho = p[0].hypot(p[1]);
            assert!((rho - r * (1.0 - p[2] / h)).abs() < 1e-9, "off the cone at {p:?}");
        }
        // length against a fine polyline, derivative against a difference, box against samples
        let n = 20000;
        let poly: f64 = (0..n).map(|i| len(sub(c.point_at((i + 1) as f64 / n as f64), c.point_at(i as f64 / n as f64)))).sum();
        assert!((poly - c.length()).abs() < 1e-6 * poly, "{poly} vs {}", c.length());
        let t = 0.37;
        let fd = scale(sub(c.point_at(t + 1e-6), c.point_at(t - 1e-6)), 0.5e6);
        assert!(len(sub(fd, c.derivative_at(t))) < 1e-5);
        let b = c.aabb();
        for i in 0..=2000 {
            let p = c.point_at(i as f64 / 2000.0);
            for a in 0..3 {
                assert!(p[a] >= b.lo[a] - 1e-12 && p[a] <= b.hi[a] + 1e-12);
            }
        }
        let b2 = c.transform(&Transform::translation([1.0, 2.0, 3.0]));
        assert!(len(sub(b2.point_at(0.5), add(c.point_at(0.5), [1.0, 2.0, 3.0]))) < 1e-12);
    }

    #[test]
    fn the_hand_picked_crossings_build_exactly() {
        let (r, h) = (10.0, 20.0);
        // a slab through the cone: a frustum, two rings round the axis
        let r_ = check(r, h, [-30.0, -30.0, 3.0], [30.0, 30.0, 13.0], 0.0, 2); assert!(r_.is_ok(), "{:?}", r_);
        // a box off to one side: a hyperbola face, the base cap and the top
        let r_ = check(r, h, [2.0, -30.0, -5.0], [30.0, 30.0, 30.0], 0.0, 2); assert!(r_.is_ok(), "{:?}", r_);
        // a quarter holding the axis: the apex on the boundary
        let r_ = check(r, h, [0.0, 0.0, -5.0], [5.0, 5.0, 30.0], 0.0, 2); assert!(r_.is_ok(), "{:?}", r_);
        // a thin slab through the axis, cut below the apex
        let r_ = check(r, h, [-1.0, -30.0, -2.0], [1.0, 30.0, 12.0], 0.0, 2); assert!(r_.is_ok(), "{:?}", r_);
        // the apex inside the box, the base cut
        let r_ = check(r, h, [-3.0, -4.0, 2.0], [5.0, 4.0, 30.0], 0.0, 2); assert!(r_.is_ok(), "{:?}", r_);
        // turned about the axis
        let r_ = check(r, h, [-3.0, -4.0, 2.0], [5.0, 4.0, 30.0], 0.6, 1); assert!(r_.is_ok(), "{:?}", r_);
    }

    /// The stop rule: over random cones and boxes with a face square to the axis, whatever builds is exact (volume against the
    /// independent integral, mesh closed and the right size), and how much of the family builds is reported.
    #[test]
    fn random_crossings_never_build_a_wrong_solid() {
        let mut rng = Rng(11);
        let (mut built, mut tried) = (0usize, 0usize);
        let mut why: BTreeMap<String, usize> = BTreeMap::new();
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..1500 {
            let (r, h) = (rng.range(5.0, 15.0), rng.range(5.0, 25.0));
            let (mut lo, mut hi) = ([0.0; 3], [0.0; 3]);
            for k in 0..2 {
                let (a, w) = (rng.range(-1.3, 1.0) * r, rng.range(0.2, 1.6) * r);
                lo[k] = a;
                hi[k] = a + w;
            }
            let (a, w) = (rng.range(-0.3, 1.0) * h, rng.range(0.15, 1.2) * h);
            lo[2] = a;
            hi[2] = a + w;
            if overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi }) < 1e-3 * r * r * h {
                continue;
            }
            tried += 1;
            match check(r, h, lo, hi, rng.range(0.0, TAU), (rng.next() * 3.0) as usize % 3) {
                Ok(_) => built += 1,
                Err(e) if e.starts_with("WRONG") => wrong.push(format!("{e}: r {r} h {h} lo {lo:?} hi {hi:?}")),
                Err(e) => *why.entry(e).or_insert(0) += 1,
            }
        }
        eprintln!("cone x box keep: built {built} of {tried}; refused: {why:?}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        assert!(built * 10 >= tried * 7, "only {built} of {tried} built: {why:?}");
    }

    /// The same crossings through the public boolean, with the whole pair moved and turned: the cone and the box are read back from
    /// solids, the frame is found from them, and the answer does not depend on where the pair sits.
    #[test]
    fn the_public_boolean_reads_a_moved_pair_and_agrees_with_the_oracle() {
        use crate::build::{box_solid, cone_solid, solid_volume, transform_solid};
        let mut rng = Rng(23);
        let (mut built, mut tried) = (0, 0);
        for _ in 0..60 {
            let (r, h) = (rng.range(5.0, 12.0), rng.range(6.0, 20.0));
            let size = [rng.range(0.4, 2.2) * r, rng.range(0.4, 2.2) * r, rng.range(0.2, 1.4) * h];
            let ctr = [rng.range(-0.6, 0.6) * r, rng.range(-0.6, 0.6) * r, rng.range(0.0, 1.0) * h];
            let lo = [ctr[0] - size[0] / 2.0, ctr[1] - size[1] / 2.0, ctr[2] - size[2] / 2.0];
            let hi = [ctr[0] + size[0] / 2.0, ctr[1] + size[1] / 2.0, ctr[2] + size[2] / 2.0];
            let want = overlap_volume(&ConeSpec { r, h }, &AlignedBox { lo, hi });
            if want < 1e-3 * r * r * h {
                continue;
            }
            let cone = cone_solid([0.0, 0.0, h / 2.0], r, h, [0.0, 0.0, 1.0]);
            let bx = box_solid(size, ctr, None);
            let axis = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t = Transform::translation([rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)]).then(&Transform::rotation(axis, rng.range(0.0, TAU)));
            let (ca, ba) = (transform_solid(&cone, &t), transform_solid(&bx, &t));
            tried += 1;
            for (a, b) in [(&ca, &ba), (&ba, &ca)] {
                if let Some(res) = crate::ops::boolean("intersect", a, b) {
                    let got = solid_volume(&res);
                    assert!((got - want).abs() <= 3e-6 * PI * r * r * h / 3.0, "moved pair: {got} vs {want} (r {r} h {h} lo {lo:?} hi {hi:?})");
                    built += 1;
                }
            }
            // the other operations are not built here, and must not come back as the wrong thing
            for op in ["union", "subtract"] {
                if let Some(res) = crate::ops::boolean(op, &ca, &ba) {
                    let v = solid_volume(&res);
                    let (vc, vb) = (solid_volume(&ca), solid_volume(&ba));
                    let truth = if op == "union" { vc + vb - want } else { vc - want };
                    assert!((v - truth).abs() <= 1e-4 * vc.max(vb), "{op} came back {v}, truth {truth}");
                }
            }
        }
        eprintln!("public boolean: {built} built over {tried} moved pairs");
        assert!(built >= tried, "built {built} of {tried} pairs, two orders each");
    }

    /// Boxes whose planes sit at the values where a cone is awkward (the axis, the base circle's edge, a circle's half, the apex's level,
    /// where a hyperbola's vertex meets a box edge): whatever builds is exact, and the rest refuses.
    #[test]
    fn snapped_boxes_never_build_a_wrong_solid() {
        let mut rng = Rng(5);
        let (mut built, mut tried) = (0usize, 0usize);
        let mut why: BTreeMap<String, usize> = BTreeMap::new();
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..3000 {
            let (r, h) = (10.0, 20.0);
            let cone = ConeSpec { r, h };
            let pick_xy = |rng: &mut Rng| -> f64 {
                let z = [0.25, 0.5, 0.75][(rng.next() * 3.0) as usize % 3] * h;
                let opts = [0.0, r, -r, 0.5 * r, -0.5 * r, cone.w(z), -cone.w(z), 2.0 * r, -2.0 * r, 3.0, -3.0];
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
            tried += 1;
            match check(r, h, lo, hi, 0.0, 2) {
                Ok(_) => built += 1,
                Err(e) if e.starts_with("WRONG") => wrong.push(format!("{e}: lo {lo:?} hi {hi:?}")),
                Err(e) => *why.entry(e).or_insert(0) += 1,
            }
        }
        eprintln!("snapped boxes: built {built} of {tried}; refused: {why:?}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        assert!(built > 0);
    }
}
