//! SLICE A1: chamfers that meet at ONE convex corner of a planar solid.
//!
//! A convex planar solid is the intersection of the half-spaces of its faces, and a chamfer of one of its
//! straight edges is one more half-space (the bevel plane, `size` in from the edge along both faces). That is
//! exact on a convex part whatever the angle between the faces, which the wedge-and-subtract path is not at an
//! end that is not square (a bevel already there, an obtuse corner). `halfspace_chamfer` is that cut.
//!
//! Three equal chamfers meeting at ONE corner are one more thing. FreeCAD (26.3.0 RC1) builds a single pick of
//! the three edges as the half-space solid cut once more by ONE planar "corner patch" that removes the tip of
//! the three-plane apex:
//!
//! * each strip ends squarely at distance `d` from the original corner `C` along its own edge, as a segment from
//!   the point `d` inside one adjacent face to the point `d` inside the other;
//! * the patch plane passes through those end points (three of them at a right-angled corner, four at an obtuse
//!   one -- they are coplanar either way) and the side holding `C` goes;
//! * every face of the result is a plane: the part's faces + the three bevels + the patch.
//!
//! (Three SEPARATE chamfer features chained one after another build the plain half-space solid in FreeCAD, with
//! no patch; a document cannot tell the two apart, and a run of equal chamfers is one pick everywhere else in
//! the kernel -- `rim_runs` -- so the run is read as one pick here.)
//!
//! Both are built as a convex polytope and refused unless every precondition holds: single convex planar shell;
//! the bevels already there are exactly the equal-size bevels of the edges the new one shares a face with; the
//! six end points are coplanar; the result gains exactly the faces it should; every edge is used twice; the
//! volume only went down.
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
        let poly = tidy(poly, 1e-7 * (1.0 + extent));
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
    let tol = 1e-6 * (1.0 + extent);
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

/// Build the part with the third bevel (`size`, on the edge between `fa` and `fb`, which ends at `endpoint`) and
/// the corner patch, or `None` when it is not exactly the equal-size corner of three described above.
pub fn corner_patch(src: &TSolid, fa: &TFace, fb: &TFace, endpoint: &topo::VertexRef, size: f64) -> Option<TSolid> {
    if !(size > 0.0) {
        return None;
    }
    let faces = src.faces();
    let (halves, centroid, extent) = read_convex(src)?;
    let idx = |f: &TFace| faces.iter().position(|g| std::rc::Rc::ptr_eq(g, f));
    let (ia, ib) = (idx(fa)?, idx(fb)?);
    // the faces at the end of the edge: its own two and the two bevels already cut
    let at: Vec<usize> = (0..faces.len()).filter(|k| touches(&faces[*k], endpoint)).collect();
    if at.len() != 4 || !at.contains(&ia) || !at.contains(&ib) {
        return None;
    }
    let others: Vec<usize> = at.iter().copied().filter(|k| *k != ia && *k != ib).collect();
    let (g1, g2) = (others[0], others[1]);
    // the third face of the original corner: the one the two bevels both border
    let zs: Vec<usize> = (0..faces.len())
        .filter(|k| ![ia, ib, g1, g2].contains(k) && same_edge_use(&faces[*k], &faces[g1]) && same_edge_use(&faces[*k], &faces[g2]))
        .collect();
    if zs.len() != 1 {
        return None;
    }
    let iz = zs[0];
    let (na, nb, nz) = (halves[ia].0, halves[ib].0, halves[iz].0);
    let c = solve3([na, nb, nz], [halves[ia].1, halves[ib].1, halves[iz].1])?;
    // the three edges of the corner and their bevels of this size
    let (tab, aab, bab) = edge_frame(na, nb, nz)?;
    let (taz, aaz, zaz) = edge_frame(na, nz, nb)?;
    let (tbz, bbz, zbz) = edge_frame(nb, nz, na)?;
    let b_ab = bevel_plane(c, size, tab, aab, bab)?;
    let b_az = bevel_plane(c, size, taz, aaz, zaz)?;
    let b_bz = bevel_plane(c, size, tbz, bbz, zbz)?;
    let near = |x: Half, y: Half| len(sub(x.0, y.0)) < 1e-7 && (x.1 - y.1).abs() < 1e-7 * (1.0 + extent);
    // the two bevels in the part are exactly this size, on the two other edges of the corner
    let (h1, h2) = (halves[g1], halves[g2]);
    if !((near(h1, b_az) && near(h2, b_bz)) || (near(h1, b_bz) && near(h2, b_az))) {
        return None;
    }
    // the strips' end points; each strip ends square at `size` along its own edge
    let mut pts: Vec<Vec3> = Vec::new();
    for (t, p, q) in [(tab, aab, bab), (taz, aaz, zaz), (tbz, bbz, zbz)] {
        let base = add(c, scale(t, size));
        pts.push(add(base, scale(p, size)));
        pts.push(add(base, scale(q, size)));
    }
    // the patch plane through the end points: the widest triangle, then every point must lie on it
    let mut best: Option<(f64, Vec3)> = None;
    for i in 0..pts.len() {
        for j in (i + 1)..pts.len() {
            for k in (j + 1)..pts.len() {
                let nrm = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
                let area = len(nrm);
                if best.map_or(true, |(a, _)| area > a) {
                    best = Some((area, nrm));
                }
            }
        }
    }
    let (area, nrm) = best?;
    if area < 1e-9 {
        return None;
    }
    let mut pn = normalize(nrm);
    let p0 = pts[0];
    if pts.iter().any(|p| dot(pn, sub(*p, p0)).abs() > 1e-7 * (1.0 + extent)) {
        return None;
    }
    if dot(pn, sub(c, p0)) < 0.0 {
        pn = scale(pn, -1.0);
    }
    let patch: Half = (pn, dot(pn, p0));
    if dot(pn, c) - patch.1 < 1e-9 {
        return None;
    }
    // the polytope: the part's planes, the third bevel, the patch -- exactly two faces more
    let mut planes = halves.clone();
    planes.push(b_ab);
    planes.push(patch);
    let (solid, points, rings) = polytope(&planes, centroid, extent, len(sub(c, centroid)) + size)?;
    if rings.len() != faces.len() + 2 || !volume_went_down(src, &solid) {
        return None;
    }
    // every strip end point is a vertex of the patch ring
    let patch_ring = &rings[rings.len() - 1].1;
    for p in &pts {
        if !patch_ring.iter().any(|k| len(sub(points[*k], *p)) <= 1e-6 * (1.0 + extent)) {
            return None;
        }
    }
    Some(solid)
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
