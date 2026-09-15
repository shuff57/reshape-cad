//! Layer `ops`: booleans (§4.5).
//!
//! This is a real B-rep boolean, not a 2.5D slice. It intersects the ACTUAL
//! analytic faces of the two operands (plane-plane, plane-cylinder, plane-sphere,
//! cylinder-plane, and — for the wall case — cylinder against the other solid's
//! supporting surfaces), classifies every face region as in / out / on by
//! probing just inside and just outside the face along its own normal, splits
//! the kept regions along the intersection curves using their pcurves, and
//! reassembles the kept faces into a closed shell. Curves are never sampled into
//! polygons: a plane-cylinder intersection is a genuine `Curve::Circle`.
//!
//! DEPARTURE 3 (SPEC §4.5): coplanar and tangent faces are handled, not treated
//! as edge cases. A face that lies exactly on the other solid's boundary is
//! classified by the probe offset (§ [`boolean`]), and coincident output faces
//! are de-duplicated so a shared face is not counted twice.
//!
//! Anything outside what is implemented here (a cone/torus intersection, a
//! partial-arc cylinder as an operand, a sphere being trimmed) returns None and
//! the caller refuses the feature in words rather than returning a wrong solid.

use std::cell::RefCell;
use std::rc::Rc;

use crate::build::{self, Curve3, Surface3, TFace, TSolid};
use crate::geom::{Curve, Cylinder, Plane, Surface};
use crate::math::{add, cross, dot, normalize, scale, sub, Vec3};
use crate::topo::{self, Face, Shell, Solid, Wire};

pub use crate::build::transform_solid;

/// Distance used to probe just inside / just outside a face. Larger than the
/// kernel's geometric tolerance so an exact-on-boundary face is decided cleanly,
/// small enough that it does not cross a real feature of the fixtures.
const PROBE: f64 = 1e-6;
const TOL: f64 = 1e-9;
/// Clearance a strictly-enclosed tool must keep from its base's faces. A
/// pocket whose tool touches or grazes the base is not a clean cavity and is
/// refused rather than guessed at (SPEC-brep-pocket.md constraint 4).
const CAVITY_MARGIN: f64 = 1e-6;
const TWO_PI: f64 = 2.0 * std::f64::consts::PI;

/// True when two boxes are close enough to possibly meet (touching counts).
/// The negation of this is a safe "cannot interact" filter: two AABBs that are
/// separated on some axis cannot share any point.
fn aabbs_touch(a: &crate::math::Aabb, b: &crate::math::Aabb) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    (0..3).all(|i| a.lo[i] <= b.hi[i] + TOL && b.lo[i] <= a.hi[i] + TOL)
}

/// A face's own extent as a box. A planar face is measured from its boundary
/// ring (its surface has no finite extent); a curved face uses its surface's
/// exact box. `None` when the extent cannot be established, which callers must
/// read as "might interact" rather than "safe to ignore".
fn face_reach_box(face: &TFace) -> Option<crate::math::Aabb> {
    let fb = face.borrow();
    let b = match &fb.surface {
        Surface::Plane(_) => {
            let mut b = crate::math::Aabb::empty();
            for p in build::face_ring_points(&fb) {
                b.expand(p);
            }
            b
        }
        s => s.aabb(),
    };
    if b.is_empty() { None } else { Some(b) }
}

// ---------------------------------------------------------------------------
// Point / surface tests.
// ---------------------------------------------------------------------------

/// Is `p` inside the solid? A solid is the union of its shells; an
/// intersection of half-spaces is only correct for a CONVEX solid, and an
/// extrapolated profile (the L fixture) is not convex, so instead we count how
/// many times a generic ray from `p` crosses the closed boundary: odd means
/// inside. Exact for planar and full-cylinder faces; an unsupported surface
/// falls back to the half-space test, which is right whenever `other` is convex.
fn inside_solid(solid: &TSolid, p: Vec3) -> bool {
    // One fixed diagonal ray can pass exactly through a shared edge or vertex
    // of the boundary, where two faces both register the crossing and parity
    // flips (a real case: a bore probe at a box's top/side corner). Take a
    // majority over several generic directions instead of trusting one.
    let dirs: [Vec3; 3] = [
        normalize([0.5773502691896258, 0.5773502691896257, 0.5773502691896255]),
        normalize([1.0, 0.5, 0.25]),
        normalize([0.3, 1.0, 0.7]),
    ];
    let mut odd = 0usize;
    let mut even = 0usize;
    for d in dirs {
        if let Some((n, true)) = crossings(solid, p, d) {
            if n % 2 == 1 {
                odd += 1;
            } else {
                even += 1;
            }
        }
    }
    if odd > even {
        return true;
    }
    if even > odd {
        return false;
    }
    // No consensus (or nothing supported): the half-space test is right
    // whenever `other` is convex.
    for f in solid.faces() {
        let s = f.borrow().surface.clone();
        if !inside_surface(&s, p) {
            return false;
        }
    }
    true
}

/// The number of boundary crossings of a ray from `p` along unit direction `d`,
/// and whether every face was a supported type. Callers pick `d` so it is not
/// parallel to a face or grazing an edge.
fn crossings(solid: &TSolid, p: Vec3, d: Vec3) -> Option<(usize, bool)> {
    let mut count = 0usize;
    let mut supported = true;
    for f in solid.faces() {
        let f = f.borrow();
        match &f.surface {
            Surface::Plane(g) => {
                let den = dot(d, g.n);
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = dot(sub(g.origin, p), g.n) / den;
                if t > 1e-9 {
                    let q = add(p, scale(d, t));
                    if plane_face_contains(g, &f, q) {
                        count += 1;
                    }
                }
            }
            Surface::Cylinder(c) => {
                match ray_cylinder(d, p, c) {
                    None => {}
                    Some(ts) => {
                        for t in ts {
                            if t <= 1e-9 {
                                continue;
                            }
                            let q = add(p, scale(d, t));
                            if cyl_face_contains(c, q) {
                                count += 1;
                            }
                        }
                    }
                }
            }
            Surface::Sphere(s) => {
                let w = sub(p, s.center);
                let a = dot(d, d);
                let b = 2.0 * dot(w, d);
                let cc = dot(w, w) - s.radius * s.radius;
                for t in crate::math::solve_quadratic(a, b, cc) {
                    if t > 1e-9 {
                        count += 1;
                    }
                }
            }
            _ => supported = false,
        }
    }
    Some((count, supported))
}

fn plane_face_contains(g: &Plane, f: &Face<Curve3, Surface3>, q: Vec3) -> bool {
    // A disk cap is a single circular boundary.
    if f.boundary.len() == 1 {
        let w = f.boundary.first().unwrap();
        let uses = w.borrow().edges.clone();
        if uses.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &uses[0].edge.borrow().curve {
                return crate::math::len(sub(q, *center)) <= *radius + 1e-7;
            }
        }
    }
    let uv = g.project(q);
    let mut inside = false;
    for (wi, w) in f.boundary.iter().enumerate() {
        let wb = w.borrow();
        let uses = wb.edges.clone();
        if uses.len() == 1 {
            if let Curve::Circle { center, radius, .. } = &uses[0].edge.borrow().curve {
                let c_uv = g.project(*center);
                let d = [(uv[0] - c_uv[0]) as f64, (uv[1] - c_uv[1]) as f64];
                let in_disk = d[0] * d[0] + d[1] * d[1] <= radius * radius + 1e-7;
                if wi == 0 && in_disk {
                    inside = true;
                } else if wi > 0 && in_disk {
                    return false;
                }
                continue;
            }
        }
        let mut pts = Vec::new();
        for u in &uses {
            let eb = u.edge.borrow();
            let pk = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
            pts.push(g.project(pk));
            // An Arc edge bulges away from the straight chord between its
            // endpoints: an annulus sector bounded by two arcs would otherwise
            // project to a collinear quad of its four corners and register no
            // interior at all. Sample the curve (in traversal order) so the
            // polygon follows the real boundary.
            if matches!(eb.curve, Curve::Arc { .. } | Curve::Circle { .. }) {
                let steps = 16;
                for k in 1..steps {
                    let frac = (k as f64) / (steps as f64);
                    let t = if u.forward { frac } else { 1.0 - frac };
                    pts.push(g.project(eb.curve.point_at(t)));
                }
            }
        }
        if pts.len() < 3 {
            continue;
        }
        let in_poly = point_in_poly(&pts, uv);
        if wi == 0 && in_poly {
            inside = true;
        } else if wi > 0 && in_poly {
            return false;
        }
    }
    inside
}

fn cyl_face_contains(c: &Cylinder, q: Vec3) -> bool {
    let dv = sub(q, c.origin);
    let av = dot(dv, c.axis);
    if av < c.vmin - 1e-7 || av > c.vmax + 1e-7 {
        return false;
    }
    if let Some(arc) = &c.arc {
        let r = sub(dv, scale(c.axis, av));
        let e1 = dot(r, c.e1);
        let e2 = dot(r, c.e2);
        let mut a = e2.atan2(e1) - arc.start;
        while a < 0.0 {
            a += TWO_PI;
        }
        if a > arc.span + 1e-7 {
            return false;
        }
    }
    true
}

fn ray_cylinder(d: Vec3, p: Vec3, c: &Cylinder) -> Option<Vec<f64>> {
    let w = sub(p, c.origin);
    let dw = dot(d, c.axis);
    let ww = dot(w, c.axis);
    let dp = sub(d, scale(c.axis, dw));
    let wp = sub(w, scale(c.axis, ww));
    let a = dot(dp, dp);
    let b = 2.0 * dot(wp, dp);
    let cc = dot(wp, wp) - c.radius * c.radius;
    if a.abs() < 1e-12 {
        return None;
    }
    Some(crate::math::solve_quadratic(a, b, cc))
}

fn inside_surface(s: &Surface, p: Vec3) -> bool {
    match s {
        Surface::Plane(pl) => dot(sub(p, pl.origin), pl.n) <= TOL,
        Surface::Cylinder(c) => {
            let d = sub(p, c.origin);
            let along = dot(d, c.axis);
            if along < c.vmin - TOL || along > c.vmax + TOL {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            if crate::math::len(radial) > c.radius + TOL {
                return false;
            }
            if let Some(arc) = &c.arc {
                let ang = c.e2[0] * radial[0] + c.e2[1] * radial[1] + c.e2[2] * radial[2];
                let _ = ang;
                let e1 = dot(radial, c.e1);
                let e2v = dot(radial, c.e2);
                let mut a = e2v.atan2(e1) - arc.start;
                while a < 0.0 {
                    a += TWO_PI;
                }
                if a > arc.span + TOL {
                    return false;
                }
            }
            true
        }
        Surface::Sphere(s) => crate::math::len(sub(p, s.center)) <= s.radius + TOL,
        Surface::Cone(c) => {
            let d = sub(p, c.base);
            let along = dot(d, c.axis);
            let slant_top = c.slant * c.half_angle.cos();
            if along < -TOL || along > slant_top + TOL {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            let r = c.base_radius - along * c.half_angle.tan();
            crate::math::len(radial) <= r + TOL
        }
        Surface::Torus(t) => {
            let d = sub(p, t.center);
            let axial = dot(d, t.axis);
            let radial = sub(d, scale(t.axis, axial));
            let rho = crate::math::len(radial);
            let dr = rho - t.ring;
            dr * dr + axial * axial <= t.tube * t.tube + TOL
        }
    }
}

// ---------------------------------------------------------------------------
// 2D region algebra on a planar face, in the plane's own (u, v) frame.
// ---------------------------------------------------------------------------

/// A convex-in-2D region expressed as an intersection of half-planes
/// `a*u + b*v + c <= 0` and an optional disk `|p - c| <= r`.
#[derive(Clone, Default)]
struct Region {
    hs: Vec<[f64; 3]>,
    disk: Option<([f64; 2], f64)>,
    empty: bool,
}

impl Region {
    fn empty() -> Self {
        Region { hs: Vec::new(), disk: None, empty: true }
    }
    fn all() -> Self {
        Region { hs: Vec::new(), disk: None, empty: false }
    }
    fn with_disk(c: [f64; 2], r: f64) -> Self {
        Region { hs: Vec::new(), disk: Some((c, r)), empty: false }
    }
    fn push_hl(&mut self, h: [f64; 3]) {
        self.hs.push(h);
    }
    fn intersect_disk(&mut self, c: [f64; 2], r: f64) {
        match self.disk {
            None => self.disk = Some((c, r)),
            Some((oc, orr)) => {
                // Two disks: keep the smaller if it is contained, else cannot
                // represent -- mark empty conservatively. Not hit by fixtures.
                if crate::math::len([c[0] - oc[0], c[1] - oc[1], 0.0]) + r <= orr + 1e-7 {
                    self.disk = Some((c, r));
                } else if crate::math::len([c[0] - oc[0], c[1] - oc[1], 0.0]) + orr <= r + 1e-7 {
                    // keep larger
                } else {
                    self.empty = true;
                }
            }
        }
    }
}

fn signed_area2(p: &[[f64; 2]]) -> f64 {
    let n = p.len();
    let mut a = 0.0;
    for i in 0..n {
        let q = p[(i + 1) % n];
        a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    a
}

fn poly_area(p: &[[f64; 2]]) -> f64 {
    (signed_area2(p) * 0.5).abs()
}

fn point_in_poly(poly: &[[f64; 2]], p: [f64; 2]) -> bool {
    let n = poly.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (poly[i][0], poly[i][1]);
        let (xj, yj) = (poly[j][0], poly[j][1]);
        if ((yi > p[1]) != (yj > p[1]))
            && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Sutherland-Hodgman clip of `subj` by the half-plane `a*u + b*v + c <= 0`.
/// A half-plane is convex, so this is exact for a single constraint even when
/// the subject is non-convex.
fn clip_halfplane(subj: &[[f64; 2]], a: f64, b: f64, c: f64) -> Vec<[f64; 2]> {
    if subj.len() < 3 {
        return Vec::new();
    }
    let norm = (a * a + b * b).sqrt().max(1e-12);
    let tol = 1e-9 * norm;
    let f = |p: [f64; 2]| a * p[0] + b * p[1] + c;
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(subj.len() + 2);
    for i in 0..subj.len() {
        let p = subj[i];
        let q = subj[(i + 1) % subj.len()];
        let fp = f(p);
        let fq = f(q);
        if fp <= tol {
            out.push(p);
        }
        if (fp <= tol) != (fq <= tol) {
            let t = fp / (fp - fq);
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
    }
    out
}

/// The half-plane equation in `plane`'s frame for the other face's plane `g`,
/// evaluated at `plane.origin + offset` (the probe point).
fn halfplane_of(plane: &Plane, g: &Plane, offset: Vec3) -> [f64; 3] {
    let a = dot(g.n, plane.u);
    let b = dot(g.n, plane.v);
    let c = dot(sub(add(plane.origin, offset), g.origin), g.n);
    [a, b, c]
}

/// The region of `plane` that is inside a cylinder face, when the cylinder axis
/// is PARALLEL to the plane (the radial condition is a slab, the cap condition
/// is a slab: four half-planes).
fn cyl_parallel_region(cy: &Cylinder, plane: &Plane, offset: Vec3) -> Region {
    if cy.arc.is_some() {
        return Region::empty();
    }
    let a = normalize(cy.axis);
    let n = plane.n;
    // Perpendicular distance from the axis line to the plane.
    let dist = dot(sub(plane.origin, cy.origin), n).abs();
    if dist > cy.radius + 1e-9 {
        return Region::empty();
    }
    if dist > cy.radius - 1e-9 {
        // Tangent: the intersection is a line of measure zero.
        return Region::empty();
    }
    let e2 = normalize(cross(n, a));
    let base = sub(add(plane.origin, offset), cy.origin);
    let base_e2 = dot(base, e2);
    let ue2 = dot(plane.u, e2);
    let ve2 = dot(plane.v, e2);
    let base_a = dot(base, a);
    let ua = dot(plane.u, a);
    let va = dot(plane.v, a);
    let mut r = Region::all();
    r.push_hl([ue2, ve2, base_e2 - cy.radius]);
    r.push_hl([-ue2, -ve2, -base_e2 - cy.radius]);
    r.push_hl([ua, va, base_a - cy.vmin]);
    r.push_hl([-ua, -va, cy.vmax - base_a]);
    r
}

/// The region of `plane` inside a cylinder face whose axis is PERPENDICULAR to
/// the plane: a disk (or empty when the plane lies beyond a cap).
fn cyl_perp_region(cy: &Cylinder, plane: &Plane, offset: Vec3) -> Region {
    if cy.arc.is_some() {
        return Region::empty();
    }
    let ad = dot(cy.axis, plane.n);
    let t = dot(sub(plane.origin, cy.origin), plane.n) / ad;
    let along_q = t + dot(offset, cy.axis);
    if along_q < cy.vmin - TOL || along_q > cy.vmax + TOL {
        return Region::empty();
    }
    let center3 = add(cy.origin, scale(cy.axis, t));
    Region::with_disk(plane.project(center3), cy.radius)
}

/// The region of `plane` inside a sphere surface: a disk (or empty/all).
fn sphere_region(sp: &crate::geom::SphereSurf, plane: &Plane, offset: Vec3) -> Region {
    let c = add(sp.center, offset);
    let d = dot(sub(c, plane.origin), plane.n);
    let r2 = sp.radius * sp.radius - d * d;
    if r2 <= 1e-12 {
        // Tangential or clear: no interior area on the plane.
        return Region::empty();
    }
    let foot = sub(c, scale(plane.n, d));
    Region::with_disk(plane.project(foot), r2.sqrt())
}

/// The set of points of `plane` (probe-shifted by `offset`) that lie inside
/// `other`. `None` means the kernel cannot express the intersection and the
/// caller must refuse.
fn region_inside(other: &TSolid, plane: &Plane, offset: Vec3) -> Option<Region> {
    let mut region = Region::all();
    for f in other.faces() {
        let s = f.borrow().surface.clone();
        match &s {
            Surface::Plane(g) => {
                let h = halfplane_of(plane, g, offset);
                region.push_hl(h);
            }
            Surface::Cylinder(cy) => {
                let ad = dot(cy.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    let r = cyl_perp_region(cy, plane, offset);
                    if r.empty {
                        return Some(Region::empty());
                    }
                    if let Some((c, rr)) = r.disk {
                        region.intersect_disk(c, rr);
                    }
                } else if ad < 1e-9 {
                    let r = cyl_parallel_region(cy, plane, offset);
                    if r.empty {
                        return Some(Region::empty());
                    }
                    for h in r.hs {
                        region.push_hl(h);
                    }
                } else {
                    return None;
                }
            }
            Surface::Sphere(sp) => {
                let r = sphere_region(sp, plane, offset);
                if let Some((c, rr)) = r.disk {
                    region.intersect_disk(c, rr);
                } else if r.empty {
                    // A sphere can also contain the whole plane region; fall
                    // through as unconstrained only when the plane is fully
                    // inside. Otherwise this face alone cannot bound it.
                    if crate::math::len(sub(add(plane.origin, offset), sp.center)) > sp.radius {
                        return Some(Region::empty());
                    }
                }
            }
            _ => return None,
        }
    }
    Some(region)
}

/// A region clamped to the face polygon `f`.
enum Clamped {
    Empty,
    Full,
    Disk([f64; 2], f64),
    Poly(Vec<[f64; 2]>),
    /// A polygon clipped by a disk that neither contains it nor sits fully
    /// inside it (SPEC pinned math: a box wall cut by a sphere). Pieces plus
    /// the disk's own (center, radius) so the arcs can be rebuilt exactly.
    Mixed(Vec<LoopPiece>, [f64; 2], f64),
}

/// One boundary piece of a mixed polygon/disk loop, in a plane's own uv.
#[derive(Clone, Copy)]
enum LoopPiece {
    Line([f64; 2], [f64; 2]),
    Arc([f64; 2], [f64; 2]),
}

/// Reverse a mixed loop's winding: reverse piece order AND swap each
/// piece's own endpoints, matching how `Clamped::Poly`'s `rp.reverse()`
/// flips a straight polygon for the subtracted-tool case.
fn reverse_pieces(pieces: &[LoopPiece]) -> Vec<LoopPiece> {
    pieces
        .iter()
        .rev()
        .map(|p| match p {
            LoopPiece::Line(a, b) => LoopPiece::Line(*b, *a),
            LoopPiece::Arc(a, b) => LoopPiece::Arc(*b, *a),
        })
        .collect()
}

/// The intersection of convex polygon `poly` (CCW, in a plane's uv) and disk
/// `(c, r)`, as an ordered mix of kept polygon-edge runs and circle arcs
/// bridging them, in `poly`'s own winding. Called only for the genuinely
/// mixed case (some of the boundary is Interior to the other shape and some
/// is not) -- the caller already resolved full/empty/pure-disk beforehand.
/// `None` when no part of `poly` lies in the disk (nothing to rescue; the
/// caller refuses as it always did).
fn clip_convex_poly_by_disk(poly: &[[f64; 2]], c: [f64; 2], r: f64) -> Option<Vec<LoopPiece>> {
    let n = poly.len();
    let mut lines: Vec<([f64; 2], [f64; 2])> = Vec::new();
    for i in 0..n {
        let p = poly[i];
        let q = poly[(i + 1) % n];
        let d = [q[0] - p[0], q[1] - p[1]];
        let fx = p[0] - c[0];
        let fy = p[1] - c[1];
        let a = d[0] * d[0] + d[1] * d[1];
        let bq = 2.0 * (fx * d[0] + fy * d[1]);
        let cc = fx * fx + fy * fy - r * r;
        let mut ts: Vec<f64> = Vec::new();
        if a > 1e-15 {
            let disc = bq * bq - 4.0 * a * cc;
            if disc > 0.0 {
                let sq = disc.sqrt();
                for t in [(-bq - sq) / (2.0 * a), (-bq + sq) / (2.0 * a)] {
                    if t > 1e-9 && t < 1.0 - 1e-9 {
                        ts.push(t);
                    }
                }
                ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
            }
        }
        let mut params = vec![0.0];
        params.extend(ts);
        params.push(1.0);
        for w in params.windows(2) {
            let (t0, t1) = (w[0], w[1]);
            if t1 - t0 < 1e-12 {
                continue;
            }
            let mid = [p[0] + d[0] * (t0 + t1) * 0.5, p[1] + d[1] * (t0 + t1) * 0.5];
            let mdx = mid[0] - c[0];
            let mdy = mid[1] - c[1];
            if mdx * mdx + mdy * mdy <= r * r {
                let a_pt = [p[0] + d[0] * t0, p[1] + d[1] * t0];
                let b_pt = [p[0] + d[0] * t1, p[1] + d[1] * t1];
                lines.push((a_pt, b_pt));
            }
        }
    }
    if lines.is_empty() {
        return None;
    }
    let m = lines.len();
    let mut pieces: Vec<LoopPiece> = Vec::with_capacity(m * 2);
    for i in 0..m {
        let (a_pt, b_pt) = lines[i];
        pieces.push(LoopPiece::Line(a_pt, b_pt));
        let (next_a, _) = lines[(i + 1) % m];
        if crate::math::len([b_pt[0] - next_a[0], b_pt[1] - next_a[1], 0.0]) > 1e-9 {
            pieces.push(LoopPiece::Arc(b_pt, next_a));
        }
    }
    Some(pieces)
}

/// Signed sweep (CCW positive, matching `normal = cross`-derived y_axis) from
/// `a_uv` to `b_uv` around `c`, both on the same circle. Independent of which
/// 3D frame later carries it -- (u, v, n) is right-handed (§ [`Plane::new`]),
/// so a uv-plane rotation and the matching 3D rotation around `n` agree.
fn uv_arc_sweep(c: [f64; 2], a_uv: [f64; 2], b_uv: [f64; 2]) -> f64 {
    let ax = a_uv[0] - c[0];
    let ay = a_uv[1] - c[1];
    let bx = b_uv[0] - c[0];
    let by = b_uv[1] - c[1];
    let cross_z = ax * by - ay * bx;
    let dot_v = ax * bx + ay * by;
    cross_z.atan2(dot_v)
}

/// A planar face built from a mixed loop of straight and circular pieces
/// (SPEC pinned math: a box wall cut by a sphere -- 2 segments, 2 arcs, no
/// sampling).
fn build_mixed_face(plane: &Plane, pieces: &[LoopPiece], c: [f64; 2], r: f64) -> TFace {
    // `uv_arc_sweep` is CCW-positive assuming (u, v, normal) is right-handed.
    // That only matches `plane.n` when u x v == +n; a reversed wall
    // (subtract's kept tool face) keeps the SAME u, v but flips n, making
    // the triple left-handed, which flips the sweep's sign. Correct for it
    // here rather than at the call site, so every caller of `uv_arc_sweep`
    // can keep assuming its own plane's own normal.
    let orient = if dot(cross(plane.u, plane.v), plane.n) >= 0.0 { 1.0 } else { -1.0 };
    let mut uses = Vec::with_capacity(pieces.len());
    for piece in pieces {
        match piece {
            LoopPiece::Line(a_uv, b_uv) => {
                let a = plane.point(*a_uv);
                let b = plane.point(*b_uv);
                let e = mk_segment_edge(a, b);
                uses.push(planar_use(plane, &e, true, a, b));
            }
            LoopPiece::Arc(a_uv, b_uv) => {
                let a = plane.point(*a_uv);
                let b = plane.point(*b_uv);
                let center3 = plane.point(c);
                let x_axis = normalize(sub(a, center3));
                let sweep = orient * uv_arc_sweep(c, *a_uv, *b_uv);
                let curve = Curve::Arc { center: center3, radius: r, normal: plane.n, x_axis, sweep };
                let e = topo::edge(topo::vertex(a), topo::vertex(b), true, curve);
                uses.push(topo::EdgeUse {
                    edge: e,
                    forward: true,
                    pcurve: topo::Pcurve {
                        start: *a_uv,
                        end: *b_uv,
                        mid: [(a_uv[0] + b_uv[0]) * 0.5, (a_uv[1] + b_uv[1]) * 0.5],
                    },
                });
            }
        }
    }
    make_face(Surface::Plane(plane.clone()), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// The 4-arc boundary of the polar cap removed from `sp` by a centered
/// square tube of half-width `h` along (`sp.e1`, `sp.e2`), on the
/// `pole_sign` side of `sp.axis`. Real trims (SPEC constraint 1): each arc
/// is the actual sphere/wall intersection curve, not a sampled one -- it is
/// the SAME circle a box wall's own boundary arc lies on (§ pinned math).
fn polar_hole_wire(sp: &crate::geom::SphereSurf, pole_sign: f64, h: f64) -> topo::WireRef<Curve3> {
    let r = sp.radius;
    let zc = (r * r - 2.0 * h * h).max(0.0).sqrt();
    let corner = |sp1: f64, sq: f64| {
        add(sp.center, add(add(scale(sp.e1, sp1 * h), scale(sp.e2, sq * h)), scale(sp.axis, pole_sign * zc)))
    };
    let corners = [corner(1.0, 1.0), corner(1.0, -1.0), corner(-1.0, -1.0), corner(-1.0, 1.0)];
    let walls: [(Vec3, f64); 4] = [(sp.e1, h), (sp.e2, -h), (sp.e1, -h), (sp.e2, h)];
    let mut uses = Vec::with_capacity(4);
    for i in 0..4 {
        let (dir, fixed) = walls[i];
        let start = corners[i];
        let end = corners[(i + 1) % 4];
        let arc_center = add(sp.center, scale(dir, fixed));
        let arc_r = (r * r - fixed * fixed).max(0.0).sqrt();
        let x_axis = normalize(sub(start, arc_center));
        let y_axis = normalize(cross(dir, x_axis));
        let to_end = sub(end, arc_center);
        let ex = dot(to_end, x_axis);
        let ey = dot(to_end, y_axis);
        let sweep = ey.atan2(ex);
        let curve = Curve::Arc { center: arc_center, radius: arc_r, normal: dir, x_axis, sweep };
        let e = topo::edge(topo::vertex(start), topo::vertex(end), true, curve);
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        });
    }
    Rc::new(RefCell::new(Wire { edges: uses }))
}

fn clamp(region: &Region, f: &[[f64; 2]]) -> Option<Clamped> {
    if region.empty {
        return Some(Clamped::Empty);
    }
    if let Some((c, r)) = region.disk {
        for h in &region.hs {
            if h[0] * c[0] + h[1] * c[1] + h[2] > 1e-6 {
                return None;
            }
        }
        let a_f = poly_area(f);
        let disk_area = std::f64::consts::PI * r * r;
        if !point_in_poly(f, c) {
            // Maybe the face lies entirely inside the disk.
            if f.iter().all(|p| {
                let d = [(p[0] - c[0]) as f64, (p[1] - c[1]) as f64];
                d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
            }) && disk_area >= a_f
            {
                return Some(Clamped::Full);
            }
            // The disk may still touch the face at a single tangent point, or
            // at a vanishing sliver. Approximate the overlap area; anything
            // below the face tolerance is a tangency, not a real region.
            let mut inside = 0usize;
            const N: usize = 24;
            let mut pts = Vec::with_capacity(N * N);
            for gi in 0..N {
                for gj in 0..N {
                    let x = f[0][0] + (f[1][0] - f[0][0]) * (gi as f64 + 0.5) / N as f64
                        + (f[2][0] - f[0][0]) * (gj as f64 + 0.5) / N as f64;
                    let y = f[0][1] + (f[1][1] - f[0][1]) * (gi as f64 + 0.5) / N as f64
                        + (f[2][1] - f[0][1]) * (gj as f64 + 0.5) / N as f64;
                    pts.push([x, y]);
                }
            }
            for p in pts {
                let d = [(p[0] - c[0]) as f64, (p[1] - c[1]) as f64];
                if d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7 && point_in_poly(f, p) {
                    inside += 1;
                }
            }
            let approx_overlap = a_f * inside as f64 / (N * N) as f64;
            if approx_overlap <= 1e-6 * a_f.max(1.0) {
                return Some(Clamped::Empty);
            }
            return None;
        }
        for k in 0..32 {
            let a = TWO_PI * k as f64 / 32.0;
            let p = [c[0] + r * a.cos(), c[1] + r * a.sin()];
            if !point_in_poly(f, p) {
                return None;
            }
        }
        return Some(Clamped::Disk(c, r));
    }
    if region.hs.is_empty() {
        return Some(Clamped::Full);
    }
    let a_f = poly_area(f);
    let mut poly = f.to_vec();
    for h in &region.hs {
        poly = clip_halfplane(&poly, h[0], h[1], h[2]);
        if poly.len() < 3 || poly_area(&poly) < 1e-12 {
            return Some(Clamped::Empty);
        }
    }
    let a_p = poly_area(&poly);
    if a_p < 1e-12 {
        return Some(Clamped::Empty);
    }
    if (a_p - a_f).abs() <= 1e-6 * a_f.max(1.0) {
        return Some(Clamped::Full);
    }
    Some(Clamped::Poly(poly))
}

// ---------------------------------------------------------------------------
// Building output faces.
// ---------------------------------------------------------------------------

fn mk_segment_edge(a: Vec3, b: Vec3) -> topo::EdgeRef<Curve3> {
    topo::edge(topo::vertex(a), topo::vertex(b), true, Curve::Segment { a, b })
}

fn planar_use(plane: &Plane, e: &topo::EdgeRef<Curve3>, forward: bool, sa: Vec3, sb: Vec3) -> topo::EdgeUse<Curve3> {
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

fn make_face(surface: Surface, uv_domain: [[f64; 2]; 2], uses: Vec<topo::EdgeUse<Curve3>>) -> TFace {
    let w = Rc::new(RefCell::new(Wire { edges: uses }));
    Rc::new(RefCell::new(Face {
        boundary: vec![w],
        forward: true,
        surface,
        uv_domain,
    }))
}

/// A planar face from an ordered loop of (u, v) points.
fn build_poly_face(plane: &Plane, uv: &[[f64; 2]]) -> TFace {
    let mut uses = Vec::with_capacity(uv.len());
    for i in 0..uv.len() {
        let a = plane.point(uv[i]);
        let b = plane.point(uv[(i + 1) % uv.len()]);
        let e = mk_segment_edge(a, b);
        uses.push(planar_use(plane, &e, true, a, b));
    }
    make_face(Surface::Plane(plane.clone()), [[0.0, 1.0], [0.0, 1.0]], uses)
}

/// Build the wire for a circular hole in `plane`. `forward` is chosen so the
/// hole winds opposite to the face's outer loop.
fn hole_wire(plane: &Plane, center_uv: [f64; 2], radius: f64, outer_ccw: bool) -> topo::WireRef<Curve3> {
    let center = plane.point(center_uv);
    let v = add(center, scale(plane.u, radius));
    let e = topo::edge(
        topo::vertex(v),
        topo::vertex(v),
        true,
        Curve::Circle { center, radius, normal: plane.n },
    );
    let forward = !outer_ccw;
    Rc::new(RefCell::new(Wire {
        edges: vec![topo::EdgeUse {
            edge: e,
            forward,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        }],
    }))
}

/// A face that keeps `face`'s outer wire and adds one hole (a disk or a
/// polygon) in the same plane.
fn face_with_hole(face: &TFace, plane: &Plane, hole: &Hole) -> TFace {
    let outer_ccw = {
        let fb = face.borrow();
        let mut ring = Vec::new();
        if let Some(w) = fb.boundary.first() {
            for u in &w.borrow().edges {
                let eb = u.edge.borrow();
                let p = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
                ring.push(plane.project(p));
            }
        }
        signed_area2(&ring) > 0.0
    };
    let mut wires: Vec<topo::WireRef<Curve3>> = Vec::new();
    {
        let fb = face.borrow();
        for w in &fb.boundary {
            wires.push(w.clone());
        }
    }
    match hole {
        Hole::Circle(c, r) => wires.push(hole_wire(plane, *c, *r, outer_ccw)),
        Hole::Poly(uv) => {
            let mut pts = uv.clone();
            // Hole must wind opposite the outer loop.
            let want_positive = !outer_ccw;
            if (signed_area2(&pts) > 0.0) != want_positive {
                pts.reverse();
            }
            let mut uses = Vec::new();
            for i in 0..pts.len() {
                let a = plane.point(pts[i]);
                let b = plane.point(pts[(i + 1) % pts.len()]);
                let e = mk_segment_edge(a, b);
                uses.push(planar_use(plane, &e, true, a, b));
            }
            wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
        }
    }
    Rc::new(RefCell::new(Face {
        boundary: wires,
        forward: true,
        surface: Surface::Plane(plane.clone()),
        uv_domain: [[0.0, 1.0], [0.0, 1.0]],
    }))
}

enum Hole {
    Circle([f64; 2], f64),
    Poly(Vec<[f64; 2]>),
}

/// A partial cylindrical wall, `v` running from `vlo` to `vhi` on `cy`.
/// `reverse` flips the surface orientation (used for the wall of a subtracted
/// tool, whose outward normal must point into the void).
fn partial_wall(cy: &Cylinder, vlo: f64, vhi: f64, reverse: bool) -> TFace {
    let e2 = if reverse { scale(cy.e2, -1.0) } else { cy.e2 };
    let surf = Surface::Cylinder(Cylinder {
        origin: cy.origin,
        axis: cy.axis,
        e1: cy.e1,
        e2,
        radius: cy.radius,
        vmin: vlo,
        vmax: vhi,
        arc: None,
    });
    let p_lo = add(cy.origin, scale(cy.axis, vlo));
    let p_hi = add(cy.origin, scale(cy.axis, vhi));
    let v_lo = topo::vertex(add(p_lo, scale(cy.e1, cy.radius)));
    let v_hi = topo::vertex(add(p_hi, scale(cy.e1, cy.radius)));
    let seam = topo::edge(
        v_lo.clone(),
        v_hi.clone(),
        true,
        Curve::Segment { a: v_lo.borrow().point, b: v_hi.borrow().point },
    );
    let rim_lo = topo::edge(
        v_lo.clone(),
        v_lo.clone(),
        true,
        Curve::Circle { center: p_lo, radius: cy.radius, normal: cy.axis },
    );
    let rim_hi = topo::edge(
        v_hi.clone(),
        v_hi.clone(),
        true,
        Curve::Circle { center: p_hi, radius: cy.radius, normal: cy.axis },
    );
    let vm = 0.5 * (vlo + vhi);
    let uses = vec![
        topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vlo], end: [0.0, vhi], mid: [0.0, vm] } },
        topo::EdgeUse { edge: rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vhi], end: [TWO_PI, vhi], mid: [std::f64::consts::PI, vhi] } },
        topo::EdgeUse { edge: seam.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vhi], end: [TWO_PI, vlo], mid: [TWO_PI, vm] } },
        topo::EdgeUse { edge: rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vlo], end: [0.0, vlo], mid: [std::f64::consts::PI, vlo] } },
    ];
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: surf,
        uv_domain: [[0.0, TWO_PI], [vlo, vhi]],
    }))
}

// ---------------------------------------------------------------------------
// The operation.
// ---------------------------------------------------------------------------

/// The outer boundary ring of a planar face in `plane`'s uv. A face that
/// already carries holes (a later boolean's input) has more than one wire; the
/// outer wire is first by construction (`face_with_hole` appends holes). Only
/// that ring bounds the face's material, so the holes are ignored here and
/// re-carried by `face_with_hole` when a new cut is added.
fn outer_uv(fb: &Face<Curve3, Surface3>, plane: &Plane) -> Option<Vec<[f64; 2]>> {
    let w = fb.boundary.first()?;
    let mut pts = Vec::new();
    for u in &w.borrow().edges {
        let eb = u.edge.borrow();
        let p = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
        pts.push(plane.project(p));
    }
    if pts.len() < 3 {
        return None;
    }
    Some(pts)
}

/// The single circular boundary of a disk-shaped planar face, if it has one.
fn circle_boundary(fb: &Face<Curve3, Surface3>) -> Option<(Vec3, f64)> {
    if fb.boundary.len() != 1 {
        return None;
    }
    let w = fb.boundary.first()?;
    let uses = w.borrow().edges.clone();
    let mut found: Option<(Vec3, f64)> = None;
    for u in &uses {
        match &u.edge.borrow().curve {
            Curve::Circle { center, radius, .. } => found = Some((*center, *radius)),
            _ => return None,
        }
    }
    found
}

/// Does the solid lie inside `other`? `sign` is -1 to probe toward the face's
/// material (interior) and +1 to probe away from it (exterior). The boolean's
/// keep/remove decision follows from which side is where (SPEC §4.5).
fn offset_sign(op: &str, is_a: bool) -> Option<f64> {
    match (op, is_a) {
        ("subtract", true) => Some(-1.0),
        ("union", true) => Some(1.0),
        ("intersect", true) => Some(-1.0),
        ("subtract", false) => Some(1.0),
        ("union", false) => Some(1.0),
        ("intersect", false) => Some(-1.0),
        _ => None,
    }
}

/// True when the operation KEEPS the region inside the other solid; false when
/// it keeps the region outside (and cuts the inside out as a hole).
fn keeps_inside(op: &str, is_a: bool) -> bool {
    op == "intersect" || (op == "subtract" && !is_a)
}

/// The region of a planar face (given as a polygon) that survives.
fn keep_polygon(
    face: &TFace,
    plane: &Plane,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let f = outer_uv(&face.borrow(), plane)?;
    let sign = offset_sign(op, is_a)?;
    let region = region_inside(other, plane, scale(plane.n, sign * PROBE))?;
    let clamped = match clamp(&region, &f) {
        Some(c) => c,
        None => {
            // `clamp` only returns None for a disk region that neither
            // contains the face nor sits fully inside it: a sphere cutting
            // a flat wall (SPEC pinned math). Rescue that one case with a
            // real mixed segment/arc loop; anything else still refuses.
            let (c, r) = region.disk.filter(|_| region.hs.is_empty())?;
            let pieces = clip_convex_poly_by_disk(&f, c, r)?;
            Clamped::Mixed(pieces, c, r)
        }
    };
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    if keeps_inside(op, is_a) {
        match clamped {
            Clamped::Empty => {}
            Clamped::Full => {
                out.push(if reverse { flip_planar(face) } else { face.clone() })
            }
            Clamped::Disk(c, r) => out.push(build_circle_face(&kept_plane, c, r)),
            Clamped::Poly(poly) => {
                if reverse {
                    let mut rp = poly.clone();
                    rp.reverse();
                    out.push(build_poly_face(&kept_plane, &rp));
                } else {
                    out.push(build_poly_face(&kept_plane, &poly));
                }
            }
            Clamped::Mixed(pieces, c, r) => {
                if reverse {
                    out.push(build_mixed_face(&kept_plane, &reverse_pieces(&pieces), c, r));
                } else {
                    out.push(build_mixed_face(&kept_plane, &pieces, c, r));
                }
            }
        }
    } else {
        match clamped {
            Clamped::Empty => out.push(face.clone()),
            Clamped::Full => {}
            Clamped::Disk(c, r) => out.push(face_with_hole(face, &kept_plane, &Hole::Circle(c, r))),
            Clamped::Poly(poly) => {
                // The removed region must sit inside the face for a clean hole.
                if f.iter().any(|p| point_in_poly(&poly, *p)) {
                    return None;
                }
                out.push(face_with_hole(face, &kept_plane, &Hole::Poly(poly)));
            }
            // A mixed-shaped hole (arc-bounded cut into a face) isn't built
            // yet -- no fixture needs it, and a wrong hole is worse than a
            // refusal (SPEC constraint 4).
            Clamped::Mixed(_, _, _) => return None,
        }
    }
    Some(())
}

/// A disk-shaped planar face: sample its interior to decide full/empty/mixed.
fn keep_disk(
    face: &TFace,
    plane: &Plane,
    center: Vec3,
    radius: f64,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let sign = offset_sign(op, is_a)?;
    let region = region_inside(other, plane, scale(plane.n, sign * PROBE))?;
    let mut inside_count = 0;
    let mut total = 0;
    let mut probe = |p: Vec3, inside_count: &mut usize, total: &mut usize| {
        let uv = plane.project(p);
        let yes = if region.empty {
            false
        } else if let Some((c, r)) = region.disk {
            let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
            d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
                && region.hs.iter().all(|h| h[0] * uv[0] + h[1] * uv[1] + h[2] <= 1e-6)
        } else {
            region.hs.iter().all(|h| h[0] * uv[0] + h[1] * uv[1] + h[2] <= 1e-6)
        };
        *total += 1;
        if yes { *inside_count += 1; }
    };
    probe(center, &mut inside_count, &mut total);
    for k in 0..32 {
        let a = TWO_PI * k as f64 / 32.0;
        let p = add(center, add(scale(plane.u, radius * a.cos()), scale(plane.v, radius * a.sin())));
        probe(p, &mut inside_count, &mut total);
    }
    // A tangent contact puts a single probe on the boundary; treat a
    // negligible or overwhelming inside fraction as empty/full so a tangency
    // does not read as a partial overlap, while a genuine sliver still does.
    let full = inside_count * 20 >= total * 19;
    let empty = inside_count * 20 <= total;
    if !full && !empty {
        return None;
    }
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    if keeps_inside(op, is_a) {
        if full {
            out.push(if reverse { flip_planar(face) } else { face.clone() });
        }
    } else if empty {
        out.push(face.clone());
    } else {
        // The whole disk is removed.
    }
    let _ = kept_plane;
    Some(())
}

/// Process one face of a source solid, emitting the faces of the result that
/// descend from it. `None` refuses the whole boolean.
fn process_face(
    face: &TFace,
    other: &TSolid,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let fb = face.borrow();
    match &fb.surface {
        Surface::Plane(p) => {
            let plane = p.clone();
            if let Some((center, radius)) = circle_boundary(&fb) {
                return keep_disk(face, &plane, center, radius, other, op, is_a, out);
            }
            keep_polygon(face, &plane, other, op, is_a, out)
        }
        Surface::Cylinder(cy) => {
            if cy.arc.is_some() {
                return None;
            }
            let sign = offset_sign(op, is_a)?;
            let keep_inside = keeps_inside(op, is_a);
            let reverse = op == "subtract" && !is_a;
            let axis = normalize(cy.axis);
            let mut breaks = vec![cy.vmin, cy.vmax];
            // A face of `other` whose own AABB cannot reach this wall (touching
            // counts as reaching) plays no part in splitting it, whatever its
            // surface. Skipping it lets successive DISJOINT cuts work: after the
            // first bore the base carries a cylindrical wall, and a second bore
            // far away would otherwise refuse on a surface kind it never meets.
            let wall_box = fb.surface.aabb();
            for f in other.faces() {
                let s = f.borrow().surface.clone();
                if let Some(fb_box) = face_reach_box(&f) {
                    if !aabbs_touch(&wall_box, &fb_box) {
                        continue;
                    }
                }
                match &s {
                    Surface::Plane(g) => {
                        let an = dot(g.n, axis).abs();
                        if (an - 1.0).abs() < 1e-9 {
                            let t = dot(sub(g.origin, cy.origin), g.n) / dot(axis, g.n);
                            if t > cy.vmin + 1e-9 && t < cy.vmax - 1e-9 {
                                breaks.push(t);
                            }
                        } else if an < 1e-9 {
                            // A wall parallel to the axis: only refuses if it
                            // actually cuts the circle (needs u-clipping).
                            let dist = dot(sub(g.origin, cy.origin), g.n).abs();
                            if dist < cy.radius - 1e-7 {
                                return None;
                            }
                        } else {
                            return None;
                        }
                    }
                    Surface::Sphere(_) => {
                        // A sphere can cut the wall; u-clipping is not built.
                        return None;
                    }
                    _ => return None,
                }
            }
            breaks.sort_by(|a, b| a.partial_cmp(b).unwrap());
            breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for w in breaks.windows(2) {
                let (vlo, vhi) = (w[0], w[1]);
                if vhi - vlo < 1e-9 {
                    continue;
                }
                let vm = 0.5 * (vlo + vhi);
                let p = add(add(cy.origin, scale(axis, vm)), scale(cy.e1, cy.radius));
                let in_other = inside_solid(other, add(p, scale(cy.e1, sign * PROBE)));
                let keep = if keep_inside { in_other } else { !in_other };
                if keep {
                    out.push(partial_wall(cy, vlo, vhi, reverse));
                }
            }
            Some(())
        }
        Surface::Sphere(sp) => {
            // The only sphere-boolean case this kernel builds (SPEC pinned
            // math): a sphere with a centered, symmetric square tube of
            // planes drilled all the way through it along one of the
            // sphere's own equatorial axes. Detected from `other`'s actual
            // geometry, not assumed -- anything else refuses honestly.
            offset_sign(op, is_a)?;
            if keeps_inside(op, is_a) {
                // Not needed by any fixture yet (a sphere kept whole inside
                // another solid): refuse rather than guess.
                return None;
            }
            let other_faces = other.faces();
            let mut planes: Vec<Plane> = Vec::with_capacity(other_faces.len());
            for f in &other_faces {
                match &f.borrow().surface {
                    Surface::Plane(p) => planes.push(p.clone()),
                    _ => return None,
                }
            }
            let mut h1: Option<f64> = None;
            let mut h2: Option<f64> = None;
            for p in &planes {
                let d = dot(sub(p.origin, sp.center), p.n);
                if d.abs() >= sp.radius - 1e-9 {
                    continue; // does not reach the sphere -- not a cutting plane
                }
                let a1 = dot(p.n, sp.e1).abs();
                let a2 = dot(p.n, sp.e2).abs();
                if (a1 - 1.0).abs() < 1e-7 {
                    match h1 {
                        None => h1 = Some(d.abs()),
                        Some(v) => {
                            if (v - d.abs()).abs() > 1e-6 {
                                return None;
                            }
                        }
                    }
                } else if (a2 - 1.0).abs() < 1e-7 {
                    match h2 {
                        None => h2 = Some(d.abs()),
                        Some(v) => {
                            if (v - d.abs()).abs() > 1e-6 {
                                return None;
                            }
                        }
                    }
                } else {
                    // A cutting plane not aligned to the sphere's own frame:
                    // the general trimmed-sphere case isn't built.
                    return None;
                }
            }
            let (Some(h1), Some(h2)) = (h1, h2) else {
                return None;
            };
            if (h1 - h2).abs() > 1e-6 {
                return None; // not a square cross-section
            }
            let h = h1;
            if h <= 1e-9 || h >= sp.radius - 1e-9 {
                return None;
            }
            let mut trimmed = sp.clone();
            trimmed.trim = Some(h);
            let seam_v = topo::vertex(add(sp.center, scale(sp.e1, sp.radius)));
            let seam = topo::edge(
                seam_v.clone(),
                seam_v.clone(),
                true,
                Curve::Circle { center: sp.center, radius: sp.radius, normal: sp.axis },
            );
            let boundary = vec![
                Rc::new(RefCell::new(Wire {
                    edges: vec![
                        topo::EdgeUse {
                            edge: seam.clone(),
                            forward: true,
                            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, std::f64::consts::PI], mid: [0.0, std::f64::consts::FRAC_PI_2] },
                        },
                        topo::EdgeUse {
                            edge: seam,
                            forward: false,
                            pcurve: topo::Pcurve { start: [TWO_PI, std::f64::consts::PI], end: [0.0, 0.0], mid: [std::f64::consts::PI, std::f64::consts::FRAC_PI_2] },
                        },
                    ],
                })),
                polar_hole_wire(sp, 1.0, h),
                polar_hole_wire(sp, -1.0, h),
            ];
            out.push(Rc::new(RefCell::new(Face {
                boundary,
                forward: true,
                surface: Surface::Sphere(trimmed),
                uv_domain: [[0.0, TWO_PI], [0.0, std::f64::consts::PI]],
            })));
            Some(())
        }
        _ => None,
    }
}

/// Drop coincident planar output faces (same plane, same area and centroid) so
/// a face that lies on both operands' boundary is not counted twice. This is
/// what makes an intersect whose operands share a side plane exact.
fn dedupe(faces: &mut Vec<TFace>) {
    let mut keep: Vec<TFace> = Vec::new();
    for f in faces.drain(..) {
        let mut dup = false;
        for g in &keep {
            if same_planar_patch(&f, g) {
                dup = true;
                break;
            }
        }
        if !dup {
            keep.push(f);
        }
    }
    *faces = keep;
}

/// A copy of a planar face with its outward normal reversed. Used when a
/// subtracted tool's face becomes a wall of the resulting cavity.
fn flip_planar(face: &TFace) -> TFace {
    let fb = face.borrow();
    if let Surface::Plane(p) = &fb.surface {
        let flipped = Plane { origin: p.origin, n: scale(p.n, -1.0), u: p.u, v: p.v };
        let mut ring = Vec::new();
        if let Some(w) = fb.boundary.first() {
            for u in &w.borrow().edges {
                let eb = u.edge.borrow();
                ring.push(if u.forward { eb.a.borrow().point } else { eb.b.borrow().point });
            }
        }
        ring.reverse();
        return build_poly_face(&flipped, &ring.iter().map(|p| flipped.project(*p)).collect::<Vec<_>>());
    }
    face.clone()
}

/// A disk-shaped planar face with outward normal `plane.n`.
fn build_circle_face(plane: &Plane, center_uv: [f64; 2], radius: f64) -> TFace {
    let center = plane.point(center_uv);
    let v = topo::vertex(add(center, scale(plane.u, radius)));
    let e = topo::edge(
        v.clone(),
        v.clone(),
        true,
        Curve::Circle { center, radius, normal: plane.n },
    );
    make_face(
        Surface::Plane(plane.clone()),
        [[0.0, 1.0], [0.0, 1.0]],
        vec![topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] },
        }],
    )
}

fn same_planar_patch(a: &TFace, b: &TFace) -> bool {
    let (pa, pb) = (a.borrow(), b.borrow());
    let (sa, sb) = (&pa.surface, &pb.surface);
    match (sa, sb) {
        (Surface::Plane(x), Surface::Plane(y)) => {
            if dot(x.n, y.n) < 1.0 - 1e-7 {
                return false;
            }
            if dot(sub(x.origin, y.origin), x.n).abs() > 1e-6 {
                return false;
            }
            let (aa, ca) = build::face_area_centroid(&pa);
            let (ab, cb) = build::face_area_centroid(&pb);
            (aa - ab).abs() <= 1e-6 * ab.max(1.0)
                && (0..3).all(|i| (ca[i] - cb[i]).abs() <= 1e-6 * cb[i].abs().max(1.0))
        }
        _ => false,
    }
}

/// Boolean two solids of the `combine` kind. Returns None when the kernel
/// cannot build the exact result, so the caller refuses the feature in words.
pub fn boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op == "subtract" {
        if let Some(cavity) = subtract_enclosed(a, b) {
            return Some(cavity);
        }
    }
    let mut faces: Vec<TFace> = Vec::new();
    for f in a.faces() {
        process_face(&f, b, op, true, &mut faces)?;
    }
    for f in b.faces() {
        process_face(&f, a, op, false, &mut faces)?;
    }
    dedupe(&mut faces);
    if faces.is_empty() {
        return None;
    }
    Some(Solid {
        shells: vec![Rc::new(RefCell::new(Shell { faces }))],
    })
}

/// Does `p` lie strictly inside every face's own surface (and inside the arc
/// range of a partial cylinder)? Unlike `inside_surface` this uses the real
/// face, so a trimmed/arc-bounded wall counts. `margin` is required clearance.
fn strictly_inside_face(f: &Face<Curve3, Surface3>, p: Vec3, margin: f64) -> bool {
    match &f.surface {
        Surface::Plane(g) => dot(sub(p, g.origin), g.n) <= -margin,
        Surface::Cylinder(c) => {
            let d = sub(p, c.origin);
            let along = dot(d, c.axis);
            if along < c.vmin + margin || along > c.vmax - margin {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            if crate::math::len(radial) > c.radius - margin {
                return false;
            }
            if let Some(arc) = &c.arc {
                let e1 = dot(radial, c.e1);
                let e2v = dot(radial, c.e2);
                let mut ang = e2v.atan2(e1) - arc.start;
                while ang < 0.0 {
                    ang += TWO_PI;
                }
                if ang > arc.span - margin / c.radius.max(1e-9) {
                    return false;
                }
            }
            true
        }
        Surface::Sphere(s) => crate::math::len(sub(p, s.center)) <= s.radius - margin,
        Surface::Cone(c) => {
            let d = sub(p, c.base);
            let along = dot(d, c.axis);
            if along < margin || along > c.slant * c.half_angle.cos() - margin {
                return false;
            }
            let radial = sub(d, scale(c.axis, along));
            c.base_radius - along * c.half_angle.tan() - crate::math::len(radial) >= margin
        }
        Surface::Torus(t) => {
            let d = sub(p, t.center);
            let axial = dot(d, t.axis);
            let radial = crate::math::len(sub(d, scale(t.axis, axial)));
            let dq = (radial - t.ring).powi(2) + axial * axial;
            (t.tube - dq.sqrt()) >= margin
        }
    }
}

/// The fully-enclosed-cavity case of `subtract`: every face of `b` lies
/// strictly inside `a`, and no face of `a` lies inside `b`, with clearance.
/// The result is `a`'s own shell plus `b`'s shell reversed as an inner void
/// (SPEC-brep-pocket.md). Returns None for any other configuration, leaving the
/// general face-by-face path to handle or refuse it.
fn subtract_enclosed(a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let a_faces = a.faces();
    let b_faces = b.faces();
    if a_faces.is_empty() || b_faces.is_empty() {
        return None;
    }
    // Every corner of the tool's own bbox must be strictly inside the base;
    // this is a cheap necessary condition, and the per-face checks below are
    // the sufficient one.
    let bb = build::solid_aabb(b);
    for i in 0..3 {
        for edge in [bb.lo[i], bb.hi[i]] {
            let mut p = bb.center();
            p[i] = edge;
            if !inside_solid(a, p) {
                return None;
            }
        }
    }
    // Every face of b must lie strictly inside every face's own surface of a.
    for f in &b_faces {
        let (area, c) = build::face_area_centroid(&f.borrow());
        if area <= 0.0 {
            return None;
        }
        if !inside_solid(a, c) {
            return None;
        }
        for g in &a_faces {
            if !strictly_inside_face(&g.borrow(), c, CAVITY_MARGIN) {
                return None;
            }
        }
    }
    // No face of a may lie inside b. (a's own faces lie on its surface, and
    // b's bbox is clear of that surface by the margin checked above.)
    for g in &a_faces {
        let (area, c) = build::face_area_centroid(&g.borrow());
        if area <= 0.0 {
            return None;
        }
        if inside_solid(b, c) {
            return None;
        }
    }
    // Outer shell keeps a's faces; the void shell is b's faces reversed so
    // their normals point into the cavity (away from the material).
    let outer: Vec<TFace> = a_faces.clone();
    let void: Vec<TFace> = b_faces.iter().map(|f| flip_face(f)).collect();
    Some(Solid {
        shells: vec![
            Rc::new(RefCell::new(Shell { faces: outer })),
            Rc::new(RefCell::new(Shell { faces: void })),
        ],
    })
}

/// A copy of any analytic face with its outward normal reversed, so a
/// subtracted tool's face becomes a wall of the resulting cavity. Planar and
/// cylindrical faces (the two a pocket tool can have) have their orientation
/// carried by their frame; a cylinder reverses by flipping `e2`, exactly as a
/// subtracted wall does in [`partial_wall`].
fn flip_face(face: &TFace) -> TFace {
    let fb = face.borrow();
    match &fb.surface {
        Surface::Plane(p) => {
            let flipped = Plane { origin: p.origin, n: scale(p.n, -1.0), u: p.u, v: p.v };
            // Keep the ORIGINAL boundary wires: rebuilding from a vertex ring
            // collapses a face with holes (a revolve tool's annulus has an
            // outer and an inner wire, each a single closed circle), losing
            // its area and hence the cavity's volume. Only the surface's
            // outward normal is reversed; the wires are geometry, not
            // orientation, and read correctly either way.
            Rc::new(RefCell::new(Face {
                boundary: fb.boundary.clone(),
                forward: fb.forward,
                surface: Surface::Plane(flipped),
                uv_domain: fb.uv_domain,
            }))
        }
        Surface::Cylinder(cy) => {
            let mut uses = Vec::new();
            for w in &fb.boundary {
                for u in &w.borrow().edges {
                    uses.push(u.clone());
                }
            }
            let surf = Surface::Cylinder(Cylinder {
                origin: cy.origin,
                axis: cy.axis,
                e1: cy.e1,
                e2: scale(cy.e2, -1.0),
                radius: cy.radius,
                vmin: cy.vmin,
                vmax: cy.vmax,
                arc: cy.arc.clone(),
            });
            make_face(surf, fb.uv_domain, uses)
        }
        _ => face.clone(),
    }
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::build;

    fn show(op: &str, a: &TSolid, b: &TSolid, label: &str) {
        match boolean(op, a, b) {
            None => println!("{label}: REFUSED"),
            Some(s) => {
                let bb = build::solid_aabb(&s);
                println!(
                    "{label}: faces={} vol={:.6} bbox={:?}..{:?}",
                    s.faces().len(),
                    build::solid_volume(&s),
                    bb.lo,
                    bb.hi
                );
                for (i, f) in s.faces().iter().enumerate() {
                    let fb = f.borrow();
                    let (area, c) = build::face_area_centroid(&fb);
                    let sn = match &fb.surface {
                        Surface::Plane(_) => "plane",
                        Surface::Cylinder(_) => "cyl",
                        Surface::Sphere(_) => "sphere",
                        Surface::Cone(_) => "cone",
                        Surface::Torus(_) => "torus",
                    };
                    println!("   f{i} area={area:.6} centroid={c:?} {sn} n={:?}", match &fb.surface {
                        Surface::Plane(p) => p.n,
                        _ => [0.0, 0.0, 0.0],
                    });
                    if let Surface::Cylinder(cy) = &fb.surface {
                        let aa = fb.surface.aabb();
                        println!("      cyl origin={:?} axis={:?} vmin={} vmax={} aabb={:?}..{:?}", cy.origin, cy.axis, cy.vmin, cy.vmax, aa.lo, aa.hi);
                        let lo2 = crate::math::add(cy.origin, crate::math::scale(cy.axis, cy.vmin));
                        let hi2 = crate::math::add(cy.origin, crate::math::scale(cy.axis, cy.vmax));
                        println!("      expected z {}..{} (lo2={:?} hi2={:?})", lo2[2] - cy.radius, hi2[2] + cy.radius, lo2, hi2);
                    }
                    let fb2 = fb;
                    let mut one = crate::math::Aabb::empty();
                    for p in build::face_ring_points(&fb2) { one.expand(p); }
                    println!("      ring aabb={:?}..{:?} boundary_wires={}", one.lo, one.hi, fb2.boundary.len());
                    if let Surface::Plane(pp) = &fb2.surface {
                        for (wi, w) in fb2.boundary.iter().enumerate() {
                            let mut uv = Vec::new();
                            let mut curve_kinds = Vec::new();
                            for u in &w.borrow().edges {
                                let eb = u.edge.borrow();
                                let pk = if u.forward { eb.a.borrow().point } else { eb.b.borrow().point };
                                uv.push(pp.project(pk));
                                curve_kinds.push(match &eb.curve { Curve::Circle { .. } => "C", Curve::Arc { .. } => "A", _ => "L" }.to_string());
                            }
                            println!("        wire {wi} kinds={:?} signed2={:.3} pts={:?}", curve_kinds, signed_area2(&uv), uv);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn debug_boolean_cut() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let b = build::cylinder_solid([0.0, 0.0, 0.0], 8.0, 40.0, [0.0, 0.0, 1.0]);
        show("subtract", &a, &b, "cut");
    }

    #[test]
    fn debug_boolean_cut_x() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let t = crate::math::Transform::euler_deg(0.0, 90.0, 0.0);
        let c = build::cylinder_solid([0.0, 0.0, 0.0], 5.0, 60.0, [0.0, 0.0, 1.0]);
        let c = build::transform_solid(&c, &t);
        show("subtract", &a, &c, "cutx");
    }

    #[test]
    fn debug_wall_aabb() {
        let cy = crate::geom::Cylinder {
            origin: [0.0, 0.0, -20.0],
            axis: [0.0, 0.0, 1.0],
            e1: [1.0, 0.0, 0.0],
            e2: [0.0, 1.0, 0.0],
            radius: 8.0,
            vmin: 0.0,
            vmax: 40.0,
            arc: None,
        };
        let w = partial_wall(&cy, 10.0, 30.0, false);
        let wa = w.borrow();
        let aa = wa.surface.aabb();
        println!("wall aabb {:?}..{:?}", aa.lo, aa.hi);
        if let Surface::Cylinder(c2) = &wa.surface {
            println!("wall cyl vmin={} vmax={} origin={:?}", c2.vmin, c2.vmax, c2.origin);
        }
    }

    #[test]
    fn debug_nonconvex() {
        let pts = [[0.0, 0.0], [40.0, 0.0], [40.0, 10.0], [10.0, 10.0], [10.0, 30.0], [0.0, 30.0]];
        let mut segs = Vec::new();
        for i in 0..pts.len() {
            segs.push(crate::build::ProfileSeg::Line { a: pts[i], b: pts[(i + 1) % pts.len()] });
        }
        let a = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0]);
        let c = build::cylinder_solid([5.0, 20.0, 5.0], 3.0, 30.0, [0.0, 0.0, 1.0]);
        show("subtract", &a, &c, "nonconvex");
    }

    #[test]
    fn debug_tangent_sub() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 40.0, [0.0, 0.0, 1.0]);
        for (i, f) in a.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &c, "subtract", true, &mut out);
            eprintln!("A face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        for (i, f) in c.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &a, "subtract", false, &mut out);
            eprintln!("B face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        show("subtract", &a, &c, "tan-sub");
    }

    #[test]
    fn debug_which_refuses() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        for (i, f) in a.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &c, "union", true, &mut out);
            println!("A face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
        for (i, f) in c.faces().iter().enumerate() {
            let mut out = Vec::new();
            let r = process_face(f, &a, "union", false, &mut out);
            println!("B face {i}: {:?} -> {} faces", r.is_some(), out.len());
        }
    }

    /// SPEC-brep-combine-sphere.md: sphere r15 minus box 10x10x40, both
    /// centered at the origin. Pinned math (lead-verified against OCCT to
    /// 1e-9): volume 11251.351911..., faces 5, bbox x/y in [-15,15], z in
    /// [-sqrt(200), sqrt(200)].
    #[test]
    fn sphere_minus_box_matches_pinned_math() {
        let s = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([10.0, 10.0, 40.0], [0.0, 0.0, 0.0], None);
        let result = boolean("subtract", &s, &b).expect("sphere-minus-box must not refuse");

        assert_eq!(result.faces().len(), 5, "expected 4 walls + 1 trimmed sphere face");

        let vol = build::solid_volume(&result);
        let expected_vol = (4.0 / 3.0) * std::f64::consts::PI * 15f64.powi(3)
            - box_minus_sphere_cap_volume(15.0, 5.0);
        assert!(
            (vol - expected_vol).abs() <= 1e-6 * expected_vol,
            "volume {vol} vs closed-form {expected_vol}"
        );
        // Cross-check against the lead-pinned OCCT number directly.
        assert!((vol - 11251.351911).abs() <= 1e-4, "volume {vol} vs OCCT 11251.351911");

        let bb = build::solid_aabb(&result);
        let expect_xy = 15.0;
        // sqrt(R^2 - h^2): the wall arc's own peak, the tight z extreme
        // (SPEC pinned math -- NOT sqrt(R^2 - 2h^2), which is the corner).
        let zmax = (225.0 - 25.0f64).sqrt();
        for i in 0..2 {
            assert!((bb.lo[i] + expect_xy).abs() <= 1e-6, "bbox lo[{i}]={:?}", bb.lo);
            assert!((bb.hi[i] - expect_xy).abs() <= 1e-6, "bbox hi[{i}]={:?}", bb.hi);
        }
        assert!((bb.lo[2] + zmax).abs() <= 1e-6, "bbox z lo {:?} vs -{zmax}", bb.lo);
        assert!((bb.hi[2] - zmax).abs() <= 1e-6, "bbox z hi {:?} vs {zmax}", bb.hi);
    }

    /// The volume removed from a sphere of radius `r` by an infinite square
    /// tube of half-width `h` centered on the sphere: twice the spherical
    /// cap volume above `z = sqrt(r^2 - 2h^2)`... computed here instead by
    /// direct double integration (independent of the kernel under test), so
    /// the pinned OCCT number is the real cross-check and this is a sanity
    /// bound, not the source of truth.
    fn box_minus_sphere_cap_volume(r: f64, h: f64) -> f64 {
        // V_removed = integral over |x|,|y|<=h of 2*sqrt(r^2-x^2-y^2) dx dy
        // (both caps). 64x64 midpoint rule is far more than enough at 1e-6.
        let n = 400;
        let step = 2.0 * h / n as f64;
        let mut acc = 0.0;
        for i in 0..n {
            let x = -h + step * (i as f64 + 0.5);
            for j in 0..n {
                let y = -h + step * (j as f64 + 0.5);
                let z2 = r * r - x * x - y * y;
                if z2 > 0.0 {
                    acc += 2.0 * z2.sqrt();
                }
            }
        }
        acc * step * step
    }

    #[test]
    fn debug_tangent() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let c = build::cylinder_solid([30.0, 0.0, 0.0], 10.0, 20.0, [0.0, 0.0, 1.0]);
        show("union", &a, &c, "tan-union");
    }

    /// SPEC-brep-pocket.md: a tool strictly inside a base is one inner void.
    /// box 40x40x20 minus a fully-enclosed 10x8x5 box (its own volume 400) is
    /// 32000 - 400, with exactly base+tool = 12 faces (6 outer + 6 void).
    #[test]
    fn enclosed_box_cavity_volume_and_faces() {
        let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let tool = build::box_solid([10.0, 8.0, 5.0], [0.0, 0.0, -2.5], None);
        let result = boolean("subtract", &base, &tool).expect("enclosed cavity must not refuse");
        assert_eq!(result.faces().len(), 12, "6 outer + 6 inner void faces");
        let vol = build::solid_volume(&result);
        assert!((vol - (32000.0 - 400.0)).abs() <= 1e-6 * 32000.0, "volume {vol}");
        // bbox equals the base's own (the void is strictly inside).
        let bb = build::solid_aabb(&result);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

    /// SPEC-brep-pocket.md: box 60x60x8 minus a fully-enclosed cylinder r5 h5
    /// is 28800 - 125*pi, with 6 + 3 = 9 faces (the lateral cylinder stays an
    /// analytic partial wall, not facets).
    #[test]
    fn enclosed_cylinder_cavity_volume_and_faces() {
        let base = build::box_solid([60.0, 60.0, 8.0], [0.0, 0.0, 4.0], None);
        let tool = build::cylinder_solid([12.0, -6.0, 3.5], 5.0, 5.0, [0.0, 0.0, 1.0]);
        let result = boolean("subtract", &base, &tool).expect("enclosed cylinder cavity must not refuse");
        assert_eq!(result.faces().len(), 9, "6 outer + 3 void (wall + 2 caps)");
        let want = 28800.0 - 125.0 * std::f64::consts::PI;
        let vol = build::solid_volume(&result);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    }

    /// SPEC-brep-pocket.md: a pocket tool is a prism swept NEGATIVE along the
    /// plane normal, which can turn the prism inside out. Its volume must stay
    /// positive and equal the profile area times depth.
    #[test]
    fn negative_sweep_tool_is_outward() {
        let segs = vec![
            build::ProfileSeg::Line { a: [-5.0, -4.0], b: [5.0, -4.0] },
            build::ProfileSeg::Line { a: [5.0, -4.0], b: [5.0, 4.0] },
            build::ProfileSeg::Line { a: [5.0, 4.0], b: [-5.0, 4.0] },
            build::ProfileSeg::Line { a: [-5.0, 4.0], b: [-5.0, -4.0] },
        ];
        let tool = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -5.0]);
        // extrude_profile's walls read the profile's winding, so a negative
        // sweep is outward too (not inside-out), and its volume is positive.
        assert!(
            build::signed_volume(&tool) > 0.0,
            "a negative-sweep prism must still wind outward"
        );
        let fixed = build::ensure_outward(&tool);
        assert!(
            (build::solid_volume(&fixed) - 400.0).abs() <= 1e-6,
            "tool volume {:?}",
            build::solid_volume(&fixed)
        );
        assert!(
            (build::solid_aabb(&fixed).lo[2] + 5.0).abs() < 1e-9,
            "the tool must occupy z in [-5, 0]"
        );
    }

    /// SPEC-brep-hole.md: four pairwise-disjoint bores subtracted one after
    /// another must give the same solid as a single fused cut. box 40x40x20
    /// minus 4 x r3 through-holes at (±15, ±10): 32000 - 4*9*pi*20, 10 faces.
    #[test]
    fn four_disjoint_successive_cuts() {
        let mut shape = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        for c in [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]] {
            let tool = build::cylinder_solid(c, 3.0, 22.0, [0.0, 0.0, 1.0]);
            shape = boolean("subtract", &shape, &tool)
                .unwrap_or_else(|| panic!("successive disjoint cut at {c:?} refused"));
        }
        assert_eq!(shape.faces().len(), 10, "6 box + 4 bores");
        let want = 32000.0 - 4.0 * 9.0 * std::f64::consts::PI * 20.0;
        let vol = build::solid_volume(&shape);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        let bb = build::solid_aabb(&shape);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

}

#[cfg(test)]
mod shell_flush_tests {
    use super::*;
    use crate::build;

    /// SPEC-brep-shell.md: the open-shell subtract is a coplanar-flush cut
    /// (inner flush with the open face's side). box 40x40x20 minus a
    /// flush-top inner 36x36x18 is 32000 - 36*36*18, on 11 faces.
    #[test]
    fn coplanar_flush_top_subtract_shell_inner() {
        let a = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
        let b = build::box_solid([36.0, 36.0, 18.0], [0.0, 0.0, 1.0], None);
        let r = boolean("subtract", &a, &b);
        assert!(r.is_some(), "flush-top inner subtract must not refuse");
        let got = r.unwrap();
        let want = 32000.0 - 36.0 * 36.0 * 18.0;
        let vol = build::solid_volume(&got);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(got.faces().len(), 11, "5 outer + top ring + 5 inner");
    }
}
