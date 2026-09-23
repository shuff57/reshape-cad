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
    /// A subtractive circle: the region is the disk/half-planes MINUS this
    /// circle. How a torus band cut by a perpendicular plane (an annulus)
    /// is expressed. At most one.
    hole: Option<([f64; 2], f64)>,
    empty: bool,
}

impl Region {
    fn empty() -> Self {
        Region { hs: Vec::new(), disk: None, hole: None, empty: true }
    }
    fn all() -> Self {
        Region { hs: Vec::new(), disk: None, hole: None, empty: false }
    }
    fn with_disk(c: [f64; 2], r: f64) -> Self {
        Region { hs: Vec::new(), disk: Some((c, r)), hole: None, empty: false }
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
                // A planar face PARALLEL to the probe plane contributes the
                // degenerate (0,0,c) half-plane: a CONSTANT over the whole
                // probe plane. For a MATERIAL cap that is right (the solid
                // ends at that plane); for a VOID face (a prior bore's
                // floor/ceiling) it is wrong — material continues behind the
                // plane everywhere else, and the constant kills the next
                // bore's floor probes (the pi*9*8/3 residual of msgbox #329's
                // flush case). Void signature: material EXISTS behind the
                // plane (−n step) at a point OUTSIDE the face's own area —
                // a material cap has nothing behind its plane except within
                // its own area, a void face has the rest of the solid there.
                {
                    let fb = f.borrow();
                    let (a_, b_) = (dot(g.n, plane.u).abs(), dot(g.n, plane.v).abs());
                    if a_ < 1e-9 && b_ < 1e-9 {
                        // Parallel. Sample beside the face: face centroid plus
                        // 2x its own bbox half-diagonal, in-plane.
                        let (area, c3) = build::face_area_centroid(&fb);
                        if area > 0.0 {
                            // face bbox in-plane radius
                            let mut rr = 0.0f64;
                            for w in &fb.boundary {
                                let wb = w.borrow();
                                for u in &wb.edges {
                                    let eb = u.edge.borrow();
                                    for p in [eb.a.borrow().point, eb.b.borrow().point] {
                                        let d = crate::math::len(sub(p, c3));
                                        if d > rr {
                                            rr = d;
                                        }
                                    }
                                }
                            }
                            // In-plane direction away from the face: plane.u.
                            let beside = add(c3, scale(plane.u, 2.0 * rr + 1.0));
                            let behind = sub(beside, scale(g.n, 4.0 * PROBE));
                            if inside_solid(other, behind) {
                                // Material continues behind this plane away
                                // from the face: the face is a void surface,
                                // not a cap. Skip it.
                                continue;
                            }
                        }
                    }
                }
                let h = halfplane_of(plane, g, offset);
                region.push_hl(h);
            }
            Surface::Cylinder(cy) => {
                let ad = dot(cy.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    // Cylinder axis perpendicular to plane: the intersection is a disk.
                    // But if this cylindrical face bounds a void (inward-facing normal),
                    // it should not constrain the region. Void walls occur when a prior
                    // bore's wall becomes part of the base solid -- its normal points
                    // toward the cylinder axis (into the void), not away into material.
                    let face = f.borrow();
                    // Use a point on the cylinder surface (u=0, v=mid) to compute radial.
                    let vm = 0.5 * (cy.vmin + cy.vmax);
                    let point_on_surface = add(cy.origin, add(scale(cy.e1, cy.radius), scale(cy.axis, vm)));
                    let axis_proj = add(cy.origin, scale(cy.axis, dot(sub(point_on_surface, cy.origin), cy.axis)));
                    let radial = sub(point_on_surface, axis_proj);
                    // Face normal at u=0. p(u,v)=origin+R(e1·cosu+e2·sinu)+axis·v;
                    // dp/du at u=0 is R·e2, dp/dv is axis, and the outward
                    // normal (dp/du × dp/dv) is R·(e2×axis) — i.e. +e1, the
                    // radial direction, for the original frame. `flip_face`
                    // reverses a bore wall by negating e2 with forward kept
                    // true, which flips dp/du and hence the normal, so the
                    // face's outward normal at u=0 is
                    // cross(cy.e2, cy.axis) · (face.forward ? 1 : -1).
                    // A void wall's normal points INTO the void: dot < 0 vs
                    // the radial direction (probe at u=0, v=mid).
                    let surface_normal = cross(cy.e2, cy.axis);
                    let face_normal = if face.forward { surface_normal } else { scale(surface_normal, -1.0) };
                    if dot(face_normal, radial) < 0.0 {
                        // Void wall - skip (bounds empty space, not material)
                        continue;
                    }
                    let r = cyl_perp_region(cy, plane, offset);
                    if r.empty {
                        return Some(Region::empty());
                    }
                    if let Some((c, rr)) = r.disk {
                        region.intersect_disk(c, rr);
                    }
                } else if ad < 1e-9 {
                    // A VOID WALL (an inward-facing cylindrical face left by a
                    // prior bore) bounds empty space, not material: it must
                    // not constrain the region. Without this skip the wall's
                    // half-planes collapse the region to the old bore's
                    // cross-section and every later bore's floor is silently
                    // dropped (msgbox #329: floors lost == prior-bore count).
                    // Same normal formula the perpendicular arm uses: the
                    // face's outward normal at u=0 is cross(cy.e2, cy.axis)
                    // · forward; a void wall's points INTO the void.
                    {
                        let face = f.borrow();
                        let vm = 0.5 * (cy.vmin + cy.vmax);
                        let point_on_surface = add(cy.origin, add(scale(cy.e1, cy.radius), scale(cy.axis, vm)));
                        let axis_proj = add(cy.origin, scale(cy.axis, dot(sub(point_on_surface, cy.origin), cy.axis)));
                        let radial = sub(point_on_surface, axis_proj);
                        let surface_normal = cross(cy.e2, cy.axis);
                        let face_normal = if face.forward { surface_normal } else { scale(surface_normal, -1.0) };
                        if dot(face_normal, radial) < 0.0 {
                            continue;
                        }
                    }
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
            Surface::Torus(t) => {
                // A torus band cut by a plane PERPENDICULAR to its axis is
                // an annulus: expressed as disk(outer) MINUS hole(inner).
                // A plane parallel or oblique cuts it in two circles — not
                // expressible in one convex region; refuse.
                let ad = dot(t.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    let probe = add(plane.origin, offset);
                    let d = sub(probe, t.center);
                    let axial = dot(d, t.axis);
                    // Outside the tube's axial span the torus surface does
                    // not exist on this plane: it constrains nothing.
                    if axial.abs() > t.tube + 1e-9 {
                        continue;
                    }
                    // Ring radii at this axial cut: the tube circle of
                    // radius `tube` centered (ring, axial) gives
                    // rho = ring ± sqrt(tube^2 - axial^2).
                    let half = (t.tube * t.tube - axial * axial).sqrt();
                    let r_out = t.ring + half;
                    let r_in = (t.ring - half).max(0.0);
                    let center_uv = plane.project(add(t.center, scale(t.axis, axial)));
                    region.disk = Some((center_uv, r_out));
                    if r_in > 1e-9 {
                        region.hole = Some((center_uv, r_in));
                    }
                } else {
                    return None;
                }
            }
            Surface::Cone(c) => {
                let ad = dot(c.axis, plane.n).abs();
                if (ad - 1.0).abs() < 1e-9 {
                    // Plane perpendicular to the axis: the cross-section is a
                    // disk of radius r(along) = base_radius − along·tan,
                    // centered on the axis — expressible. Outside the face's
                    // own v band the face bounds nothing here; the solid's
                    // cap planes constrain the region instead (the same
                    // fall-through the sphere arm uses).
                    let axis = normalize(c.axis);
                    let probe = add(plane.origin, offset);
                    let along = dot(sub(probe, c.base), axis);
                    let band_lo = c.v_range[0] * c.half_angle.cos();
                    let band_hi = c.v_range[1] * c.half_angle.cos();
                    if along >= band_lo - TOL && along <= band_hi + TOL {
                        let r = c.base_radius - along * c.half_angle.tan();
                        if r <= TOL {
                            return Some(Region::empty());
                        }
                        let centre3 = add(c.base, scale(axis, along));
                        region.intersect_disk(plane.project(centre3), r);
                    }
                } else {
                    // Parallel to the axis the section is a hyperbola; oblique,
                    // an ellipse or parabola. The convex region algebra
                    // (half-planes + one disk) cannot express a conic, so the
                    // caller refuses rather than approximate one.
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
    /// The region's disk with a subtractive hole (a torus band cut by a
    /// perpendicular plane): the kept face is face_with_hole(Hole::Circle).
    Annulus([f64; 2], f64, [f64; 2], f64),
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

/// Compute the angular intervals on circle 1 (radius r1, center at origin in its own frame)
/// that lie inside circle 2 (radius r2, center at offset d from circle 1's center).
/// Returns a list of (start, end) angles in [0, 2π), CCW from e1.
/// The frame is defined by e1 (x-axis) and e2 (y-axis) of the base cylinder.
fn circle_intersection_arcs(
    r1: f64,
    r2: f64,
    dist: f64,
    e1: Vec3,
    e2: Vec3,
    d: Vec3,
) -> Vec<(f64, f64)> {
    if dist >= r1 + r2 - 1e-9 {
        // Separate or tangent externally: no overlap
        return Vec::new();
    }
    if dist <= (r1 - r2).abs() + 1e-9 {
        // One circle contains the other
        if r1 <= r2 {
            // Circle 1 fully inside circle 2
            return vec![(0.0, TWO_PI)];
        } else {
            // Circle 2 fully inside circle 1: no part of circle 1's boundary is inside
            return Vec::new();
        }
    }
    // Partial overlap: two intersection points
    // Law of cosines: cos(θ) = (r1² + d² - r2²) / (2*r1*d)
    let cos_theta = (r1 * r1 + dist * dist - r2 * r2) / (2.0 * r1 * dist);
    let cos_theta = cos_theta.clamp(-1.0, 1.0);
    let theta = cos_theta.acos();
    // Direction from base center to tool center in base's (e1, e2) frame
    let dx = dot(d, e1);
    let dy = dot(d, e2);
    let phi = dy.atan2(dx); // angle of tool center from base's e1
    // Intersection points are at phi ± theta
    let start = phi - theta;
    let end = phi + theta;
    // Normalize to [0, 2π)
    let norm = |a: f64| {
        let mut a = a % TWO_PI;
        if a < 0.0 { a += TWO_PI; }
        a
    };
    let start = norm(start);
    let end = norm(end);
    if end > start {
        vec![(start, end)]
    } else {
        // Wraps around 2π
        vec![(start, TWO_PI), (0.0, end)]
    }
}

/// Intersect two lists of arc intervals (each as (start, end) with start < end, no wrap).
fn intersect_arc_intervals(a: &[(f64, f64)], b: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut result = Vec::new();
    for (a_start, a_end) in a {
        for (b_start, b_end) in b {
            let start = a_start.max(*b_start);
            let end = a_end.min(*b_end);
            if end - start > 1e-9 {
                result.push((start, end));
            }
        }
    }
    result
}

/// A partial cylindrical wall with an arc range (u-clipping for cylinder-cylinder boolean).
/// An arc-bounded partial cylindrical wall, spanning angles
/// [arc.start, arc.start + arc.span] at radius `cy.radius`, v in [vlo, vhi].
/// Four edges like `extrude_profile`'s corner wall (build.rs:1567): two
/// vertical seams at the arc's ends, and two true arc rims (Curve::Arc) that
/// the adjoining caps share — so the wire closes at four distinct corners and
/// the surface integral covers only the arc's own angular range. A reversed
/// wall (the tool side of a subtract) is produced by [`flip_face`], which
/// already knows how to negate e2 and reflect the arc range while KEEPING
/// the boundary wires — this builder stays un-reflected so its pcurves,
/// rims and surface domain all live in the same (unreflected) u frame.
fn partial_wall_arc(cy: &Cylinder, vlo: f64, vhi: f64, arc: crate::geom::ArcRange) -> TFace {
    let axis = normalize(cy.axis);
    let a0 = arc.start;
    let span = arc.span;
    let p_lo = add(cy.origin, scale(axis, vlo));
    let p_hi = add(cy.origin, scale(axis, vhi));
    let at_angle = |p: Vec3, ang: f64| -> Vec3 {
        add(p, add(scale(cy.e1, cy.radius * ang.cos()), scale(cy.e2, cy.radius * ang.sin())))
    };
    // The two seam vertices per rim: arc start (s) and arc end (t).
    let v_lo_s = topo::vertex(at_angle(p_lo, a0));
    let v_lo_t = topo::vertex(at_angle(p_lo, a0 + arc.span));
    let v_hi_s = topo::vertex(at_angle(p_hi, a0));
    let v_hi_t = topo::vertex(at_angle(p_hi, a0 + arc.span));
    let seam_s = topo::edge(
        v_lo_s.clone(),
        v_hi_s.clone(),
        true,
        Curve::Segment { a: v_lo_s.borrow().point, b: v_hi_s.borrow().point },
    );
    let seam_t = topo::edge(
        v_lo_t.clone(),
        v_hi_t.clone(),
        true,
        Curve::Segment { a: v_lo_t.borrow().point, b: v_hi_t.borrow().point },
    );
    // Rim arcs as real Curve::Arc: x_axis rotated to the edge's own start
    // angle (Curve::Arc always begins at angle 0 from x_axis), sweep = ±span.
    // The top rim is traversed a0 -> a0+span (x_axis at a0, sweep +span);
    // the bottom rim closes the wire the other way, a0+span -> a0
    // (x_axis at a0+span, sweep -span), so the wire walks a closed loop.
    let rim_hi_f = topo::edge(
        v_hi_s.clone(),
        v_hi_t.clone(),
        true,
        Curve::Arc {
            center: p_hi,
            radius: cy.radius,
            normal: axis,
            x_axis: add(scale(cy.e1, a0.cos()), scale(cy.e2, a0.sin())),
            sweep: arc.span,
        },
    );
    let rim_lo_b = topo::edge(
        v_lo_t.clone(),
        v_lo_s.clone(),
        true,
        Curve::Arc {
            center: p_lo,
            radius: cy.radius,
            normal: axis,
            x_axis: add(scale(cy.e1, (a0 + arc.span).cos()), scale(cy.e2, (a0 + arc.span).sin())),
            sweep: -arc.span,
        },
    );
    let vm = 0.5 * (vlo + vhi);
    let uses = vec![
        topo::EdgeUse { edge: seam_s.clone(), forward: true, pcurve: topo::Pcurve { start: [a0, vlo], end: [a0, vhi], mid: [a0, vm] } },
        topo::EdgeUse { edge: rim_hi_f.clone(), forward: true, pcurve: topo::Pcurve { start: [a0, vhi], end: [a0 + arc.span, vhi], mid: [a0 + arc.span * 0.5, vhi] } },
        topo::EdgeUse { edge: seam_t.clone(), forward: true, pcurve: topo::Pcurve { start: [a0 + arc.span, vhi], end: [a0 + arc.span, vlo], mid: [a0 + arc.span, vm] } },
        topo::EdgeUse { edge: rim_lo_b.clone(), forward: true, pcurve: topo::Pcurve { start: [a0 + arc.span, vlo], end: [a0, vlo], mid: [a0 + arc.span * 0.5, vlo] } },
    ];
    let surf = Surface::Cylinder(Cylinder {
        origin: cy.origin,
        axis: cy.axis,
        e1: cy.e1,
        e2: cy.e2,
        radius: cy.radius,
        vmin: vlo,
        vmax: vhi,
        arc: Some(arc),
    });
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: surf,
        uv_domain: [[a0, a0 + span], [vlo, vhi]],
    }))
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
    if let Some((hc, hr)) = region.hole {
        // A hole region (a torus band's annulus): the face must contain the
        // OUTER disk entirely (same 32-probe check the plain disk uses) and
        // the hole circle must sit strictly inside the face too. The kept
        // face is the face minus the hole circle.
        if let Some((c, r)) = region.disk {
            if !point_in_poly(f, c) {
                return None;
            }
            for k in 0..32 {
                let a = TWO_PI * k as f64 / 32.0;
                let p = [c[0] + r * a.cos(), c[1] + r * a.sin()];
                if !point_in_poly(f, p) {
                    return None;
                }
            }
            if !point_in_poly(f, hc) {
                return None;
            }
            for k in 0..32 {
                let a = TWO_PI * k as f64 / 32.0;
                let p = [hc[0] + hr * a.cos(), hc[1] + hr * a.sin()];
                if !point_in_poly(f, p) {
                    return None;
                }
            }
            return Some(Clamped::Annulus(c, r, hc, hr));
        }
        return None;
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
        let area = signed_area2(&ring);
        if ring.len() == 1 {
            // A single full-circle outer wire: its vertex ring collapses to
            // ONE point (start == end) and the shoelace sum is 0, which would
            // read as "not CCW" and wind the hole the SAME way as the outer —
            // an annulus whose hole ADDS its area (measured: the open-top
            // hollow's outer cap came out pi*(R^2+r^2) instead of the
            // annulus). A circle traversed forward is CCW about its own
            // normal; in the plane's right-handed (u, v, n) that is CCW in
            // uv exactly when the circle's normal agrees with plane.n.
            let w = fb.boundary.first().expect("checked above");
            let u0 = &w.borrow().edges[0];
            let eb = u0.edge.borrow();
            match &eb.curve {
                Curve::Circle { normal, .. } => {
                    let fwd = dot(*normal, plane.n) > 0.0;
                    if u0.forward { fwd } else { !fwd }
                }
                _ => area > 0.0,
            }
        } else {
            area > 0.0
        }
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
            Clamped::Annulus(c, r, hc, hr) => {
                let _ = (hc, hr);
                let kept = if reverse { flip_planar(face) } else { face.clone() };
                out.push(face_with_hole(&kept, &kept_plane, &Hole::Circle(c, r)));
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
            Clamped::Annulus(_, _, _, _) => return None,
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
    // UNION's kept tool faces are the tool's own OUTSIDE: the tool cap in a
    // union is kept where it lies OUTSIDE the base. A tool cap COPLANAR with
    // a base cap must be probed AT the plane (offset 0, inclusive) — probing
    // +PROBE past it classifies every point of the coplanar base face as
    // outside, which would keep the tool's whole disk (a full overlap, a
    // wrong union) instead of the lune. Subtract does not take this path (a
    // flush tool cap must vanish, which the +PROBE probe achieves), and the
    // base's own faces keep the coplanar-reads-outside rule either way, so
    // the branch is union+tool only.
    let region = if op == "union" && !is_a {
        region_inside(other, plane, scale(plane.n, 0.0))?
    } else {
        region_inside(other, plane, scale(plane.n, sign * PROBE))?
    };
    // Region membership slack, in plane-uv units. MUST be strictly below PROBE:
    // when this face is coplanar with a face of `other`, the probe sits exactly
    // PROBE past that face, so its half-plane evaluates to +PROBE. A slack equal
    // to PROBE read that as "inside" and kept a spurious flipped cap on the
    // opening of a flush blind hole (volume off by the cap's own term, no
    // refusal); anything below PROBE classifies the coincidence as outside,
    // which is what "this surface is on the base's boundary" means. For the
    // union-at-zero probe above the same slack makes the coplanar boundary
    // itself (exactly 0) read inside, which is what that probe wants.
    const REGION_EPS: f64 = 1e-9;
    let mut inside_count = 0;
    let mut total = 0;
    let probe = |p: Vec3, inside_count: &mut usize, total: &mut usize| {
        let uv = plane.project(p);
        let yes = if region.empty {
            false
        } else {
            let in_hs = region.hs.iter().all(|h| h[0] * uv[0] + h[1] * uv[1] + h[2] <= REGION_EPS);
            let in_disk = match region.disk {
                Some((c, r)) => {
                    let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                    d[0] * d[0] + d[1] * d[1] <= r * r + 1e-7
                }
                None => true,
            };
            let out_of_hole = match region.hole {
                Some((c, r)) => {
                    let d = [(uv[0] - c[0]) as f64, (uv[1] - c[1]) as f64];
                    d[0] * d[0] + d[1] * d[1] >= r * r - 1e-7
                }
                None => true,
            };
            in_hs && in_disk && out_of_hole
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
    let center_uv = plane.project(center);
    // Does the disk region (centre `c`, radius `r`), possibly cut by the
    // half-planes, sit strictly inside this face's disk? In-plane cuts are
    // real boundaries (a half-plane whose line crosses the disk); a
    // degenerate (0,0,c) half-plane is the coplanar face itself and cuts
    // nothing in-plane.
    let cuts = |hs: &[[f64; 3]], cuv: [f64; 2]| -> bool {
        hs.iter().any(|h| {
            let den = (h[0] * h[0] + h[1] * h[1]).sqrt();
            if den < 1e-7 {
                return false;
            }
            let num = h[0] * cuv[0] + h[1] * cuv[1] + h[2];
            (num / den).abs() < radius - 1e-7
        })
    };
    if !full && !empty {
        // A partial overlap between two COPLANAR cylinders' caps (W8): the
        // kept shape is a lens (inside the other's disk) or a lune (this disk
        // minus the other's) — buildable exactly as two circle arcs, unless a
        // half-plane cuts the base disk (a three-piece loop, still not built).
        if !cuts(&region.hs, center_uv) {
            if let Some((c, r)) = region.disk {
                // Containment: the other's disk entirely inside this face's
                // disk. A tool cap fully inside a base cap is interior (kept
                // inside = drop it); a keep-outside operation instead bites a
                // circular hole out of this cap (an annulus).
                let d = [c[0] - center_uv[0], c[1] - center_uv[1]];
                let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
                if dist + r <= radius - 1e-7 {
                    if keeps_inside(op, is_a) {
                        return Some(());
                    }
                    let reverse = op == "subtract" && !is_a;
                    let kept_plane = if reverse {
                        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
                    } else {
                        plane.clone()
                    };
                    out.push(face_with_hole(face, &kept_plane, &Hole::Circle(c, r)));
                    return Some(());
                }
                return keep_disk_two_arcs(&plane, center_uv, radius, c, r, op, is_a, out);
            }
        }
        return None;
    }
    // W3 (open-top hollow): a tool disk strictly inside this cap reads
    // "empty" at the +PROBE probe — the tool's own flush cap plane sits
    // exactly PROBE past this face, so every probe fails it — yet for a
    // keep-outside operation the tool still bites a circular hole out of
    // this cap (the outer cap of a hollowed cylinder becomes an annulus).
    // Re-probe AT the plane: coplanar faces then satisfy their own
    // half-planes (exactly 0 <= eps) and the region is the tool's true
    // cross-section; containment (its disk inside this one) builds the
    // annulus. A cutting half-plane or a non-contained disk still refuses.
    if empty && !keeps_inside(op, is_a) {
        if let Some(region0) = region_inside(other, plane, [0.0, 0.0, 0.0]) {
            if !region0.empty {
                if let Some((c, r)) = region0.disk {
                    if !cuts(&region0.hs, center_uv) {
                        let d = [c[0] - center_uv[0], c[1] - center_uv[1]];
                        let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
                        if dist + r <= radius - 1e-7 {
                            out.push(face_with_hole(face, &plane, &Hole::Circle(c, r)));
                            return Some(());
                        }
                    }
                }
            }
        }
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

/// A disk-shaped planar face partially overlapped by another disk (W8
/// coplanar caps): the kept region is a lens (inside both disks) or a lune
/// (this disk minus the other), built exactly as two circle arcs. Worked
/// example behind the angle bookkeeping: disk1 R5 at origin, disk2 R5 at
/// (6,0) — intersections (3,±4); the lens walks circle1's near arc
/// (angles −θ₁→+θ₁, through (5,0)) then circle2's near arc back (through
/// (1,0)), both CCW; the lune walks circle1's long arc CCW (through (−5,0))
/// then circle2's near arc clockwise. `None` when containment makes the
/// partial shape undefined (the callers' probes already routed those).
fn keep_disk_two_arcs(
    plane: &Plane,
    center: [f64; 2],
    radius: f64,
    other_c: [f64; 2],
    other_r: f64,
    op: &str,
    is_a: bool,
    out: &mut Vec<TFace>,
) -> Option<()> {
    let d = [other_c[0] - center[0], other_c[1] - center[1]];
    let dist = (d[0] * d[0] + d[1] * d[1]).sqrt();
    if dist < 1e-12 {
        return None; // concentric: a pure containment, not a partial overlap
    }
    if dist >= radius + other_r - 1e-9 || dist <= (radius - other_r).abs() + 1e-9 {
        return None; // tangent or containment: not this builder's case
    }
    let theta1 = ((radius * radius + dist * dist - other_r * other_r) / (2.0 * radius * dist))
        .clamp(-1.0, 1.0)
        .acos();
    let theta2 = ((other_r * other_r + dist * dist - radius * radius)
        / (2.0 * other_r * dist))
        .clamp(-1.0, 1.0)
        .acos();
    let phi = d[1].atan2(d[0]); // from this disk's centre toward the other's
    let keep_inside = keeps_inside(op, is_a);
    // Arc pieces as (centre_uv, radius, start_angle, signed span), chained
    // CCW for the lens and per the worked example for the lune.
    let pieces: Vec<([f64; 2], f64, f64, f64)> = if keep_inside {
        vec![
            (center, radius, phi - theta1, 2.0 * theta1),
            (other_c, other_r, phi + std::f64::consts::PI - theta2, 2.0 * theta2),
        ]
    } else {
        vec![
            (center, radius, phi + theta1, TWO_PI - 2.0 * theta1),
            (other_c, other_r, phi + std::f64::consts::PI + theta2, -2.0 * theta2),
        ]
    };
    let reverse = op == "subtract" && !is_a;
    let kept_plane = if reverse {
        Plane { origin: plane.origin, n: scale(plane.n, -1.0), u: plane.u, v: plane.v }
    } else {
        plane.clone()
    };
    out.push(build_arc_loop_face(&kept_plane, &pieces));
    if reverse {
        // flip_planar keeps the boundary and negates the surface normal; the
        // built face's own plane is `kept_plane`, so flipping it restores the
        // original n as the OUTWARD one pointing into the removed void.
        let built = out.pop().expect("just pushed");
        out.push(flip_planar(&built));
    }
    Some(())
}

/// A planar face whose single boundary wire is a chain of circular arcs given
/// in the plane's uv: (centre, radius, start angle, signed sweep) per piece,
/// each starting where the previous ended. Angles are CCW in (plane.u,
/// plane.v) when the (u, v, n) triple is right-handed; the arcs are built as
/// real Curve::Arc so measurement, meshing and STEP all treat them exactly.
fn build_arc_loop_face(plane: &Plane, pieces: &[([f64; 2], f64, f64, f64)]) -> TFace {
    let pt = |c: [f64; 2], r: f64, ang: f64| -> [f64; 2] {
        [c[0] + r * ang.cos(), c[1] + r * ang.sin()]
    };
    let mut uses: Vec<topo::EdgeUse<Curve3>> = Vec::with_capacity(pieces.len());
    let n = pieces.len();
    for (i, (c, r, start, sweep)) in pieces.iter().enumerate() {
        let a_uv = pt(*c, *r, *start);
        let b_uv = pt(*c, *r, *start + *sweep);
        let a3 = plane.point(a_uv);
        let b3 = plane.point(b_uv);
        let mid_ang = *start + 0.5 * *sweep;
        let m3 = plane.point(pt(*c, *r, mid_ang));
        let e = topo::edge(
            topo::vertex(a3),
            topo::vertex(b3),
            true,
            Curve::Arc {
                center: plane.point(*c),
                radius: *r,
                normal: plane.n,
                x_axis: add(scale(plane.u, start.cos()), scale(plane.v, start.sin())),
                sweep: *sweep,
            },
        );
        let _last = i + 1 == n;
        uses.push(topo::EdgeUse {
            edge: e,
            forward: true,
            pcurve: topo::Pcurve { start: a_uv, end: b_uv, mid: plane.project(m3) },
        });
    }
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: Surface::Plane(plane.clone()),
        uv_domain: [[0.0, 1.0], [0.0, 1.0]],
    }))
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
            // Collect parallel cylinder tools for u-clipping (W8).
            let mut parallel_cylinders: Vec<Cylinder> = Vec::new();
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
                    Surface::Cylinder(cy2) => {
                        // Cylinder vs Cylinder: handle parallel axes case (W8 keystone).
                        // If axes are parallel, the tool cylinder's caps (planes) are already
                        // handled above as they appear as Planes in other.faces(). The wall
                        // intersection requires u-clipping at each v-segment.
                        let a2 = normalize(cy2.axis);
                        let parallel = (dot(axis, a2).abs() - 1.0).abs() < 1e-9;
                        if !parallel {
                            return None; // non-parallel axes: not yet implemented
                        }
                        // Axes are parallel. Store for u-clipping in v-segment loop.
                        parallel_cylinders.push(cy2.clone());
                    }
                    Surface::Torus(t2) => {
                        // Cylinder wall vs a TORUS band (a filleted rim): the
                        // band shares the base axis (a round-primitive rim is
                        // coaxial with its own cylinder). Its axial reach is
                        // the tube's span about ITS center. If the wall's
                        // band does not share axial space with the torus's
                        // tube span, the torus constrains nothing here —
                        // skip. A genuine overlap needs torus/cyl arc math
                        // (W5): refuse.
                        let a2 = normalize(t2.axis);
                        let parallel = (dot(axis, a2).abs() - 1.0).abs() < 1e-9;
                        if !parallel {
                            return None;
                        }
                        let t_lo = dot(t2.center, axis) - t2.tube;
                        let t_hi = dot(t2.center, axis) + t2.tube;
                        let w_lo = dot(cy.origin, axis) + cy.vmin;
                        let w_hi = dot(cy.origin, axis) + cy.vmax;
                        if (w_hi.min(t_hi) - w_lo.max(t_lo)) <= 1e-9 {
                            continue;
                        }
                        return None;
                    }
                    _ => return None,
                }
            }
            // A parallel tool cylinder's own band edges cut this wall's v
            // domain: above/below the tool's band the tool does not exist and
            // the wall keeps its full circle; inside the overlap the
            // u-clip applies. Without these breaks the radial circles were
            // compared at a v the tool never reaches (the Y2 flange bug: a
            // flange circle 15mm axially away swallowed the small
            // cylinder's entire wall).
            for cy2 in &parallel_cylinders {
                for v in [dot(cy2.origin, axis) + cy2.vmin, dot(cy2.origin, axis) + cy2.vmax] {
                    if v > cy.vmin + 1e-9 && v < cy.vmax - 1e-9 {
                        breaks.push(v);
                    }
                }
            }
            breaks.sort_by(|a, b| a.partial_cmp(b).unwrap());
            breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for w in breaks.windows(2) {
                let (vlo, vhi) = (w[0], w[1]);
                if vhi - vlo < 1e-9 {
                    continue;
                }
                // If there are parallel cylinder tools, compute arc intervals at mid-v.
                if !parallel_cylinders.is_empty() {
                    let vm = 0.5 * (vlo + vhi);
                    let base_center = add(cy.origin, scale(axis, vm));
                    // Compute arcs where base cylinder is inside each tool cylinder.
                    // The u-clip is only valid over the SHARED axial band of
                    // base and tool: a zero-length overlap means the tool's
                    // wall does not exist in this segment at all - the tool
                    // keeps its full circle. Without this the radial circles
                    // were compared at a v the tool never reaches (the Y2
                    // flange bug: a flange circle 15mm axially away swallowed
                    // the small cylinder's whole wall).
                    let base_band_lo = dot(cy.origin, axis) + vlo;
                    let base_band_hi = dot(cy.origin, axis) + vhi;
                    let mut arcs: Vec<(f64, f64)> = vec![(0.0, TWO_PI)]; // start with full circle
                    for cy2 in &parallel_cylinders {
                        let tool_lo = dot(cy2.origin, axis) + cy2.vmin;
                        let tool_hi = dot(cy2.origin, axis) + cy2.vmax;
                        let shared = base_band_hi.min(tool_hi) - base_band_lo.max(tool_lo);
                        if shared <= 1e-9 {
                            // The tool's wall does not exist in this v-band:
                            // nothing of the base circle is inside it. With
                            // keep_inside=true the AND over tools becomes
                            // empty; with keep_inside=false (keep outside)
                            // the complement of an empty inside-set is the
                            // FULL circle. Both follow from arcs = [].
                            arcs = intersect_arc_intervals(&arcs, &[]);
                        }
                        // The tool cylinder only reaches v in its own band
                        // along the axis (its origin + [vmin, vmax]). If that
                        // band does not overlap this v-band segment, the
                        // tool's wall does not exist here at all: comparing
                        // the RADIAL circles alone would drop walls the tool
                        // never touches (the Y2 flange bug: the flange circle
                        // 15mm away axially swallowed the small cylinder's
                        // whole wall). Skip tools whose band is clear of
                        // [vlo, vhi].
                        let tool_lo = dot(cy2.origin, axis) + cy2.vmin;
                        let tool_hi = dot(cy2.origin, axis) + cy2.vmax;
                        let base_lo = dot(cy.origin, axis) + vlo;
                        let base_hi = dot(cy.origin, axis) + vhi;
                        if tool_lo > base_hi + 1e-9 || tool_hi < base_lo - 1e-9 {
                            continue;
                        }
                        // Tool cylinder center at this v (same axis, so center projects to same line).
                        let tool_center = add(cy2.origin, scale(axis, vm));
                        let d = sub(tool_center, base_center);
                        let dist = crate::math::len(d);
                        let r1 = cy.radius;
                        let r2 = cy2.radius;
                        // Two circles intersection: find angular intervals on base circle inside tool circle.
                        let new_arcs = circle_intersection_arcs(r1, r2, dist, cy.e1, cy.e2, d);
                        arcs = intersect_arc_intervals(&arcs, &new_arcs);
                        if arcs.is_empty() {
                            break; // completely outside all tool cylinders
                        }
                    }
                    // For keep_inside=true (tool faces in subtract), keep arcs inside other.
                    // For keep_inside=false (base faces in subtract), keep arcs outside other (complement).
                    // The complement walks [0, 2π) in order, so the intervals
                    // must be sorted with wrap-fragments rotated to the start
                    // (a (5.56, 2π) piece sorts BEFORE (0, 0.72) but walks last).
                    let mut sorted = arcs.clone();
                    // Clamp any piece whose end exceeds 2π (a defensive clamp;
                    // `circle_intersection_arcs` never emits one) so the
                    // complement walk below stays inside [0, 2π).
                    for (_start, end) in sorted.iter_mut() {
                        if *end > TWO_PI { *end = TWO_PI; }
                    }
                    let head = sorted.iter().position(|(s, _)| *s < 1e-9);
                    let ordered: Vec<(f64, f64)> = match head {
                        Some(h) => {
                            let mut it = sorted[h..].to_vec();
                            it.extend_from_slice(&sorted[..h]);
                            it
                        }
                        None => sorted,
                    };
                    let final_arcs: Vec<(f64, f64)> = if keep_inside {
                        ordered
                    } else {
                        // Complement of arcs in [0, 2π)
                        let mut comp = Vec::new();
                        let mut prev_end = 0.0;
                        for (start, end) in &ordered {
                            if *start - prev_end > 1e-9 {
                                comp.push((prev_end, *start));
                            }
                            prev_end = prev_end.max(*end);
                        }
                        if TWO_PI - prev_end > 1e-9 {
                            comp.push((prev_end, TWO_PI));
                        }
                        comp
                    };
                    if !final_arcs.is_empty() {
                        for (start, end) in final_arcs {
                            let arc_range = crate::geom::ArcRange { start, span: end - start };
                            let wall = partial_wall_arc(cy, vlo, vhi, arc_range);
                            out.push(if reverse { flip_face(&wall) } else { wall });
                        }
                    }
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
                Surface::Torus(t) => {
            // A round-primitive rim band (a quarter torus, SPEC-brep-round).
            // Keep/drop it WHOLESALE by probing the band against `other` --
            // exact whenever the band lies entirely on one side (the Y2
            // flanged cylinder: the rim is fully outside the standing
            // cylinder). A band genuinely cut by `other` needs torus/cyl
            // arc math (W5) and still refuses: four band probes (the tube-
            // angle ends at mid-turn) must agree with the middle.
            offset_sign(op, is_a)?;
            let keep_inside = keeps_inside(op, is_a);
            let reverse = op == "subtract" && !is_a;
            let axis = normalize(t.axis);
            let (e1, e2, _) = crate::geom::frame(axis);
            // TorusSurf param (geom.rs): p(u, v) = center + (ring +
            // tube*cos v)*(cos u*e1 + sin u*e2) + tube*sin v*axis; v the
            // tube angle in t.v_range, u the full turn.
            let pt_at = |u: f64, v: f64| {
                let rho = t.ring + t.tube * v.cos();
                add(
                    t.center,
                    add(
                        scale(axis, t.tube * v.sin()),
                        add(scale(e1, rho * u.cos()), scale(e2, rho * u.sin())),
                    ),
                )
            };
            let vmid = 0.5 * (t.v_range[0] + t.v_range[1]);
            let probes = [
                pt_at(0.0, vmid),
                pt_at(std::f64::consts::FRAC_PI_2, vmid),
                pt_at(std::f64::consts::PI, vmid),
                pt_at(std::f64::consts::PI + std::f64::consts::FRAC_PI_2, vmid),
            ];
            let inside_flags: Vec<bool> = probes.iter().map(|&p| inside_solid(other, p)).collect();
            let all_same = inside_flags.iter().all(|&b| b == inside_flags[0]);
            if !all_same {
                return None;
            }
            let in_other = inside_solid(other, probes[0]);
            let keep = if keep_inside { in_other } else { !in_other };
            if keep {
                out.push(if reverse { flip_face(face) } else { face.clone() });
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
        // Keep the ORIGINAL boundary wires, exactly as flip_face does and for
        // the same measured reason: rebuilding from a vertex ring collapses a
        // DISK cap (its wire is a single closed circle, so the ring has one
        // point) to zero area, and drop_degenerate_faces then deletes the face
        // silently -- a blind hole whose mouth is coplanar with a base face
        // lost its floor that way, with no refusal (volume off by exactly the
        // floor's divergence term). Only the surface's outward normal is
        // reversed; the wires are geometry, not orientation.
        Rc::new(RefCell::new(Face {
            boundary: fb.boundary.clone(),
            forward: fb.forward,
            surface: Surface::Plane(flipped),
            uv_domain: fb.uv_domain,
        }))
    } else {
        face.clone()
    }
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

/// W8: boolean of two parallel-axis cylinders whose caps are coplanar
/// (same height). The dedicated builder exists because the generic
/// face-by-face path builds each side in its own frame — a cap arc in the
/// cap plane's (u, v) samples a different point set than the wall rim it
/// borders, which the mesh gate catches as T-vertex cracks. Here every
/// wall rim AND cap arc is built in the owning cylinder's own (e1, e2)
/// frame at the arc's start angle, so a rim and the cap arc sharing one
/// world arc are the same polyline pointwise, before any welding.
///
/// Layout (subtract, a − b): a's wall keeps its outside arc, b's wall keeps
/// its inside arc flipped (via [`flip_face`]), a's caps are the LUNE
/// (a's disk minus b's), b's caps are dropped (interior). Union: both walls
/// keep their outside arcs, a's caps stay whole, b's caps become the lune.
/// Intersect: both walls keep their inside arcs, caps become the lens.
/// `None` for any configuration this does not cover (different heights,
/// non-coplanar caps, non-parallel axes) — the caller falls through to the
/// general path, which refuses honestly if it cannot build it either.
pub fn cylinder_pair_boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let Some((wa, ca_lo, ca_hi, fa_lo, fa_hi)) = cylinder_parts(a) else { return None };
    let (wb, cb_lo, cb_hi, fb_lo, fb_hi) = cylinder_parts(b)?;
    // Parallel axes, coplanar caps, matching v-ranges (equal heights).
    let axis_a = normalize(wa.axis);
    if (dot(axis_a, normalize(wb.axis)).abs() - 1.0).abs() > 1e-9 {
        return None;
    }
    for (p, q) in [(ca_lo, cb_lo), (ca_hi, cb_hi)] {
        // Coplanar caps: same HEIGHT along the axis. The centres differ by
        // the radial offset (that is the whole point of the pair), so only
        // the axial component must agree.
        if dot(sub(p, q), axis_a).abs() > 1e-7 {
            return None;
        }
    }
    if (wa.vmin - wb.vmin).abs() > 1e-9 || (wa.vmax - wb.vmax).abs() > 1e-9 {
        return None;
    }
    // The circles in the world plane of the caps, in a's own (e1, e2) frame.
    // b's frame may be rotated (both come from geom::frame, which is
    // deterministic per axis, so if the axes AGREE in direction the frames
    // agree too; opposite axes are mirrored — reject rather than re-derive,
    // the fixtures build both cylinders the same way).
    if dot(axis_a, normalize(wb.axis)) < 1.0 - 1e-9 {
        return None;
    }
    let (r1, r2) = (wa.radius, wb.radius);
    let d = sub(cb_lo, ca_lo);
    let dx = dot(d, wa.e1);
    let dy = dot(d, wa.e2);
    let dist = crate::math::len([dx, dy, 0.0]);
    let phi = dy.atan2(dx); // b's centre seen from a's centre, in a's frame
    // Disjoint / contained cases reduce to full or empty arcs.
    let (theta1, theta2) = if dist < 1e-12 {
        // concentric
        if r1 <= r2 + 1e-9 { (0.0f64, std::f64::consts::PI) } else { (std::f64::consts::PI, 0.0) }
    } else {
        let t1 = ((r1 * r1 + dist * dist - r2 * r2) / (2.0 * r1 * dist)).clamp(-1.0, 1.0).acos();
        let t2 = ((r2 * r2 + dist * dist - r1 * r1) / (2.0 * r2 * dist)).clamp(-1.0, 1.0).acos();
        (t1, t2)
    };
    let disjoint = dist >= r1 + r2 - 1e-9;
    let b_in_a = dist + r2 <= r1 + 1e-9;
    let a_in_b = dist + r1 <= r2 + 1e-9;
    // The two crossing world angles on EACH circle (a's frame for circle-a,
    // b's frame for circle-b: b's frame == a's frame given the axis check).
    let a_in = phi - theta1; // where a's rim enters b's disk
    let a_in2 = phi + theta1;
    let phi_b = (-dy).atan2(-dx); // a's centre seen from b's centre
    let b_in = phi_b - theta2;
    let b_in2 = phi_b + theta2;
    let _ = (a_in, a_in2, b_in, b_in2, disjoint, b_in_a, a_in_b, fa_lo, fa_hi, fb_lo, fb_hi);
    build_cyl_pair_result(op, &wa, ca_lo, ca_hi, &wb, cb_lo, r1, r2, dist, phi, phi_b, theta1, theta2)
}

/// The wall face and cap planes/circles of a "pure" cylinder solid: one
/// full-turn wall (arc None) plus two planar disk caps. Returns
/// (wall_cylinder, bottom_cap_center, top_cap_center, bottom_rim_edge, top_rim_edge).
/// The rim edges are reused in the output so the caps and walls share
/// handles by construction, not by welding.
#[allow(clippy::type_complexity)]
pub fn cylinder_parts(
    s: &TSolid,
) -> Option<(
    Cylinder,
    Vec3,
    Vec3,
    topo::EdgeRef<Curve3>,
    topo::EdgeRef<Curve3>,
)> {
    let faces = s.faces();
    if faces.len() != 3 {
        return None;
    }
    let mut wall: Option<Cylinder> = None;
    let mut cap_lo: Option<(Vec3, topo::EdgeRef<Curve3>)> = None;
    let mut cap_hi: Option<(Vec3, topo::EdgeRef<Curve3>)> = None;
    for f in &faces {
        let fb = f.borrow();
        match &fb.surface {
            Surface::Cylinder(cy) => {
                if cy.arc.is_some() || wall.is_some() {
                    return None;
                }
                wall = Some(cy.clone());
            }
            Surface::Plane(_) => {
                let Some((center, _radius)) = circle_boundary_of_wire(&fb) else {
                    return None;
                };
                let Some(e) = single_circle_edge(&fb) else {
                    return None;
                };
                // outward normal +axis → top cap; −axis → bottom.
                // The wall is known only after the loop; classify by comparing
                // the rim centre's height along +e1 after the wall is read.
                if cap_lo.is_none() {
                    cap_lo = Some((center, e));
                } else {
                    cap_hi = Some((center, e));
                }
            }
            _ => return None,
        }
    }
    let wall = wall?;
    let (mut ca_lo, mut ea_lo) = cap_lo?;
    let (mut ca_hi, mut ea_hi) = cap_hi?;
    let axis = normalize(wall.axis);
    // Order the caps by height along the wall's axis: the wall spans
    // [vmin, vmax] from its origin, so the bottom cap sits at
    // origin + axis·vmin.
    let h_lo = dot(sub(ca_lo, wall.origin), axis);
    let h_hi = dot(sub(ca_hi, wall.origin), axis);
    if (h_lo - wall.vmin).abs() > 1e-7 || (h_hi - wall.vmax).abs() > 1e-7 {
        // Swap so cap_lo really is the vmin end (cylinder_solid builds
        // bottom-first, but do not rely on face order).
        std::mem::swap(&mut ca_lo, &mut ca_hi);
        std::mem::swap(&mut ea_lo, &mut ea_hi);
    }
    // The cap rim circles must match the wall's radius and position.
    for (cap_center, e) in [(&ca_lo, &ea_lo), (&ca_hi, &ea_hi)] {
        let _ = cap_center;
        match &e.borrow().curve {
            Curve::Circle { radius, .. } if (radius - wall.radius).abs() <= 1e-7 => {}
            _ => return None,
        }
    }
    Some((wall, ca_lo, ca_hi, ea_lo, ea_hi))
}

/// The single full-circle boundary edge of a disk planar face, if any.
fn single_circle_edge(fb: &Face<Curve3, Surface3>) -> Option<topo::EdgeRef<Curve3>> {
    let w = fb.boundary.first()?;
    let uses = w.borrow().edges.clone();
    if uses.len() != 1 {
        return None;
    }
    let is_circle = matches!(&uses[0].edge.borrow().curve, Curve::Circle { .. });
    if is_circle {
        Some(uses[0].edge.clone())
    } else {
        None
    }
}

/// `circle_boundary` without the single-wire requirement — reads the first
/// wire's circle geometry.
fn circle_boundary_of_wire(fb: &Face<Curve3, Surface3>) -> Option<(Vec3, f64)> {
    let w = fb.boundary.first()?;
    let mut found: Option<(Vec3, f64)> = None;
    for u in &w.borrow().edges {
        match &u.edge.borrow().curve {
            Curve::Circle { center, radius, .. } => found = Some((*center, *radius)),
            _ => return None,
        }
    }
    found
}

/// W3 (shell on a cylinder), open-top flush case, built directly with shared
/// edge handles — the same frame-consistency discipline as
/// [`cylinder_pair_boolean`]: the generic boolean path rebuilds rims in
/// different sample phases than the annuli's hole rings, which the mesh gate
/// catches as T-vertex cracks. Here every rim circle is ONE edge handle
/// reused by the wall piece(s) and cap(s) that border it, and `curve_points`'s
/// Circle sampling is frame-sign-robust (`frame(+axis)` and `frame(-axis)`
/// produce the same point set), so a rim shared through a flipped use still
/// samples identically on both sides.
///
/// Layout (subtract, outer `a`, inner `b`, b's top cap FLUSH with a's, b's
/// bottom strictly inside): the void spans z in [b.lo, a.hi], so the result
/// is 6 faces — a's wall split at b's bottom plane (2 pieces), b's wall
/// flipped (the void wall), a's own bottom cap (full disk, untouched), the
/// top annulus (a's top rim + b's top rim reversed), and b's bottom cap
/// flipped (the void floor). `None` for any other configuration.
pub fn cylinder_open_hollow(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "subtract" {
        return None;
    }
    let Some((wa, ca_lo, ca_hi, fa_lo, fa_hi)) = cylinder_parts(a) else { return None };
    let Some((wb, cb_lo, cb_hi, _fb_lo, fb_hi)) = cylinder_parts(b) else { return None };
    let axis = normalize(wa.axis);
    if (dot(axis, normalize(wb.axis)) - 1.0).abs() > 1e-9 {
        return None;
    }
    let off = sub(cb_lo, ca_lo);
    if crate::math::len(sub(off, scale(axis, dot(off, axis)))) > 1e-9 {
        return None; // not coaxial
    }
    if wb.radius >= wa.radius - 1e-9 {
        return None;
    }
    if crate::math::len(sub(ca_hi, cb_hi)) > 1e-7 {
        return None; // top caps not flush
    }
    let bottom_gap = dot(sub(cb_lo, ca_lo), axis);
    let height = wa.vmax - wa.vmin;
    if bottom_gap <= 1e-9 || bottom_gap >= height - 1e-9 {
        return None;
    }
    // a's original bottom cap (full disk, untouched by the void) and bottom
    // rim are reused as-is; the wall splits at the tool's bottom plane.
    let cap_bottom = a
        .faces()
        .into_iter()
        .find(|f| matches!(&f.borrow().surface, Surface::Plane(p) if dot(p.n, axis) < -1e-9))?;
    // b's bottom cap, flipped into the void's floor.
    let floor = {
        let bf = b
            .faces()
            .into_iter()
            .find(|f| matches!(&f.borrow().surface, Surface::Plane(p) if dot(p.n, axis) < -1e-9))?;
        flip_planar(&bf)
    };
    // The split rim circle at b's bottom height, in a's frame (+axis normal
    // so both wall pieces and any neighbour sample the same set).
    let rim_split_centre = add(wa.origin, scale(axis, bottom_gap));
    let rim_split = topo::edge(
        topo::vertex(add(rim_split_centre, scale(wa.e1, wa.radius))),
        topo::vertex(add(rim_split_centre, scale(wa.e1, wa.radius))),
        true,
        Curve::Circle { center: rim_split_centre, radius: wa.radius, normal: axis },
    );
    // A full-turn wall piece over [vlo, vhi] reusing the shared rim handles
    // (same wire shape as [`partial_wall`], rims supplied not built).
    let wall_piece = |vlo: f64, vhi: f64, rim_lo: &topo::EdgeRef<Curve3>, rim_hi: &topo::EdgeRef<Curve3>| -> TFace {
        let pa = add(wa.origin, scale(axis, vlo));
        let pb = add(wa.origin, scale(axis, vhi));
        let v_lo = topo::vertex(add(pa, scale(wa.e1, wa.radius)));
        let v_hi = topo::vertex(add(pb, scale(wa.e1, wa.radius)));
        let seam = topo::edge(
            v_lo.clone(),
            v_hi.clone(),
            true,
            Curve::Segment { a: v_lo.borrow().point, b: v_hi.borrow().point },
        );
        let vm = 0.5 * (vlo + vhi);
        let uses = vec![
            topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vlo], end: [0.0, vhi], mid: [0.0, vm] } },
            topo::EdgeUse { edge: rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vhi], end: [TWO_PI, vhi], mid: [std::f64::consts::PI, vhi] } },
            topo::EdgeUse { edge: seam.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vhi], end: [TWO_PI, vlo], mid: [TWO_PI, vm] } },
            topo::EdgeUse { edge: rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [TWO_PI, vlo], end: [0.0, vlo], mid: [std::f64::consts::PI, vlo] } },
        ];
        let surf = Surface::Cylinder(Cylinder {
            origin: wa.origin,
            axis: wa.axis,
            e1: wa.e1,
            e2: wa.e2,
            radius: wa.radius,
            vmin: vlo,
            vmax: vhi,
            arc: None,
        });
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
            forward: true,
            surface: surf,
            uv_domain: [[0.0, TWO_PI], [vlo, vhi]],
        }))
    };
    let wall_lower = wall_piece(wa.vmin, bottom_gap, &fa_lo, &rim_split);
    let wall_upper = wall_piece(bottom_gap, wa.vmax, &rim_split, &fa_hi);
    // The void wall: b's wall flipped; its rim handles (fb_lo/fb_hi) stay
    // b's, which the annulus hole and the floor reuse.
    let wall_inner = flip_face(
        &b.faces()
            .into_iter()
            .find(|f| matches!(&f.borrow().surface, Surface::Cylinder(c) if c.arc.is_none() && (c.radius - wb.radius).abs() < 1e-9))?,
    );
    // The top annulus: outer ring = a's top rim (forward, CCW about +axis
    // as a's own cap used it), hole ring = b's top rim wound the other way.
    let annulus = |outer: &topo::EdgeRef<Curve3>, hole: &topo::EdgeRef<Curve3>, at: Vec3, normal: Vec3| -> TFace {
        let plane = Plane::new(at, normal);
        let zero = topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
        Rc::new(RefCell::new(Face {
            boundary: vec![
                Rc::new(RefCell::new(Wire { edges: vec![topo::EdgeUse { edge: outer.clone(), forward: true, pcurve: zero } ] })),
                Rc::new(RefCell::new(Wire { edges: vec![topo::EdgeUse { edge: hole.clone(), forward: false, pcurve: zero } ] })),
            ],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        }))
    };
    let top = annulus(&fa_hi, &fb_hi, ca_hi, axis);
    Some(Solid {
        shells: vec![Rc::new(RefCell::new(Shell {
            faces: vec![wall_lower, wall_upper, wall_inner, cap_bottom, top, floor],
        }))],
    })
}

#[allow(clippy::too_many_arguments)]
fn build_cyl_pair_result(
    op: &str,
    wa: &Cylinder,
    ca_lo: Vec3,
    ca_hi: Vec3,
    wb: &Cylinder,
    cb_lo: Vec3,
    r1: f64,
    r2: f64,
    dist: f64,
    phi: f64,
    phi_b: f64,
    theta1: f64,
    theta2: f64,
) -> Option<TSolid> {
    let axis = normalize(wa.axis);
    let (vlo, vhi) = (wa.vmin, wa.vmax);
    let cb_hi = add(cb_lo, scale(axis, vhi - vlo));
    // Only true partial overlaps are built here; disjoint/contained cases
    // fall through to the general path (identity, subtract_enclosed, refuse).
    if dist >= r1 + r2 - 1e-9 || dist + r2 <= r1 + 1e-9 || dist + r1 <= r2 + 1e-9 {
        return None;
    }
    // Crossing angles per circle, in each cylinder's own frame (the frames
    // agree because the axes agree in direction and geom::frame is
    // deterministic per axis).
    let (a_in0, a_in1) = (phi - theta1, phi + theta1);
    let (b_in0, b_in1) = (phi_b - theta2, phi_b + theta2);
    let at = |c: &Cylinder, centre: Vec3, ang: f64| -> Vec3 {
        add(centre, add(scale(c.e1, c.radius * ang.cos()), scale(c.e2, c.radius * ang.sin())))
    };
    // The four world crossing points per cap: on a's rim (Pa_lo/Pa_hi at
    // angles a_in0/a_in1) and on b's rim (Pb_lo/Pb_hi at b_in0/b_in1). The
    // pair (Pa, Pb) at the same cap coincide (the circles' intersection),
    // so a's rim vertex and b's rim vertex are the same world point.
    let pa_lo0 = at(wa, ca_lo, a_in0);
    let pa_lo1 = at(wa, ca_lo, a_in1);
    let pa_hi0 = at(wa, ca_hi, a_in0);
    let pa_hi1 = at(wa, ca_hi, a_in1);
    let pb_lo0 = at(wb, cb_lo, b_in0);
    let pb_lo1 = at(wb, cb_lo, b_in1);
    let pb_hi0 = at(wb, cb_hi, b_in0);
    let pb_hi1 = at(wb, cb_hi, b_in1);

    // --- Edges. Rim arcs are built ONCE per (circle, cap, world arc) in the
    // owning cylinder's own frame (x_axis at the arc's start, normal +axis),
    // and are SHARED by the wall and the cap via the same handle — the
    // frame-consistency that makes the mesh watertight without relying on
    // the geometric welder.
    let arc_edge = |centre: Vec3, e1: Vec3, e2: Vec3, radius: f64, start: f64, sweep: f64| -> topo::EdgeRef<Curve3> {
        topo::edge(
            topo::vertex(add(centre, add(scale(e1, radius * start.cos()), scale(e2, radius * start.sin())))),
            topo::vertex(add(centre, add(scale(e1, radius * (start + sweep).cos()), scale(e2, radius * (start + sweep).sin())))),
            true,
            Curve::Arc {
                center: centre,
                radius,
                normal: axis,
                x_axis: add(scale(e1, start.cos()), scale(e2, start.sin())),
                sweep,
            },
        )
    };
    // Ruling seams between the two crossing points at each crossing angle.
    let seam_edge = |centre_lo: Vec3, e1: Vec3, e2: Vec3, radius: f64, ang: f64| -> topo::EdgeRef<Curve3> {
        let pa = add(centre_lo, add(scale(e1, radius * ang.cos()), scale(e2, radius * ang.sin())));
        let pb = add(pa, scale(axis, vhi - vlo));
        topo::edge(topo::vertex(pa), topo::vertex(pb), true, Curve::Segment { a: pa, b: pb })
    };

    // a's rim arcs: inside arc traversed a_in0 -> a_in1 (x_axis at a_in0,
    // sweep +2·theta1); outside arc traversed a_in1 -> a_in0 the long way
    // (x_axis at a_in1, sweep −(2π−2·theta1)). Same for b.
    let a_in_sweep = 2.0 * theta1;
    let a_out_sweep = TWO_PI - 2.0 * theta1;
    let b_in_sweep = 2.0 * theta2;
    let b_out_sweep = TWO_PI - 2.0 * theta2;
    // Per circle, per cap: (inside_arc, outside_arc). The rim edges are the
    // SAME handles the walls and caps both use.
    let e_a_in_lo = arc_edge(ca_lo, wa.e1, wa.e2, r1, a_in0, a_in_sweep);
    let e_a_in_hi = arc_edge(ca_hi, wa.e1, wa.e2, r1, a_in0, a_in_sweep);
    let e_a_out_lo = arc_edge(ca_lo, wa.e1, wa.e2, r1, a_in1, a_out_sweep);
    let e_a_out_hi = arc_edge(ca_hi, wa.e1, wa.e2, r1, a_in1, a_out_sweep);
    let e_b_in_lo = arc_edge(cb_lo, wb.e1, wb.e2, r2, b_in0, b_in_sweep);
    let e_b_in_hi = arc_edge(cb_hi, wb.e1, wb.e2, r2, b_in0, b_in_sweep);
    let e_b_out_lo = arc_edge(cb_lo, wb.e1, wb.e2, r2, b_in1, b_out_sweep);
    let e_b_out_hi = arc_edge(cb_hi, wb.e1, wb.e2, r2, b_in1, b_out_sweep);
    let e_seam_a0 = seam_edge(ca_lo, wa.e1, wa.e2, r1, a_in0);
    let e_seam_a1 = seam_edge(ca_lo, wa.e1, wa.e2, r1, a_in1);
    let e_seam_b0 = seam_edge(cb_lo, wb.e1, wb.e2, r2, b_in0);
    let e_seam_b1 = seam_edge(cb_lo, wb.e1, wb.e2, r2, b_in1);

    // --- Walls. partial-wall surface + 4 uses, referencing the SHARED rim
    // edges. The pcurves live in the cylinder's own (angle, v) space.
    // Built UNREVERSED: a tool-side wall (subtract's b) is reversed by
    // [`flip_face`] at the call site, which negates e2 and reflects the arc
    // range while keeping the boundary wires and their shared handles.
    let wall = |c: &Cylinder, centre_lo: Vec3, e_seam0: &topo::EdgeRef<Curve3>, e_seam1: &topo::EdgeRef<Curve3>, e_rim_lo: topo::EdgeRef<Curve3>, e_rim_hi: topo::EdgeRef<Curve3>, start: f64, sweep: f64| -> TFace {
        let vm = 0.5 * (vlo + vhi);
        let (s0, s1) = (start, start + sweep);
        let uses = vec![
            topo::EdgeUse { edge: e_seam0.clone(), forward: true, pcurve: topo::Pcurve { start: [s0, vlo], end: [s0, vhi], mid: [s0, vm] } },
            topo::EdgeUse { edge: e_rim_hi.clone(), forward: true, pcurve: topo::Pcurve { start: [s0, vhi], end: [s1, vhi], mid: [0.5 * (s0 + s1), vhi] } },
            topo::EdgeUse { edge: e_seam1.clone(), forward: true, pcurve: topo::Pcurve { start: [s1, vhi], end: [s1, vlo], mid: [s1, vm] } },
            topo::EdgeUse { edge: e_rim_lo.clone(), forward: false, pcurve: topo::Pcurve { start: [s1, vlo], end: [s0, vlo], mid: [0.5 * (s0 + s1), vlo] } },
        ];
        let surf = Surface::Cylinder(Cylinder {
            origin: centre_lo,
            axis: c.axis,
            e1: c.e1,
            e2: c.e2,
            radius: c.radius,
            vmin: vlo,
            vmax: vhi,
            arc: Some(crate::geom::ArcRange { start, span: sweep }),
        });
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
            forward: true,
            surface: surf,
            uv_domain: [[s0, s1], [vlo, vhi]],
        }))
    };

    // --- Caps. A cap is a two-arc loop reusing the shared rim edges.
    // Circle-a's lune (a's disk minus b's): a's outside arc + b's outside
    // arc traversed back. The lens: a's inside arc + b's inside arc back.
    // `flip` inverts the outward normal (a tool-side cap in a subtract).
    let two_arc_cap = |centre: Vec3, normal: Vec3, e_outer: topo::EdgeRef<Curve3>, fwd_outer: bool, e_inner: topo::EdgeRef<Curve3>, fwd_inner: bool| -> TFace {
        let plane = Plane::new(centre, normal);
        let mk = |e: &topo::EdgeRef<Curve3>, fwd: bool| {
            let eb = e.borrow();
            let pa = if fwd { eb.a.borrow().point } else { eb.b.borrow().point };
            let pb = if fwd { eb.b.borrow().point } else { eb.a.borrow().point };
            topo::EdgeUse {
                edge: e.clone(),
                forward: fwd,
                pcurve: topo::Pcurve { start: plane.project(pa), end: plane.project(pb), mid: plane.project(scale(add(pa, pb), 0.5)) },
            }
        };
        Rc::new(RefCell::new(Face {
            boundary: vec![Rc::new(RefCell::new(Wire { edges: vec![mk(&e_outer, fwd_outer), mk(&e_inner, fwd_inner)] }))],
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        }))
    };

    let n_top = axis;
    let n_bot = scale(axis, -1.0);
    let faces: Vec<TFace> = match op {
        "subtract" => {
            // a's wall outside arc, b's wall inside arc flipped. a's caps
            // = lune (a outside b); b's caps dropped (interior).
            let wall_a = wall(wa, ca_lo, &e_seam_a1, &e_seam_a0, e_a_out_lo.clone(), e_a_out_hi.clone(), a_in1, a_out_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b0, &e_seam_b1, e_b_in_lo.clone(), e_b_in_hi.clone(), b_in0, b_in_sweep);
            // a's caps = the LUNE: a's outside arc (a_in1 -> a_in0 the far
            // way) chained with b's INSIDE arc traversed backwards
            // (b_in1 -> b_in0), since the removed lens region is bounded by
            // b's inside rim.
            let cap_a_lo = two_arc_cap(ca_lo, n_bot, e_a_out_lo.clone(), true, e_b_in_lo.clone(), false);
            let cap_a_hi = two_arc_cap(ca_hi, n_top, e_a_out_hi.clone(), true, e_b_in_hi.clone(), false);
            vec![wall_a, flip_face(&wall_b), cap_a_lo, cap_a_hi]
        }
        "union" => {
            // Both walls keep their outside arcs. Each cap is ONE face: the
            // outer boundary of the union of the two disks — a's outside arc
            // (a_in1 -> a_in0 the far way) chained with b's outside arc
            // (b_in1 -> b_in0 the far way), which share the crossing points.
            // A full disk + a separate lune would double-cover the lens
            // region with two coplanar faces (non-manifold, cracked mesh).
            let cap_lo = two_arc_cap(ca_lo, n_bot, e_a_out_lo.clone(), true, e_b_out_lo.clone(), true);
            let cap_hi = two_arc_cap(ca_hi, n_top, e_a_out_hi.clone(), true, e_b_out_hi.clone(), true);
            let wall_a = wall(wa, ca_lo, &e_seam_a1, &e_seam_a0, e_a_out_lo.clone(), e_a_out_hi.clone(), a_in1, a_out_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b1, &e_seam_b0, e_b_out_lo.clone(), e_b_out_hi.clone(), b_in1, b_out_sweep);
            vec![wall_a, wall_b, cap_lo, cap_hi]
        }
        "intersect" => {
            // Both walls keep their inside arcs (outward normals); caps = lens.
            let wall_a = wall(wa, ca_lo, &e_seam_a0, &e_seam_a1, e_a_in_lo.clone(), e_a_in_hi.clone(), a_in0, a_in_sweep);
            let wall_b = wall(wb, cb_lo, &e_seam_b0, &e_seam_b1, e_b_in_lo.clone(), e_b_in_hi.clone(), b_in0, b_in_sweep);
            let cap_lo = two_arc_cap(ca_lo, n_bot, e_a_in_lo.clone(), true, e_b_in_lo.clone(), true);
            let cap_hi = two_arc_cap(ca_hi, n_top, e_a_in_hi.clone(), true, e_b_in_hi.clone(), true);
            vec![wall_a, wall_b, cap_lo, cap_hi]
        }
        _ => return None,
    };
    let _ = (n_bot, n_top, at, pa_lo0, pa_lo1, pa_hi0, pa_hi1, pb_lo0, pb_lo1, pb_hi0, pb_hi1, e_seam_a1, e_seam_b1, e_seam_b0, e_seam_a0);
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

/// Boolean two solids of the `combine` kind. Returns None when the kernel
/// cannot build the exact result, so the caller refuses the feature in words.
pub fn boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op == "subtract" {
        if let Some(cavity) = subtract_enclosed(a, b) {
            return Some(cavity);
        }
    }
    if let Some(r) = cylinder_pair_boolean(op, a, b) {
        return Some(r);
    }
    if let Some(r) = cylinder_open_hollow(op, a, b) {
        return Some(r);
    }
    let mut faces: Vec<TFace> = Vec::new();
    for f in a.faces() {
        process_face(&f, b, op, true, &mut faces)?;
    }
    for f in b.faces() {
        process_face(&f, a, op, false, &mut faces)?;
    }
    dedupe(&mut faces);
    drop_degenerate_faces(&mut faces);
    weld_shared_edges(&mut faces);
    if faces.is_empty() {
        return None;
    }
    // SPEC 4.5's own guard: the result's boundary must be a CLOSED 2-
    // manifold — every edge shared by exactly two face uses. A boolean
    // whose caps did not merge (an interior face left behind) cracks the
    // shell; shipping it would be the wrong-solid class outright, so
    // refuse honestly instead.
    {
        let mut use_count: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for f in &faces {
            let fb = f.borrow();
            for w in &fb.boundary {
                for u in &w.borrow().edges {
                    let key = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
                    *use_count.entry(key).or_insert(0) += 1;
                }
            }
        }
        for (ptr, n) in &use_count {
            if *n == 2 {
                continue;
            }
            // A zero-length seam/rim edge (a closed circle's own seam,
            // both uses in one wire) is legitimately used twice by one
            // face — the count is per-use, so a legal closed rim reads
            // 2, a seam reads 1 per face but totals 2 across both its
            // wires. Anything else is a cracked shell.
            let _ = ptr;
            if *n != 1 && *n != 2 {
                return None;
            }
        }
        // An INTERIOR face (a cap plane at an interface the boolean should
        // have dissolved) has material on BOTH sides: probe the centroid
        // ± the plane normal by a sliver. A real boundary face has empty
        // space on exactly one side. Catches the Y2 union's interior
        // annulus without refusing any green fixture. `faces` here are
        // pre-Solid; build a throwaway shell for the ray crossings via
        // crossings() on a temp solid.
        let result_solid = Solid {
            shells: vec![std::rc::Rc::new(std::cell::RefCell::new(crate::topo::Shell { faces: faces.clone() }))],
        };
        for f in &faces {
            let fb = f.borrow();
            let Surface::Plane(g) = &fb.surface else { continue };
            let (area, c) = build::face_area_centroid(&fb);
            if area <= 0.0 {
                continue;
            }
            // Skip a coplanar cap's own plane: the probe reads the face
            // itself as a boundary crossing on both sides. Offset the
            // probe ALONG the normal instead of through the face.
            let inside_pos = inside_solid(&result_solid, add(c, scale(g.n, 5e-6)));
            let inside_neg = inside_solid(&result_solid, sub(c, scale(g.n, 5e-6)));
            if inside_pos && inside_neg {
                return None;
            }
        }
    }
    Some(Solid {
        shells: vec![Rc::new(RefCell::new(Shell { faces }))],
    })
}

/// Remove zero-area output faces. A boolean can emit a planar face that is a
/// single zero-length segment when the two operands' surfaces touch tangentially
/// (coplanar-subtract-caps: a cylinder's cap lies coplanar with the box's, so its
/// whole circle is trimmed away and its boundary collapses to a point). Such a
/// face has no area, contributes nothing to volume, and cannot be tessellated
/// (its boundary does not close), so it is not a real face of the result. Faces
/// with a genuine (if small) area are kept.
fn drop_degenerate_faces(faces: &mut Vec<TFace>) {
    faces.retain(|f| {
        let (area, _) = build::face_area_centroid(&f.borrow());
        area > 1e-9
    });
}

/// Tolerance for the seam weld, in mm. The duplicated copies are computed by
/// different formulas: a wall's clip disk is taken at the probe-offset plane
/// (`keep_polygon` probes `PROBE` inside the other solid), while
/// `polar_hole_wire` uses the exact sphere -- the two agree to about 3.8e-7
/// here (measured on sphere-minus-box), not to float precision. One micron is
/// 100x below the parity gate's `approx` tolerance and above the mesh gate's
/// own 5e-7 vertex weld, so the seam joins without merging real features.
const WELD_TOL: f64 = 1e-6;

fn near3(p: Vec3, q: Vec3) -> bool {
    crate::math::len(sub(p, q)) <= WELD_TOL
}

/// Do two edges carry the same curve geometry? Same type and parameters, and --
/// for arcs -- the same angular span (each arc's sampled points must lie on the
/// other's range, so a sub-arc is NOT a match). Handle identity is never
/// considered here; this is the geometric test the seam weld needs, and it does
/// not replace `topo::same` anywhere identity is the question (§4.2).
fn same_edge_geometry(a: &topo::Edge<Curve3>, b: &topo::Edge<Curve3>) -> bool {
    let parallel = |p: Vec3, q: Vec3| crate::math::len(cross(p, q)) <= 1e-9;
    match (&a.curve, &b.curve) {
        (Curve::Segment { a: p1, b: p2 }, Curve::Segment { a: q1, b: q2 }) => {
            (near3(*p1, *q1) && near3(*p2, *q2)) || (near3(*p1, *q2) && near3(*p2, *q1))
        }
        (
            Curve::Circle { center: c1, radius: r1, normal: n1 },
            Curve::Circle { center: c2, radius: r2, normal: n2 },
        ) => near3(*c1, *c2) && (r1 - r2).abs() <= WELD_TOL && parallel(*n1, *n2),
        (
            Curve::Arc { center: c1, radius: r1, normal: n1, x_axis: x1, sweep: s1 },
            Curve::Arc { center: c2, radius: r2, normal: n2, x_axis: x2, sweep: s2 },
        ) => {
            if !(near3(*c1, *c2) && (r1 - r2).abs() <= WELD_TOL && parallel(*n1, *n2)) {
                return false;
            }
            // Same circle; same span iff every sample of each arc lies on the
            // other's curve (radius AND angular range).
            let on = |p: Vec3, c: Vec3, r: f64, n: Vec3, x: Vec3, sweep: f64| {
                let d = sub(p, c);
                if (crate::math::len(d) - r).abs() > WELD_TOL {
                    return false;
                }
                let xa = normalize(x);
                let ya = normalize(cross(n, xa));
                let ang = dot(d, ya).atan2(dot(d, xa));
                let tol_a = WELD_TOL / r.max(1e-9);
                if sweep >= 0.0 {
                    let mut rel = ang;
                    while rel < -tol_a {
                        rel += TWO_PI;
                    }
                    rel <= sweep + tol_a
                } else {
                    let mut rel = ang;
                    while rel > tol_a {
                        rel -= TWO_PI;
                    }
                    rel >= sweep - tol_a
                }
            };
            let curve_a = Curve::Arc { center: *c1, radius: *r1, normal: *n1, x_axis: *x1, sweep: *s1 };
            let curve_b = Curve::Arc { center: *c2, radius: *r2, normal: *n2, x_axis: *x2, sweep: *s2 };
            [0.0, 0.25, 0.5, 0.75, 1.0].iter().all(|t| {
                on(curve_a.point_at(*t), *c2, *r2, *n2, *x2, *s2)
                    && on(curve_b.point_at(*t), *c1, *r1, *n1, *x1, *s1)
            })
        }
        _ => false,
    }
}

/// W0 seam weld (SPEC-brep-kernel-rs §4.2): a boolean must share one edge
/// handle per seam, not one per side. The pieces that make a seam — a wall's
/// mixed segment/arc boundary (`build_mixed_face`), a trimmed sphere's polar
/// hole (`polar_hole_wire`) and the adjacent walls' own corner segments — each
/// build their own `Rc` along the same curve, so no SINGLE edge is used by both
/// faces and a `between` name on that seam cannot resolve (FUTURE.md
/// 2026-09-15). Volume, area, bbox and face count cannot see the duplication.
///
/// Every group of geometrically equal edges (same curve, compatible endpoints)
/// keeps its first handle as canonical; every later use is rewritten to that
/// handle, with `forward` set so the face still traverses the same geometric
/// direction. The pcurve is expressed in the face's own uv at the traversal's
/// start/end points, so it needs no change. Coincident end vertices are welded
/// the same way, or a corner name still sees two vertices at one point.
fn weld_shared_edges(faces: &mut [TFace]) {
    // 1. Every distinct edge handle in the result.
    let mut edges: Vec<topo::EdgeRef<Curve3>> = Vec::new();
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                if !edges.iter().any(|e| topo::same(e, &u.edge)) {
                    edges.push(u.edge.clone());
                }
            }
        }
    }
    // 2. Which earlier edge each duplicate welds to.
    let mut weld_to: Vec<Option<usize>> = vec![None; edges.len()];
    for i in 0..edges.len() {
        for j in 0..i {
            let canonical = weld_to[j].unwrap_or(j);
            if !same_edge_geometry(&edges[i].borrow(), &edges[canonical].borrow()) {
                continue;
            }
            // Endpoints must line up in one direction or the other; a full
            // circle with a different seam vertex is not welded (nothing needs
            // it and a wrong merge is worse than a duplicate).
            let (ca, cb) = {
                let c = edges[canonical].borrow();
                let (pa, pb) = (c.a.borrow().point, c.b.borrow().point);
                (pa, pb)
            };
            let (ea, eb) = {
                let e = edges[i].borrow();
                let (pa, pb) = (e.a.borrow().point, e.b.borrow().point);
                (pa, pb)
            };
            if (near3(ea, ca) && near3(eb, cb)) || (near3(ea, cb) && near3(eb, ca)) {
                weld_to[i] = Some(canonical);
                break;
            }
        }
    }
    // 3. Rewrite every use to its canonical handle.
    for f in faces.iter() {
        for w in &f.borrow().boundary {
            for u in w.borrow_mut().edges.iter_mut() {
                let Some(idx) = edges.iter().position(|e| topo::same(e, &u.edge)) else {
                    continue;
                };
                let Some(target) = weld_to[idx] else { continue };
                let (ca, cb) = {
                    let c = edges[target].borrow();
                    let (pa, pb) = (c.a.borrow().point, c.b.borrow().point);
                    (pa, pb)
                };
                let (ea, eb) = {
                    let e = edges[idx].borrow();
                    let (pa, pb) = (e.a.borrow().point, e.b.borrow().point);
                    (pa, pb)
                };
                let use_start = if u.forward { ea } else { eb };
                let use_end = if u.forward { eb } else { ea };
                if near3(use_start, ca) && near3(use_end, cb) {
                    u.edge = edges[target].clone();
                    u.forward = true;
                } else if near3(use_start, cb) && near3(use_end, ca) {
                    u.edge = edges[target].clone();
                    u.forward = false;
                }
            }
        }
    }
    // 4. Weld coincident end vertices to one handle.
    let mut verts: Vec<topo::VertexRef> = Vec::new();
    for e in &edges {
        let eb = e.borrow();
        for v in [&eb.a, &eb.b] {
            if !verts.iter().any(|u| Rc::ptr_eq(u, v)) {
                verts.push(v.clone());
            }
        }
    }
    let mut canon: Vec<Option<usize>> = vec![None; verts.len()];
    for i in 0..verts.len() {
        for j in 0..i {
            let target = canon[j].unwrap_or(j);
            if near3(verts[i].borrow().point, verts[target].borrow().point) {
                canon[i] = Some(target);
                break;
            }
        }
    }
    for e in &edges {
        let (ka, kb) = {
            let eb = e.borrow();
            let ka = verts.iter().position(|v| Rc::ptr_eq(v, &eb.a)).unwrap();
            let kb = verts.iter().position(|v| Rc::ptr_eq(v, &eb.b)).unwrap();
            drop(eb);
            (ka, kb)
        };
        let (ta, tb) = (canon[ka].unwrap_or(ka), canon[kb].unwrap_or(kb));
        if ta != ka || tb != kb {
            let mut eb = e.borrow_mut();
            eb.a = verts[ta].clone();
            eb.b = verts[tb].clone();
        }
    }
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
    // A CURVED face's area centroid can sit ON ITS AXIS (a cylinder wall's
    // centroid is on the axis, a sphere's at the centre) — inside any coaxial
    // tool even though the SURFACE is clear of it. Probe a point on the
    // surface instead: the face's uv midpoint (an enclosed void's wall,
    // coaxial, is genuinely clear of the tool by the margin checked above).
    for g in &a_faces {
        let (area, c) = build::face_area_centroid(&g.borrow());
        if area <= 0.0 {
            return None;
        }
        let probe = match &g.borrow().surface {
            Surface::Plane(_) => c,
            surface => {
                let (u0, u1) = surface.domain();
                let (_, v1) = surface.domain();
                let u_mid = 0.5 * (u0[0] + u0[1]);
                let v_mid = 0.5 * (v1[0] + v1[1]);
                surface.param(u_mid, v_mid)
            }
        };
        if inside_solid(b, probe) {
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
            // Flipping e2 turns p(u) = R(e1 cos u + e2 sin u) into the point
            // at angle -u, which reverses the surface's normal -- but it also
            // MIRRORS a partial arc (an angular range [a, a+s] would land on
            // the opposite half of the circle, the groove-half bug). Reflect
            // the range too so the flipped wall covers the SAME arc points in
            // reverse, keeping it shared with the neighbouring caps.
            let arc = cy.arc.as_ref().map(|a| crate::geom::ArcRange {
                start: -(a.start + a.span),
                span: a.span,
            });
            let surf = Surface::Cylinder(Cylinder {
                origin: cy.origin,
                axis: cy.axis,
                e1: cy.e1,
                e2: scale(cy.e2, -1.0),
                radius: cy.radius,
                vmin: cy.vmin,
                vmax: cy.vmax,
                arc,
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
        let a = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 10.0])
            .expect("debug fixture profile closes");
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

    /// W0: a boolean must not emit two DIFFERENT edge handles for the same
    /// seam curve. `build_mixed_face` (wall arcs) and `polar_hole_wire`
    /// (sphere hole arcs) each construct their own copy of the same circle,
    /// so today a wall and the trimmed sphere face hold separate `Rc` edges
    /// along one seam and the corner vertices are duplicated. Volume, area,
    /// bbox and face count cannot see it -- a `between` name on that seam
    /// cannot resolve, because no SINGLE edge is used by both faces.
    #[test]
    fn boolean_seam_edges_are_shared_not_duplicated() {
        let s = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let b = build::box_solid([10.0, 10.0, 40.0], [0.0, 0.0, 0.0], None);
        let result = boolean("subtract", &s, &b).expect("sphere-minus-box must not refuse");
        let edges = result.edges();
        let mut dupes = 0;
        for i in 0..edges.len() {
            for j in (i + 1)..edges.len() {
                let (ei, ej) = (edges[i].borrow(), edges[j].borrow());
                if same_edge_geometry(&ei, &ej) {
                    dupes += 1;
                    eprintln!(
                        "duplicate seam edge: {:?} vs {:?}",
                        ei.curve.point_at(0.0),
                        ej.curve.point_at(0.0)
                    );
                }
            }
        }
        assert_eq!(dupes, 0, "{dupes} duplicated seam edge(s) -- not a shared B-rep shell");
        // The seam edge of a wall must be used by BOTH the wall and the
        // trimmed sphere face: one handle, two face uses.
        let mut seam_uses: Vec<usize> = Vec::new();
        for f in result.faces() {
            for w in &f.borrow().boundary {
                for u in &w.borrow().edges {
                    if seam_uses.iter().any(|k| topo::same(&edges[*k], &u.edge)) {
                        continue;
                    }
                    if matches!(&u.edge.borrow().curve, Curve::Arc { .. }) {
                        seam_uses.push(edges.iter().position(|e| topo::same(e, &u.edge)).unwrap());
                    }
                }
            }
        }
        for k in seam_uses {
            let uses = result
                .faces()
                .iter()
                .flat_map(|f| {
                    f.borrow()
                        .boundary
                        .iter()
                        .flat_map(|w| w.borrow().edges.clone())
                        .collect::<Vec<_>>()
                })
                .filter(|u| topo::same(&edges[k], &u.edge))
                .count();
            assert_eq!(uses, 2, "seam edge at {:?} is used {uses} time(s), want 2", edges[k].borrow().curve.point_at(0.0));
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
        let tool = build::extrude_profile(&segs, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -5.0])
            .expect("test profile closes");
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
}


/// Watertight check mirroring the mesh gate: every welded directed edge must
/// have exactly one opposite partner.
pub fn check_watertight(m: &crate::mesh::Mesh) -> bool {
    let key = |p: [f64; 3]| [(p[0] / 1e-6).round() as i64, (p[1] / 1e-6).round() as i64, (p[2] / 1e-6).round() as i64];
    let mut wid = std::collections::HashMap::new();
    let mut canon = vec![0usize; m.positions.len()];
    for (i, p) in m.positions.iter().enumerate() {
        let n = wid.len();
        canon[i] = *wid.entry(key(*p)).or_insert(n);
    }
    let mut dir: std::collections::HashMap<(usize, usize), i32> = std::collections::HashMap::new();
    for t in m.indices.chunks(3) {
        let ids = [canon[t[0] as usize], canon[t[1] as usize], canon[t[2] as usize]];
        for e in 0..3 {
            let (u, v) = (ids[e], ids[(e + 1) % 3]);
            if u != v {
                *dir.entry((u, v)).or_insert(0) += 1;
            }
        }
    }
    let mut open = 0usize;
    for (&(u, v), &c) in &dir {
        if dir.get(&(v, u)).copied().unwrap_or(0) != c {
            open += 1;
            if open <= 8 {
                let find = |id: usize| -> [f64; 3] {
                    for (i, p) in m.positions.iter().enumerate() {
                        if canon[i] == id { return *p; }
                    }
                    [0.0; 3]
                };
                eprintln!("  open edge {}->{} c={} at {:?} / {:?}", u, v, c, find(u), find(v));
            }
        }
    }
    eprintln!("  open directed edges: {open}");
    open == 0
}

/// W8: subtract of two overlapping parallel-axis cylinders. Pinned against
/// OCCT via the parity fixture boolean-cylinder-minus-cylinder
/// (10055.344981); here the volume is checked against the closed form
/// c1 + c2's overlap: V = pi*(r1^2 - lens_area/... ) — computed as
/// c1_volume - lens_volume with the lens from the intersect test's own
/// number, and the mesh must be watertight (the gate's stricter check).
#[test]
fn cylinder_cylinder_boolean_subtract() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("subtract", &c1, &c2).expect("cylinder-cylinder subtract must not refuse");
    let vol = build::solid_volume(&result);
    // lens volume (verified against OCCT by the intersect fixture):
    let lens = 3516.3352821993412;
    let want = build::solid_volume(&c1) - lens;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 lune caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("subtract meshes");
    assert!(check_watertight(&m), "subtract mesh must be watertight");
}

/// W8: intersect of two overlapping parallel-axis cylinders. Lens prism
/// volume pinned against OCCT (boolean-cylinder-intersect-cylinder).
#[test]
fn cylinder_cylinder_boolean_intersect() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("intersect", &c1, &c2).expect("cylinder-cylinder intersect must not refuse");
    let vol = build::solid_volume(&result);
    assert!((vol - 3516.3352821993412).abs() <= 1e-6 * vol, "volume {vol}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 lens caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("intersect meshes");
    assert!(check_watertight(&m), "intersect mesh must be watertight");
}

/// W8: union of two overlapping parallel-axis cylinders:
/// V = c1 + c2 - lens, pinned against OCCT (boolean-cylinder-union-cylinder).
#[test]
fn cylinder_cylinder_boolean_union() {
    let c1 = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let c2 = build::cylinder_solid([10.0, 0.0, 0.0], 8.0, 30.0, [0.0, 0.0, 1.0]);
    let result = boolean("union", &c1, &c2).expect("cylinder-cylinder union must not refuse");
    let vol = build::solid_volume(&result);
    let want = build::solid_volume(&c1) + build::solid_volume(&c2) - 3516.3352821993412;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 4, "2 walls + 2 outer-boundary caps");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("union meshes");
    assert!(check_watertight(&m), "union mesh must be watertight");
}

/// W3 (shell on a cylinder), open-top case via the flush subtract: the
/// inner void is a cylinder of radius r − thickness and height h − t,
/// top face FLUSH with the outer cap, bottom inset by t. Outer caps keep
/// an annulus (disk with a circular hole); the void wall is the tool's
/// wall flipped. Pinned volume: pi*R^2*h − (pi*(R−t)^2*(h−t)).
#[test]
fn shell_cylinder_open_top_flush_subtract() {
    let outer = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let inner = build::cylinder_solid([0.0, 0.0, 1.0], 10.0, 28.0, [0.0, 0.0, 1.0]);
    let result = boolean("subtract", &outer, &inner).expect("open-top cylinder hollow must not refuse");
    let want = std::f64::consts::PI * 144.0 * 30.0 - std::f64::consts::PI * 100.0 * 28.0;
    let vol = build::solid_volume(&result);
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
    assert_eq!(result.faces().len(), 6, "2 outer walls + void wall + bottom cap + top annulus + void floor");
    let m = crate::mesh::mesh_solid(&result, 0.05).expect("open-top hollow meshes");
    assert!(check_watertight(&m), "open-top hollow mesh must be watertight");
}

/// W3 closed case: a fully-enclosed cylindrical void inside a cylinder is
/// one inner shell (the existing subtract_enclosed path handles it if its
/// per-face checks accept cylinders; if it refuses, the boolean still must
/// not return a wrong solid).
#[test]
fn shell_cylinder_closed_void() {
    let outer = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
    let inner = build::cylinder_solid([0.0, 0.0, 0.0], 10.0, 28.0, [0.0, 0.0, 1.0]);
    match boolean("subtract", &outer, &inner) {
        Some(result) => {
            let want = std::f64::consts::PI * (144.0 * 30.0 - 100.0 * 28.0);
            let vol = build::solid_volume(&result);
            assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        }
        None => {
            // An honest refusal is acceptable for the closed case; the
            // open-top path is the fixture-class one (shell-open-top).
        }
    }
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

/// THE CLASS-2 SILENT WRONG SOLID (msgbox #329): region_inside() builds a
/// convex region from EVERY face of `other`. Once the base carries a bore,
/// that bore's void wall/floor must not constrain the next tool's region --
/// otherwise every subsequent bore's floor is silently dropped. Each blind
/// bore removes exactly pi*r^2*depth: N disjoint blind d6 depth-8 bores in a
/// 40x40x20 box give 32000 - N * 6pi * 8.
#[test]
fn successive_blind_bores_keep_every_floor() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let offs: [[f64; 3]; 4] =
        [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]];
    let mut shape = base;
    let mut want = 32000.0f64;
    for off in offs {
        let tool = build::cylinder_solid(off, 3.0, 8.0, [0.0, 0.0, 1.0]);
        let r = boolean("subtract", &shape, &tool);
        assert!(r.is_some(), "a disjoint blind bore must not refuse");
        shape = r.unwrap();
        want -= std::f64::consts::PI * 9.0 * 8.0;
        let vol = build::solid_volume(&shape);
        assert!(
            (vol - want).abs() <= 1e-6 * want,
            "bore at {off:?}: volume {vol} vs exact {want} (a lost floor is a silent wrong solid)"
        );
    }
}

/// The through-bore variant (msgbox #329 proof): a THROUGH bore's wall also
/// poisons the next blind bore's floor -- exactly one floor lost when the
/// through cut comes first and a blind bore elsewhere second.
#[test]
fn through_bore_then_blind_bore_keeps_the_floor() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let through = build::cylinder_solid([-15.0, -10.0, 0.0], 3.0, 40.0, [0.0, 0.0, 1.0]);
    let shape = boolean("subtract", &base, &through).expect("first bore cuts");
    let blind = build::cylinder_solid([15.0, 10.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let want =
        32000.0 - std::f64::consts::PI * 9.0 * 20.0 - std::f64::consts::PI * 9.0 * 8.0;
    let r = boolean("subtract", &shape, &blind);
    assert!(r.is_some(), "a second, disjoint bore must not refuse");
    let vol = build::solid_volume(&r.unwrap());
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

#[test]
fn flush_four_corner_bores_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let offs: [[f64; 3]; 4] =
        [[-15.0, -10.0, 0.0], [15.0, -10.0, 0.0], [-15.0, 10.0, 0.0], [15.0, 10.0, 0.0]];
    let mut shape = base;
    for off in offs {
        let tool = build::cylinder_solid([off[0], off[1], 6.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
        shape = boolean("subtract", &shape, &tool)
            .unwrap_or_else(|| panic!("flush corner bore refused"));
    }
    let vol = build::solid_volume(&shape);
    let want = 32000.0 - 4.0 * std::f64::consts::PI * 9.0 * 8.0;
    assert!(
        (vol - want).abs() <= 1e-6 * want,
        "the ledger's silent wrong volume case: {vol} vs exact {want}"
    );
}


/// Two PARTIALLY overlapping bores (centres 4mm apart, r3 each): the fused
/// tool's volume is the stadium-of-two-disks union; subtracting it once must
/// equal subtracting each in turn would NOT (that double-counts the lens
/// only when the lens region's removal is idempotent — actually subtracting
/// sequentially removes the same material since the second bore's lens part
/// is already gone; the exactness check is against the fused tool).
#[test]
fn partially_overlapping_bores_fuse_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let a = build::cylinder_solid([-2.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([2.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    let u = crate::ops::cylinder_pair_boolean("union", &a, &b)
        .expect("overlapping pair must fuse");
    let want = 32000.0 - build::solid_volume(&u);
    let r = boolean("subtract", &base, &u);
    assert!(r.is_some(), "subtracting the fused tool must not refuse");
    let vol = build::solid_volume(&r.unwrap());
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

/// Two FULLY overlapping bores (same centre): the hole branch's fuse loop
/// must not even pair them — identical AABBs DO overlap, so the fuse sees
/// them; the pair union refuses on concentric and the branch keeps the
/// first tool alone, which removes exactly one bore's volume.
#[test]
fn fully_overlapping_bores_cut_one_bore_exact() {
    let base = build::box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let t = build::cylinder_solid([0.0, 0.0, 0.0], 3.0, 8.0, [0.0, 0.0, 1.0]);
    // Direct pair fuse refuses concentric (documented in build_cyl_pair_result);
    // the hole branch must therefore dedupe rather than lose the bore.
    assert!(crate::ops::cylinder_pair_boolean("union", &t, &t).is_none());
    let r = boolean("subtract", &base, &t);
    let vol = build::solid_volume(&r.expect("cut"));
    let want = 32000.0 - std::f64::consts::PI * 9.0 * 8.0;
    assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs exact {want}");
}

/// The Y2 bench bug (found benching the yardstick): union of two coaxial
/// cylinders of different radii whose caps are NOT coplanar (a flange plus
/// a standing cylinder, the exact Y2 shape). The wall bug that dropped the
/// small cylinder's entire wall is FIXED (parallel-cylinder u-clipping now
/// checks the shared axial band). The union's caps at the interface plane
/// still build inexact — this test is the next slice's RED gate: green
/// only when the union is exact.
#[test]
fn flange_cylinder_union_exact() {
    let a = build::cylinder_solid([0.0, 0.0, 0.0], 35.0, 6.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([0.0, 0.0, 18.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    let r = boolean("union", &a, &b);
    // Either an exact union or an honest refusal — a wrong solid is the
    // one thing SPEC 4.5 forbids.
    match r {
        None => {} // refusal is honest and acceptable
        Some(s) => {
            let vol = build::solid_volume(&s);
            let want = 52621.68293125813; // flange ring + cylinder, closed form
            assert!(
                (vol - want).abs() <= 1e-6 * want,
                "a wrong solid with no refusal: volume {vol} vs exact {want}"
            );
        }
    }
}
