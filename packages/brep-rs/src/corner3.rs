//! SLICE A1: chamfers that meet at ONE convex corner of a planar solid.
//!
//! A convex planar solid is the intersection of the half-spaces of its faces, and a chamfer of one of its
//! straight edges is one more half-space (the bevel plane, `size` in from the edge along both faces). That is
//! exact on a convex part whatever the angle between the faces, which the wedge-and-subtract path is not at an
//! end that is not square (a bevel already there, an obtuse corner). `halfspace_chamfer` is that cut.
//!
//! Three equal chamfers meeting at ONE corner are one more thing. FreeCAD (26.3.0 RC1) builds a single pick of
//! the three edges as the half-space solid cut once more by ONE planar "corner patch" that removes the tip of
//! the three-plane apex. At a prism corner (a cap face square to the two sides) with corner angle `theta`:
//!
//! * `69.38 < theta < 110.555` degrees: the patch plane goes through the three points where the edges leaving
//!   the apex reach the part's own faces (a triangle at a right angle);
//! * `theta > 110.555`: it goes through the four strip end points (each strip ends squarely at distance `d` from
//!   the corner along its own edge; they are coplanar at any angle) and the side holding the corner goes;
//! * `theta < 69.38`: FreeCAD closes the corner with a B-spline patch. brep-rs builds none and refuses.
//!
//! Every face of a built result is a plane: the part's faces + the bevels + one patch per corner of three.
//!
//! (Three SEPARATE chamfer features chained one after another build the plain half-space solid in FreeCAD, with
//! no patch; a document cannot tell the two apart, and a run of equal chamfers is one pick everywhere else in
//! the kernel -- `rim_runs` -- so the run is read as one pick here.)
//!
//! `run_chamfer` builds a whole run from the part it started on, so the order the edges came in cannot matter.
//! It refuses (`RunFail`), measured against FreeCAD, what FreeCAD refuses or builds in a way brep-rs cannot
//! match: two opposite faces within twice the size of each other, bevels overlapping on a face without meeting
//! at a corner, a bevel reaching past the faces beside its edge, and two edges meeting at a corner a hair off
//! square where FreeCAD's solid is not the union of the two cuts. Everything is built as a convex polytope and
//! refused unless the result gains exactly the faces it should, every edge is used twice and the volume only
//! went down.
use crate::build::{self, TFace, TSolid};
use crate::geom::Surface;
use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use crate::topo;

type Half = (Vec3, f64);

fn same_edge_use(a: &TFace, b: &TFace) -> bool {
    let ea: Vec<_> = a.borrow().boundary.iter().flat_map(|w| w.borrow().edges.iter().map(|u| u.edge.clone()).collect::<Vec<_>>()).collect();
    let fb = b.borrow();
    fb.boundary.iter().any(|w| w.borrow().edges.iter().any(|u| ea.iter().any(|e| topo::same(e, &u.edge))))
}

fn touches(face: &TFace, v: &topo::VertexRef) -> bool {
    face.borrow().boundary.iter().any(|w| {
        w.borrow().edges.iter().any(|u| {
            let e = u.edge.borrow();
            std::rc::Rc::ptr_eq(&e.a, v) || std::rc::Rc::ptr_eq(&e.b, v)
        })
    })
}

fn solve3(a: [Vec3; 3], b: [f64; 3]) -> Option<Vec3> {
    // Cramer's rule on the rows a[i] . x = b[i].
    let det = dot(a[0], cross(a[1], a[2]));
    if det.abs() < 1e-9 {
        return None;
    }
    let x = add(add(scale(cross(a[1], a[2]), b[0]), scale(cross(a[2], a[0]), b[1])), scale(cross(a[0], a[1]), b[2]));
    Some(scale(x, 1.0 / det))
}

/// For the edge between planes `na` and `nb` at a corner whose third plane is `nc`: the direction `t` of the
/// edge leaving the corner, and the in-face unit directions (perpendicular to `t`, into each face).
fn edge_frame(na: Vec3, nb: Vec3, nc: Vec3) -> Option<(Vec3, Vec3, Vec3)> {
    let mut t = normalize(cross(na, nb));
    if dot(nc, t).abs() < 1e-6 {
        return None;
    }
    if dot(nc, t) > 0.0 {
        t = scale(t, -1.0);
    }
    let mut ia = normalize(cross(na, t));
    if dot(ia, nb) > 0.0 {
        ia = scale(ia, -1.0);
    }
    let mut ib = normalize(cross(nb, t));
    if dot(ib, na) > 0.0 {
        ib = scale(ib, -1.0);
    }
    if dot(ia, nb) > -1e-9 || dot(ib, na) > -1e-9 {
        return None;
    }
    Some((t, ia, ib))
}

/// The bevel plane (outward normal, offset) through `p1` (on one face) and `p2` (on the other), along `t`; its
/// outward normal faces the edge at `c`.
fn plane_through(c: Vec3, t: Vec3, p1: Vec3, p2: Vec3) -> Option<Half> {
    let mut n = normalize(cross(t, sub(p2, p1)));
    if len(n) < 0.5 {
        return None;
    }
    if dot(n, sub(c, p1)) < 0.0 {
        n = scale(n, -1.0);
    }
    Some((n, dot(n, p1)))
}

fn bevel_plane(c: Vec3, d: f64, t: Vec3, ia: Vec3, ib: Vec3) -> Option<Half> {
    plane_through(c, t, add(c, scale(ia, d)), add(c, scale(ib, d)))
}

fn clip(poly: &[Vec3], n: Vec3, d: f64, eps: f64) -> Vec<Vec3> {
    let mut out: Vec<Vec3> = Vec::new();
    let m = poly.len();
    for i in 0..m {
        let (p, q) = (poly[i], poly[(i + 1) % m]);
        let (sp, sq) = (dot(n, p) - d, dot(n, q) - d);
        let (pin, qin) = (sp <= eps, sq <= eps);
        // a point within eps of the plane counts as on it, so a crossing is made only from strictly inside
        let cut = |s_in: f64, s_out: f64| add(p, scale(sub(q, p), s_in / (s_in - s_out)));
        if pin && qin {
            out.push(q);
        } else if pin && !qin {
            if sp < -eps {
                out.push(cut(sp, sq));
            }
        } else if !pin && qin {
            if sq < -eps {
                out.push(cut(sp, sq));
            }
            out.push(q);
        }
    }
    out
}

fn tidy(poly: Vec<Vec3>, tol: f64) -> Vec<Vec3> {
    let mut p: Vec<Vec3> = Vec::new();
    for v in poly {
        if p.last().map_or(true, |l| len(sub(*l, v)) > tol) {
            p.push(v);
        }
    }
    while p.len() > 1 && len(sub(p[0], p[p.len() - 1])) <= tol {
        p.pop();
    }
    // drop collinear middle points until none is left
    loop {
        let m = p.len();
        if m < 3 {
            break;
        }
        let mut dropped = false;
        for i in 0..m {
            let (a, b, c) = (p[(i + m - 1) % m], p[i], p[(i + 1) % m]);
            if len(cross(sub(b, a), sub(c, b))) <= 1e-9 * (1.0 + len(sub(b, a)) * len(sub(c, b))) {
                p.remove(i);
                dropped = true;
                break;
            }
        }
        if !dropped {
            break;
        }
    }
    p
}

/// A convex planar solid read as its half-spaces: (planes in face order, centroid, extent). `None` for a curved
/// face, several shells, or a part that is not convex.
fn read_convex(src: &TSolid) -> Option<(Vec<Half>, Vec3, f64)> {
    if src.shells.len() != 1 {
        return None;
    }
    let faces = src.faces();
    let verts: Vec<Vec3> = src.vertices().iter().map(|v| v.borrow().point).collect();
    if verts.len() < 4 {
        return None;
    }
    let centroid = scale(verts.iter().fold([0.0; 3], |s, v| add(s, *v)), 1.0 / verts.len() as f64);
    let extent = verts.iter().fold(0.0_f64, |m, v| m.max(len(sub(*v, centroid))));
    let mut halves: Vec<Half> = Vec::with_capacity(faces.len());
    for f in &faces {
        let b = f.borrow();
        let Surface::Plane(p) = &b.surface else { return None };
        let mut n = normalize(p.n);
        let mut d = dot(n, p.origin);
        if dot(n, centroid) > d {
            n = scale(n, -1.0);
            d = -d;
        }
        if verts.iter().any(|v| dot(n, *v) - d > 1e-7 * (1.0 + extent)) {
            return None;
        }
        halves.push((n, d));
    }
    Some((halves, centroid, extent))
}

/// The convex polytope of `planes`: one ring per plane (in plane order), each CCW seen from outside, or `None`
/// when any plane contributes no face of its own (it is redundant or only touches a vertex) -- then the caller
/// asked for a face that does not exist. The solid is checked closed (every edge used twice, Euler) before it is
/// returned, with the merged points and rings.
fn polytope(planes: &[Half], centre: Vec3, extent: f64, reach: f64) -> Option<(TSolid, Vec<Vec3>, Vec<(Vec3, Vec<usize>)>)> {
    let eps = 1e-9 * (1.0 + extent);
    let big = 4.0 * (extent + reach) + 1.0;
    let mut rings: Vec<(Vec3, Vec<Vec3>)> = Vec::new();
    for (i, (n, d)) in planes.iter().enumerate() {
        let u = if n[0].abs() < 0.9 { normalize(cross(*n, [1.0, 0.0, 0.0])) } else { normalize(cross(*n, [0.0, 1.0, 0.0])) };
        let v = cross(*n, u);
        let o = add(centre, scale(*n, *d - dot(*n, centre)));
        let corner = |a: f64, b: f64| add(o, add(scale(u, a * big), scale(v, b * big)));
        let mut poly = vec![corner(-1.0, -1.0), corner(1.0, -1.0), corner(1.0, 1.0), corner(-1.0, 1.0)];
        for (j, (m, e)) in planes.iter().enumerate() {
            if i == j {
                continue;
            }
            poly = clip(&poly, *m, *e, eps);
            if poly.len() < 3 {
                break;
            }
        }
        let poly = tidy(poly, 1e-8 * (1.0 + extent));
        if poly.len() < 3 {
            return None;
        }
        let acc = poly.iter().enumerate().fold([0.0; 3], |s, (k, p)| add(s, cross(*p, poly[(k + 1) % poly.len()])));
        if len(acc) * 0.5 <= 1e-9 * (1.0 + extent * extent) || dot(acc, *n) <= 0.0 {
            return None;
        }
        rings.push((*n, poly));
    }
    // merge coincident vertices across rings
    let mut points: Vec<Vec3> = Vec::new();
    let mut faces_out: Vec<(Vec3, Vec<usize>)> = Vec::new();
    let tol = 2e-8 * (1.0 + extent);
    for (n, poly) in &rings {
        let mut ring: Vec<usize> = Vec::new();
        for p in poly {
            let k = match points.iter().position(|q| len(sub(*q, *p)) <= tol) {
                Some(k) => k,
                None => {
                    points.push(*p);
                    points.len() - 1
                }
            };
            if ring.last() != Some(&k) {
                ring.push(k);
            }
        }
        if ring.len() > 1 && ring[0] == ring[ring.len() - 1] {
            ring.pop();
        }
        if ring.len() < 3 {
            return None;
        }
        faces_out.push((*n, ring));
    }
    // closed: every edge used by exactly two faces, and Euler's V - E + F = 2
    let mut uses: std::collections::HashMap<(usize, usize), usize> = std::collections::HashMap::new();
    for (_, ring) in &faces_out {
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            *uses.entry((a.min(b), a.max(b))).or_insert(0) += 1;
        }
    }
    if uses.values().any(|n| *n != 2) || points.len() as i64 - uses.len() as i64 + faces_out.len() as i64 != 2 {
        return None;
    }
    let solid = build::ensure_outward(&build::polyhedron_solid(&points, &faces_out));
    Some((solid, points, faces_out))
}

fn volume_went_down(src: &TSolid, out: &TSolid) -> bool {
    let (v0, v1) = (build::solid_volume(src), build::solid_volume(out));
    v1.is_finite() && v1 > 0.0 && v1 < v0 - 1e-12 * v0.abs()
}

/// The part with one more half-space: the chamfer of size `size` on the straight convex edge through `mid`
/// along `t`, between the faces whose in-face directions (square to `t`, into the face) are `ia` and `ib`.
/// `None` unless the part is a convex planar single shell and the cut gains exactly one face and loses none.
pub fn halfspace_chamfer(src: &TSolid, mid: Vec3, t: Vec3, ia: Vec3, ib: Vec3, size: f64) -> Option<TSolid> {
    if !(size > 0.0) {
        return None;
    }
    let (halves, centroid, extent) = read_convex(src)?;
    let bevel = plane_through(mid, t, add(mid, scale(ia, size)), add(mid, scale(ib, size)))?;
    let mut planes = halves.clone();
    planes.push(bevel);
    let (solid, _, rings) = polytope(&planes, centroid, extent, len(sub(mid, centroid)) + size)?;
    if rings.len() != halves.len() + 1 || !volume_went_down(src, &solid) {
        return None;
    }
    Some(solid)
}

/// Tolerance for "this plane is exactly that bevel": sizes that differ by more than rounding are different sizes.
fn same_half(x: Half, y: Half, extent: f64) -> bool {
    len(sub(x.0, y.0)) < 1e-9 && (x.1 - y.1).abs() < 1e-9 * (1.0 + extent)
}

/// Why a corner of three equal chamfers is not built.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CornerFail {
    /// The corner is sharper than FreeCAD's planar corner: it closes such a corner with a curved (B-spline) blend,
    /// which brep-rs does not build.
    Sharp,
    /// Anything else: not the equal-size corner of three on a convex part that this slice reads.
    Other,
}

/// The corner angle (degrees) below which FreeCAD 26.3.0 RC1 closes three equal chamfers at a prism corner with a
/// curved (B-spline) patch rather than a plane, and the one above which it uses the four-point plane. Measured by
/// bisection on a parallelogram prism (d = 0.5 .. 3, heights 4 .. 20, side lengths 20 .. 60; the angles did not
/// move): the curved patch up to 69.3785, the three-point plane from 69.3790 to 110.5550, the four-point plane
/// from 110.5551. Between the first two the plane goes through the three points where the edges leaving the
/// three-bevel apex reach the part's own faces. A corner within the margin of either is refused, not guessed.
const ANGLE_LO: f64 = 69.3788;
const ANGLE_HI: f64 = 110.55505;
const ANGLE_LO_MARGIN: f64 = 0.0006;
const ANGLE_HI_MARGIN: f64 = 0.0003;

/// One picked edge at a corner: its direction away from the corner, the in-face unit directions square to it, and
/// the outward normals of its two faces.
#[derive(Clone, Copy)]
struct EdgeFrame {
    t: Vec3,
    p: Vec3,
    q: Vec3,
    na: Vec3,
    nb: Vec3,
}

/// The patch plane of three equal bevels at the corner `c`, the patch's outward side being the one holding `c`.
///
/// The corner must be a prism corner: one face (the cap) square to the other two. With its angle `theta` (the
/// angle the two other faces make, equally the cap's angle at the corner) FreeCAD builds
/// * `theta` between 69.38 and 110.555 degrees: the plane through the apex of the strips on the cap and the two end
///   points of the edge between the other faces, a triangle at a right angle;
/// * `theta` over 110.555 degrees: the plane through the four strip end points (coplanar at any angle);
/// * `theta` under 69.38 degrees: a curved patch, refused.
fn patch_plane(c: Vec3, size: f64, edges: [EdgeFrame; 3], extent: f64) -> Result<(Half, Vec<Vec3>), CornerFail> {
    let mut dn: Vec<Vec3> = Vec::new();
    for e in &edges {
        for n in [e.na, e.nb] {
            if !dn.iter().any(|m| len(sub(*m, n)) < 1e-6) {
                dn.push(n);
            }
        }
    }
    if dn.len() != 3 {
        return Err(CornerFail::Other);
    }
    let cap = (0..3).find(|k| (0..3).all(|j| j == *k || dot(dn[*k], dn[j]).abs() < 1e-7)).ok_or(CornerFail::Other)?;
    let (s1, s2) = match cap {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    };
    let cos_theta = (-dot(dn[s1], dn[s2])).clamp(-1.0, 1.0);
    let theta = cos_theta.acos().to_degrees();
    if theta < ANGLE_LO - ANGLE_LO_MARGIN {
        return Err(CornerFail::Sharp);
    }
    if (theta - ANGLE_LO).abs() <= ANGLE_LO_MARGIN || (theta - ANGLE_HI).abs() <= ANGLE_HI_MARGIN {
        return Err(CornerFail::Other);
    }
    // the end points of each strip: square at `size` along its own edge, one point in each of its faces
    let mut pts: Vec<Vec3> = Vec::new();
    for e in &edges {
        let base = add(c, scale(e.t, size));
        pts.push(add(base, scale(e.p, size)));
        pts.push(add(base, scale(e.q, size)));
    }
    let key: Vec<Vec3> = if theta < ANGLE_HI {
        // the edge between the two non-cap faces, and the two cap edges
        let is_cap = |n: Vec3| len(sub(n, dn[cap])) < 1e-6;
        let vi = (0..3).find(|i| !is_cap(edges[*i].na) && !is_cap(edges[*i].nb)).ok_or(CornerFail::Other)?;
        let mut ta: Vec<Vec3> = Vec::new();
        for (i, e) in edges.iter().enumerate() {
            if i != vi {
                ta.push(e.t);
            }
        }
        let sin_theta = theta.to_radians().sin();
        if ta.len() != 2 || sin_theta < 1e-3 {
            return Err(CornerFail::Other);
        }
        let apex = add(c, scale(add(ta[0], ta[1]), size / sin_theta));
        vec![pts[2 * vi], pts[2 * vi + 1], apex]
    } else {
        pts.clone()
    };
    let mut best: Option<(f64, Vec3)> = None;
    for i in 0..key.len() {
        for j in (i + 1)..key.len() {
            for k in (j + 1)..key.len() {
                let nrm = cross(sub(key[j], key[i]), sub(key[k], key[i]));
                let area = len(nrm);
                if best.map_or(true, |(a, _)| area > a) {
                    best = Some((area, nrm));
                }
            }
        }
    }
    let (area, nrm) = best.ok_or(CornerFail::Other)?;
    if area < 1e-9 {
        return Err(CornerFail::Other);
    }
    let mut pn = normalize(nrm);
    let p0 = key[0];
    if key.iter().any(|p| dot(pn, sub(*p, p0)).abs() > 1e-7 * (1.0 + extent)) {
        return Err(CornerFail::Other);
    }
    if dot(pn, sub(c, p0)) < 0.0 {
        pn = scale(pn, -1.0);
    }
    let patch: Half = (pn, dot(pn, p0));
    if dot(pn, c) - patch.1 < 1e-9 {
        return Err(CornerFail::Other);
    }
    Ok((patch, key))
}

/// What the third bevel at one end needs: the new edge's bevel plane, the patch, and the strip end points.
struct EndPatch {
    bevel: Half,
    patch: Half,
    pts: Vec<Vec3>,
}

/// The equal-size corner of three closing at `endpoint` (which touches four faces: the new edge's `ia` and `ib` and
/// the two bevels already cut). The third face of the ORIGINAL corner is found as the one candidate for which the
/// two bevels in the part are exactly the bevels of this size of the other two edges.
fn end_patch(faces: &[TFace], halves: &[Half], extent: f64, ia: usize, ib: usize, endpoint: &topo::VertexRef, size: f64) -> Result<EndPatch, CornerFail> {
    let at: Vec<usize> = (0..faces.len()).filter(|k| touches(&faces[*k], endpoint)).collect();
    if at.len() != 4 || !at.contains(&ia) || !at.contains(&ib) {
        return Err(CornerFail::Other);
    }
    let others: Vec<usize> = at.iter().copied().filter(|k| *k != ia && *k != ib).collect();
    let (g1, g2) = (others[0], others[1]);
    let (h1, h2) = (halves[g1], halves[g2]);
    let (na, nb) = (halves[ia].0, halves[ib].0);
    let mut found: Option<EndPatch> = None;
    let mut sharp = false;
    for iz in 0..faces.len() {
        if [ia, ib, g1, g2].contains(&iz) {
            continue;
        }
        let nz = halves[iz].0;
        let Some(c) = solve3([na, nb, nz], [halves[ia].1, halves[ib].1, halves[iz].1]) else { continue };
        let (Some(fab), Some(faz), Some(fbz)) = (edge_frame(na, nb, nz), edge_frame(na, nz, nb), edge_frame(nb, nz, na)) else { continue };
        let (Some(b_ab), Some(b_az), Some(b_bz)) = (
            bevel_plane(c, size, fab.0, fab.1, fab.2),
            bevel_plane(c, size, faz.0, faz.1, faz.2),
            bevel_plane(c, size, fbz.0, fbz.1, fbz.2),
        ) else {
            continue;
        };
        // the two bevels in the part are exactly this size, on the two other edges of the corner
        if !((same_half(h1, b_az, extent) && same_half(h2, b_bz, extent)) || (same_half(h1, b_bz, extent) && same_half(h2, b_az, extent))) {
            continue;
        }
        let ef = |f: (Vec3, Vec3, Vec3), x: Vec3, y: Vec3| EdgeFrame { t: f.0, p: f.1, q: f.2, na: x, nb: y };
        let frames = [ef(fab, na, nb), ef(faz, na, nz), ef(fbz, nb, nz)];
        let (patch, pts) = match patch_plane(c, size, frames, extent) {
            Ok(x) => x,
            Err(CornerFail::Sharp) => {
                sharp = true;
                continue;
            }
            Err(_) => continue,
        };
        if found.is_some() {
            return Err(CornerFail::Other);
        }
        found = Some(EndPatch { bevel: b_ab, patch, pts });
    }
    found.ok_or(if sharp { CornerFail::Sharp } else { CornerFail::Other })
}

/// Build the part with the third bevel (`size`, on the edge between `fa` and `fb`) and the corner patch at EVERY
/// end in `ends` (each touching four faces: the edge's own two and the two equal bevels already cut), or `None`
/// when it is not exactly the equal-size corner of three described above at each of them.
pub fn corner_patch(src: &TSolid, fa: &TFace, fb: &TFace, ends: &[topo::VertexRef], size: f64) -> Result<TSolid, CornerFail> {
    let other = CornerFail::Other;
    if !(size > 0.0) || ends.is_empty() {
        return Err(other);
    }
    let faces = src.faces();
    let (halves, centroid, extent) = read_convex(src).ok_or(other)?;
    let idx = |f: &TFace| faces.iter().position(|g| std::rc::Rc::ptr_eq(g, f));
    let (ia, ib) = (idx(fa).ok_or(other)?, idx(fb).ok_or(other)?);
    let mut planes = halves.clone();
    let mut patches: Vec<EndPatch> = Vec::new();
    for endpoint in ends {
        patches.push(end_patch(&faces, &halves, extent, ia, ib, endpoint, size)?);
    }
    // the new edge has ONE bevel plane, whichever end it is read at
    if patches.iter().any(|p| !same_half(p.bevel, patches[0].bevel, extent)) {
        return Err(other);
    }
    planes.push(patches[0].bevel);
    for p in &patches {
        planes.push(p.patch);
    }
    let reach = patches.iter().map(|p| len(sub(centroid, p.pts[0]))).fold(0.0_f64, f64::max) + size;
    let (solid, points, rings) = polytope(&planes, centroid, extent, reach).ok_or(other)?;
    if rings.len() != faces.len() + 1 + patches.len() || !volume_went_down(src, &solid) {
        return Err(other);
    }
    // every strip end point is a vertex of its patch ring
    for (j, p) in patches.iter().enumerate() {
        let patch_ring = &rings[faces.len() + 1 + j].1;
        for q in &p.pts {
            if !patch_ring.iter().any(|k| len(sub(points[*k], *q)) <= 1e-7 * (1.0 + extent)) {
                return Err(other);
            }
        }
    }
    Ok(solid)
}

/// Why a run of chamfers is not built by `run_chamfer`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RunFail {
    /// Not a run this builder reads (not convex, an end that is not a plain three-face corner, ...): the caller
    /// keeps whatever it had.
    Skip,
    /// The size does not fit the part: two opposite faces carrying bevels are not more than twice the size apart,
    /// or two bevels that do not meet at a corner cut the same face in overlapping places (FreeCAD marks the
    /// feature Invalid and builds nothing).
    TooBig,
    /// Two picked edges meet at a vertex of a prism where the face they share is a side and the other side leans
    /// a hair off square: FreeCAD 26.3.0 RC1's solid there is not the union of the two cuts (it differs by up to a
    /// few thousandths of a percent), and not by a rule that is known, so it is refused rather than shown.
    NearSquare,
    /// Three of the picked edges close a corner sharper than FreeCAD's planar corner (`CornerFail::Sharp`).
    Sharp,
}

/// One picked edge of a run, as the part has it: the edge and the two faces it lies between.
pub struct RunEdge {
    pub edge: build::TEdge,
    pub fa: TFace,
    pub fb: TFace,
}

/// One picked edge of a run read on the part: ends, directions, face normals and indices, and its bevel.
struct Pick {
    va: topo::VertexRef,
    vb: topo::VertexRef,
    /// In-face unit directions (square to the edge, into each face) and the edge's own direction.
    ia: Vec3,
    ib: Vec3,
    n: Vec3,
    m: Vec3,
    /// Outward normals and indices of the two faces.
    na: Vec3,
    nb: Vec3,
    ka: usize,
    kb: usize,
}

/// Read the picked edges of a run on the part: each a straight edge between two flat faces at a convex angle with
/// the size fitting both faces. The bevel half-space of each is returned beside it.
fn read_run(faces: &[TFace], halves: &[Half], extent: f64, picks: &[RunEdge], size: f64) -> Result<(Vec<Pick>, Vec<Half>), RunFail> {
    let skip = RunFail::Skip;
    let idx = |f: &TFace| faces.iter().position(|g| std::rc::Rc::ptr_eq(g, f));
    let mut ps: Vec<Pick> = Vec::new();
    let mut bevels: Vec<Half> = Vec::new();
    for pk in picks {
        let (ka, kb) = (idx(&pk.fa).ok_or(skip)?, idx(&pk.fb).ok_or(skip)?);
        if ka == kb {
            return Err(skip);
        }
        if picks.iter().filter(|q| topo::same(&q.edge, &pk.edge)).count() != 1 {
            return Err(skip);
        }
        let e = pk.edge.borrow();
        if !matches!(&e.curve, crate::geom::Curve::Segment { .. }) {
            return Err(skip);
        }
        let (va, vb) = (e.a.clone(), e.b.clone());
        let (a, b) = (va.borrow().point, vb.borrow().point);
        drop(e);
        let l = len(sub(b, a));
        if l <= 1e-9 {
            return Err(skip);
        }
        let t = scale(sub(b, a), 1.0 / l);
        let ((na, da), (nb, db)) = (halves[ka], halves[kb]);
        let tol = 1e-7 * (1.0 + extent);
        if [a, b].iter().any(|p| (dot(na, *p) - da).abs() > tol || (dot(nb, *p) - db).abs() > tol) {
            return Err(skip);
        }
        let mut ia = normalize(cross(na, t));
        if dot(ia, nb) > 0.0 {
            ia = scale(ia, -1.0);
        }
        let mut ib = normalize(cross(nb, t));
        if dot(ib, na) > 0.0 {
            ib = scale(ib, -1.0);
        }
        if dot(ia, nb) > -1e-6 || dot(ib, na) > -1e-6 {
            return Err(skip);
        }
        // the size must fit both faces, measured across them from the edge
        let reach = |k: usize, dir: Vec3| build::face_ring_points(&faces[k].borrow()).iter().fold(0.0_f64, |m, p| m.max(dot(sub(*p, a), dir)));
        if size >= reach(ka, ia).min(reach(kb, ib)) - 1e-9 * (1.0 + extent) {
            return Err(RunFail::TooBig);
        }
        let mid = scale(add(a, b), 0.5);
        bevels.push(plane_through(mid, t, add(mid, scale(ia, size)), add(mid, scale(ib, size))).ok_or(skip)?);
        ps.push(Pick { va, vb, ia, ib, n: t, m: mid, na, nb, ka, kb });
    }
    Ok((ps, bevels))
}

/// The vertices the picked edges end at, each with the picks (and which end) that end there.
fn group_vertices(ps: &[Pick]) -> Vec<(topo::VertexRef, Vec<(usize, bool)>)> {
    let mut verts: Vec<(topo::VertexRef, Vec<(usize, bool)>)> = Vec::new();
    for (i, p) in ps.iter().enumerate() {
        for (v, is_b) in [(&p.va, false), (&p.vb, true)] {
            match verts.iter_mut().find(|(w, _)| std::rc::Rc::ptr_eq(w, v)) {
                Some((_, l)) => l.push((i, is_b)),
                None => verts.push((v.clone(), vec![(i, is_b)])),
            }
        }
    }
    verts
}

/// The validity rules FreeCAD 26.3.0 RC1 imposes on a pick (all measured against it; see `RunFail`). `Ok` when the
/// run, as a whole pick, is one FreeCAD builds as the half-space solid with corner patches.
fn run_guards(faces: &[TFace], halves: &[Half], extent: f64, ps: &[Pick], bevels: &[Half], size: f64, volume: f64) -> Result<(), RunFail> {
    // Two opposite parallel faces that both carry a bevel of this run (a chamfered top and a chamfered bottom, two
    // chamfered sides) must be more than twice the size apart: FreeCAD marks the feature Invalid and builds nothing
    // when they are not (3 mm plate, size 1.5 and over, top and bottom corners), whichever edges of the faces are
    // picked. Refused the same way as a size that does not fit.
    for (i, pi) in ps.iter().enumerate() {
        for pj in ps.iter().skip(i + 1) {
            for kx in [pi.ka, pi.kb] {
                for ky in [pj.ka, pj.kb] {
                    if kx == ky {
                        continue;
                    }
                    let (hx, hy) = (halves[kx], halves[ky]);
                    if dot(hx.0, hy.0) < -1.0 + 1e-9 && 2.0 * size >= hx.1 + hy.1 - 1e-9 * (1.0 + extent) {
                        return Err(RunFail::TooBig);
                    }
                }
            }
        }
    }
    // Two bevels of edges that do not meet at a corner must not cut the same face in overlapping places: FreeCAD
    // marks the feature Invalid and builds nothing (measured on 1,500 random convex prisms: every such overlap
    // invalid, none valid). Edges that meet at a corner overlap legitimately at it, and a third bevel that meets
    // both and already removes the overlap makes it legitimate as well (a short side between two picked sides).
    let shares = |a: &Pick, b: &Pick| [&a.va, &a.vb].iter().any(|x| [&b.va, &b.vb].iter().any(|y| std::rc::Rc::ptr_eq(x, y)));
    let outer = |poly: &[Vec3], h: Half| clip(poly, scale(h.0, -1.0), -h.1, 1e-9 * (1.0 + extent));
    let area_of = |poly: &[Vec3]| {
        let mut acc = [0.0; 3];
        for k in 0..poly.len() {
            acc = add(acc, cross(poly[k], poly[(k + 1) % poly.len()]));
        }
        0.5 * len(acc)
    };
    for (fi, f) in faces.iter().enumerate() {
        let ring = build::face_ring_points(&f.borrow());
        if ring.len() < 3 {
            continue;
        }
        let fa = area_of(&ring);
        let fps: Vec<Vec<Vec3>> = bevels.iter().map(|b| outer(&ring, *b)).collect();
        for i in 0..ps.len() {
            if fps[i].len() < 3 {
                continue;
            }
            // In a run of two or more, a bevel's half-space must not reach past the faces next to its edge (its
            // own two and the faces at its two ends) onto a face further away: FreeCAD marks such a pick Invalid
            // (a lone chamfer is built, and so is one that only grazes).
            if ps.len() >= 2 && fi != ps[i].ka && fi != ps[i].kb && !touches(f, &ps[i].va) && !touches(f, &ps[i].vb) && area_of(&fps[i]) > 1e-7 * fa.max(1.0) {
                return Err(RunFail::TooBig);
            }
            for j in (i + 1)..ps.len() {
                if fps[j].len() < 3 || shares(&ps[i], &ps[j]) {
                    continue;
                }
                let ov = outer(&fps[i], bevels[j]);
                if ov.len() < 3 || area_of(&ov) <= 1e-7 * fa.max(1.0) {
                    continue;
                }
                // (and the pick that covers it lies on this very face)
                let covered = (0..ps.len()).any(|k| {
                    k != i
                        && k != j
                        && (fi == ps[k].ka || fi == ps[k].kb)
                        && shares(&ps[k], &ps[i])
                        && shares(&ps[k], &ps[j])
                        && ov.iter().all(|v| dot(bevels[k].0, *v) >= bevels[k].1 - 1e-7 * (1.0 + extent))
                });
                if !covered {
                    return Err(RunFail::TooBig);
                }
            }
        }
    }
    // Two picked edges that meet at a vertex and share a face. When that face is a side of a prism (not the cap,
    // the face square to the other two) and the other side leans off square by a hair, FreeCAD's solid is not the
    // union of the two cuts (see `RunFail::NearSquare`); the window is exactly where size * (1 - cos(lean)) is
    // under a thousandth of a millimetre (measured at sizes 0.3 .. 2.5: still off at 0.99e-3, on the half-space
    // solid from 1.00e-3).
    for (v, list) in group_vertices(ps) {
        if list.len() != 2 {
            continue;
        }
        let at: Vec<usize> = (0..faces.len()).filter(|k| touches(&faces[*k], &v)).collect();
        if at.len() != 3 {
            continue;
        }
        let cap = at.iter().copied().find(|k| at.iter().all(|j| j == k || dot(halves[*k].0, halves[*j].0).abs() < 1e-7));
        let Some(cap) = cap else { continue };
        let both_on_cap = list.iter().all(|(i, _)| ps[*i].ka == cap || ps[*i].kb == cap);
        let sides: Vec<usize> = at.iter().copied().filter(|k| *k != cap).collect();
        if !both_on_cap && sides.len() == 2 {
            let lean = (-dot(halves[sides[0]].0, halves[sides[1]].0)).clamp(-1.0, 1.0).acos() - std::f64::consts::FRAC_PI_2;
            // ... and where its deviation from the union of the cuts (about 9 * size^0.8 * lean^2 mm^3, measured at
            // leans of 0.001 .. 0.5 degrees and sizes 0.5 .. 6, three times over for the edge lengths) could
            // reach a ten-billionth of the part.
            let est = 30.0 * size.powf(0.8) * lean * lean;
            if lean.abs() > 1e-9 && size * (1.0 - lean.cos()) < 1.0002e-3 && est > 1e-10 * volume {
                return Err(RunFail::NearSquare);
            }
        }
    }
    Ok(())
}

/// A run of EQUAL chamfers on a convex planar part, built together from the part the run started on, so that the
/// answer does not depend on the order the edges were picked in. The result is the part cut by every bevel
/// half-space and, at each vertex where three of the picked edges meet, by FreeCAD's corner patch (see the module
/// header). Where two picked edges meet the two cuts are simply united.
///
/// `picks` is the run so far. `whole`, when the caller knows how the run goes on (the chamfers of the same size
/// chained after this one), is the run in full: the validity rules FreeCAD imposes on a pick are held against the
/// whole of it, so a prefix that only becomes legitimate when a later edge is picked is built, as it is in FreeCAD
/// (one pick of the whole run); a prefix is refused only when the whole run is invalid too.
///
/// `Err(Skip)` (the caller keeps whatever it had) unless every precondition holds: single convex planar shell,
/// every picked edge straight between two flat faces at a convex angle with the size fitting its faces, every end
/// of every picked edge a vertex of exactly three faces, and the result gains exactly one face per bevel and one
/// per patch, closed, with every strip end a vertex of its patch.
pub fn run_chamfer(src: &TSolid, picks: &[RunEdge], size: f64, whole: Option<&[RunEdge]>) -> Result<TSolid, RunFail> {
    let skip = RunFail::Skip;
    if !(size > 0.0) || picks.is_empty() {
        return Err(skip);
    }
    let (halves, centroid, extent) = read_convex(src).ok_or(skip)?;
    let faces = src.faces();
    let (ps, bevels) = read_run(&faces, &halves, extent, picks, size)?;
    let volume = build::solid_volume(src).abs();
    if let Err(why) = run_guards(&faces, &halves, extent, &ps, &bevels, size, volume) {
        let whole_ok = whole.is_some_and(|w| {
            read_run(&faces, &halves, extent, w, size)
                .is_ok_and(|(wp, wb)| run_guards(&faces, &halves, extent, &wp, &wb, size, volume).is_ok())
        });
        if !whole_ok {
            return Err(why);
        }
    }
    // the vertices the picked edges end at: each a corner of exactly three faces
    let verts = group_vertices(&ps);
    let mut planes = halves.clone();
    planes.extend(bevels.iter().copied());
    let mut patch_pts: Vec<Vec<Vec3>> = Vec::new();
    for (v, list) in &verts {
        let valence = faces.iter().filter(|f| touches(f, v)).count();
        if valence != 3 {
            return Err(skip);
        }
        if list.len() == 3 {
            let c = v.borrow().point;
            let mut frames: Vec<EdgeFrame> = Vec::new();
            for (i, is_b) in list {
                let p = &ps[*i];
                // the edge's direction away from the corner, and the in-face directions square to it
                frames.push(EdgeFrame { t: if *is_b { scale(p.n, -1.0) } else { p.n }, p: p.ia, q: p.ib, na: p.na, nb: p.nb });
            }
            let (patch, pts) = match patch_plane(c, size, [frames[0], frames[1], frames[2]], extent) {
                Ok(x) => x,
                Err(CornerFail::Sharp) => return Err(RunFail::Sharp),
                Err(CornerFail::Other) => return Err(skip),
            };
            if dot(patch.0, centroid) - patch.1 > -1e-9 {
                return Err(skip);
            }
            planes.push(patch);
            patch_pts.push(pts);
        } else if list.len() > 3 {
            return Err(skip);
        }
    }
    let reach = ps.iter().map(|p| len(sub(centroid, p.m))).fold(0.0_f64, f64::max) + size;
    let (solid, points, rings) = polytope(&planes, centroid, extent, reach).ok_or(skip)?;
    if rings.len() != faces.len() + bevels.len() + patch_pts.len() || !volume_went_down(src, &solid) {
        return Err(skip);
    }
    for (j, pts) in patch_pts.iter().enumerate() {
        let ring = &rings[faces.len() + bevels.len() + j].1;
        for q in pts {
            if !ring.iter().any(|k| len(sub(points[*k], *q)) <= 1e-7 * (1.0 + extent)) {
                return Err(skip);
            }
        }
    }
    Ok(solid)
}

/// Whether the edge between `fa` and `fb` that ends at `endpoint` (a vertex touching exactly one other face `g`)
/// closes a corner that ALREADY carries two bevels of the edges it shares faces with: the third of three chamfers
/// at one corner. Equal sizes are `corner_patch` (the vertex then touches four faces); here the sizes differ,
/// and a pick has one size, so there is no FreeCAD answer to match: refused.
pub fn closes_unequal_corner(src: &TSolid, fa: &TFace, fb: &TFace, endpoint: &topo::VertexRef) -> bool {
    let Some((halves, _, extent)) = read_convex(src) else { return false };
    let faces = src.faces();
    let idx = |f: &TFace| faces.iter().position(|g| std::rc::Rc::ptr_eq(g, f));
    let (Some(ia), Some(ib)) = (idx(fa), idx(fb)) else { return false };
    let (ha, hb) = (halves[ia], halves[ib]);
    let at: Vec<usize> = (0..faces.len()).filter(|k| touches(&faces[*k], endpoint)).collect();
    let others: Vec<usize> = at.iter().copied().filter(|k| *k != ia && *k != ib).collect();
    // is plane `h` the equal-leg bevel (any size) of the edge between planes `p` and `q` (third plane `r`, corner `c`)?
    let bevel_of = |h: Half, p: Half, q: Half, r: Half, c: Vec3| -> bool {
        let Some((t, ip, iq)) = edge_frame(p.0, q.0, r.0) else { return false };
        if dot(h.0, t).abs() > 1e-6 {
            return false;
        }
        let (dp, dq) = (dot(h.0, ip), dot(h.0, iq));
        if dp.abs() < 1e-9 || dq.abs() < 1e-9 {
            return false;
        }
        let (up, uq) = ((h.1 - dot(h.0, c)) / dp, (h.1 - dot(h.0, c)) / dq);
        up > 1e-9 && (up - uq).abs() < 1e-7 * (1.0 + extent)
    };
    for g in others {
        for z in 0..faces.len() {
            if [ia, ib, g].contains(&z) || !same_edge_use(&faces[z], &faces[g]) {
                continue;
            }
            let (hg, hz) = (halves[g], halves[z]);
            let Some(c) = solve3([ha.0, hb.0, hz.0], [ha.1, hb.1, hz.1]) else { continue };
            // g is the bevel of one of the corner's other two edges; some other face is the bevel of the other
            let pairs = [(ha, hz, hb), (hb, hz, ha)];
            for k in 0..2 {
                let (p, q, r) = pairs[k];
                if !bevel_of(hg, p, q, r, c) {
                    continue;
                }
                let (p2, q2, r2) = pairs[1 - k];
                for h in 0..faces.len() {
                    if [ia, ib, g, z].contains(&h) {
                        continue;
                    }
                    if bevel_of(halves[h], p2, q2, r2, c) {
                        return true;
                    }
                }
            }
        }
    }
    false
}
