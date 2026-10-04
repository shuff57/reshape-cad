//! Split-and-classify boolean for solids made of planes, cylinder walls, spheres and cones
//! (docs/specs/SPEC-brep-boolean-split-classify.md, slices S1 and S2).
//!
//! The older boolean in `ops` decides each face's fate with a convex region
//! algebra, so a concave operand (a hollowed box, a part with a pocket or a
//! bore) is refused. This path does not need convexity:
//!
//! 1. INTERSECT. Every face of one operand is cut by the other operand's
//!    boundary. On a plane face a cut is a line segment or a circular arc;
//!    a face on the SAME plane contributes its own edges. A cylinder wall is
//!    a rectangle in (angle, height), so only a plane parallel to the axis
//!    (two lines) or square to it (one circle) can cut it, and only along its
//!    whole length; anything else refuses.
//! 2. SPLIT. A plane face's outline and cuts are noded into a planar graph
//!    (segments and arcs) and traced into sub-regions with holes. A cylinder
//!    wall splits into a grid of rectangles.
//! 3. CLASSIFY. One interior sample per region is ON a coplanar face of the
//!    other solid (same or opposite normal) or inside or outside it.
//! 4. SELECT AND SEW. The op table keeps regions; twin edges are welded by
//!    the existing `weld_shared_edges`, and the result must pass every guard.
//!
//! The contract with the caller is three-valued so a failed guard can never
//! fall through to a path that is known to return wrong solids: `NotPlanar`
//! (the caller may try something else), `Refused` (stop, refuse the feature)
//! and `Built`.
//!
//! A sphere or cone face (S4h) is a band between two heights on ONE axis shared by the pair,
//! cut only at constant heights (a plane square to the axis, a coaxial cylinder, sphere or
//! cone); see the section "Spheres and cones about ONE axis" below.
//!
//! Sampled polygons appear below ONLY to decide orientation and containment;
//! no result geometry is ever a sampled curve.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;
use std::rc::Rc;

use crate::build::{self, TFace, TSolid};
use crate::geom::{ArcRange, Cone, Curve, Cylinder, Plane, SphereSurf, Surface};
use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use crate::ops;
use crate::topo::{self, Face, Pcurve, Shell, Solid, Wire};

/// Every refusal in this module goes through here; under `cargo test` it names
/// the line, which is how a case that unexpectedly refuses gets diagnosed.
macro_rules! bail {
    () => {{
        if cfg!(test) {
            eprintln!("planar boolean refused at line {}", line!());
        }
        return Err(());
    }};
}

/// Geometric tolerance for "the same place", in mm. Edges are shared by
/// handle after the weld, never by coordinates alone; every coordinate
/// comparison below goes through this one number.
const EPS: f64 = 1e-7;

#[cfg(test)]
thread_local! {
    /// Test-only: let a result through the soundness probe so its volume can be inspected.
    static SKIP_SOUND: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

thread_local! {
    static REASON: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
    /// The operation `core` is building (0 union, 1 subtract, 2 intersect), read by [`tangent_allowed`].
    static CUR_OP: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

/// Forget the reason a previous refusal left behind (call before a boolean whose reason will be read).
pub fn clear_reason() {
    REASON.with(|r| r.set(None));
}

/// The plain sentence for the last refusal of `carry_subtract`, if it left one.
pub fn take_reason() -> Option<&'static str> {
    REASON.with(|r| r.take())
}

pub enum Outcome {
    /// An operand has a face or an edge this path does not model.
    NotPlanar,
    /// Applies, but the result could not be proven sound. Refuse.
    Refused,
    Built(TSolid),
}

type P2 = [f64; 2];

fn cross2(a: P2, b: P2) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn sub2(a: P2, b: P2) -> P2 {
    [a[0] - b[0], a[1] - b[1]]
}
fn dot2(a: P2, b: P2) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn dist2(a: P2, b: P2) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// `a` shifted into [0, 2pi).
fn pos_ang(a: f64) -> f64 {
    let r = a.rem_euclid(TAU);
    if r >= TAU {
        0.0
    } else {
        r
    }
}

// ---------------------------------------------------------------------------
// Curves: 3D as stored on a face, 2D once projected into a plane's (u, v).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
enum C3 {
    Seg(Vec3, Vec3),
    /// A circular arc (a whole circle when |sweep| = 2pi): `start` is on the
    /// circle, `sweep` is signed about `normal`.
    Arc { center: Vec3, radius: f64, normal: Vec3, start: Vec3, sweep: f64 },
}

/// A 2D edge in a plane's uv: a segment, or a counter-clockwise arc from
/// angle `a0` through `sw` (`sw` = 2pi is a whole circle).
#[derive(Clone, Copy, Debug)]
enum E2 {
    Seg(P2, P2),
    Arc { c: P2, r: f64, a0: f64, sw: f64 },
}

fn ang_pt(c: P2, r: f64, a: f64) -> P2 {
    [c[0] + r * a.cos(), c[1] + r * a.sin()]
}

impl E2 {
    fn at(&self, t: f64) -> P2 {
        match *self {
            E2::Seg(a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            E2::Arc { c, r, a0, sw } => ang_pt(c, r, a0 + sw * t),
        }
    }
    fn length(&self) -> f64 {
        match *self {
            E2::Seg(a, b) => dist2(a, b),
            E2::Arc { r, sw, .. } => r * sw,
        }
    }
    /// Direction of increasing parameter at `t`, and its signed curvature.
    fn tangent(&self, t: f64) -> (P2, f64) {
        match *self {
            E2::Seg(a, b) => (sub2(b, a), 0.0),
            E2::Arc { r, a0, sw, .. } => {
                let th = a0 + sw * t;
                ([-th.sin(), th.cos()], 1.0 / r)
            }
        }
    }
    /// Points along the edge in either direction (excluding the far end).
    fn sample(&self, reversed: bool) -> Vec<P2> {
        let n = match *self {
            E2::Seg(..) => 1,
            E2::Arc { sw, .. } => ((sw / TAU * 128.0).ceil() as usize).max(8),
        };
        (0..n)
            .map(|k| {
                let t = k as f64 / n as f64;
                self.at(if reversed { 1.0 - t } else { t })
            })
            .collect()
    }
    fn is_full(&self) -> bool {
        matches!(*self, E2::Arc { sw, .. } if (sw - TAU).abs() < 1e-9)
    }
}

/// The parameter in [0, 1] of angle `th` on an arc, when it lies on it.
fn arc_param(a0: f64, sw: f64, r: f64, th: f64) -> Option<f64> {
    let rel = pos_ang(th - a0);
    let tol = EPS / r.max(1e-9);
    if rel <= sw + tol {
        Some((rel / sw).min(1.0))
    } else if rel >= TAU - tol {
        Some(0.0)
    } else {
        None
    }
}

fn to_e2(c: &C3, plane: &Plane) -> Option<E2> {
    match *c {
        C3::Seg(a, b) => Some(E2::Seg(plane.project(a), plane.project(b))),
        C3::Arc { center, radius, normal, start, sweep } => {
            if dot(normal, plane.n).abs() < 1.0 - 1e-9 {
                return None;
            }
            let c2 = plane.project(center);
            let s2 = sub2(plane.project(start), c2);
            let a0 = s2[1].atan2(s2[0]);
            let handed = dot(normal, cross(plane.u, plane.v)).signum() * sweep.signum();
            let sw = sweep.abs().min(TAU);
            Some(if handed > 0.0 { E2::Arc { c: c2, r: radius, a0, sw } } else { E2::Arc { c: c2, r: radius, a0: a0 - sw, sw } })
        }
    }
}

// ---------------------------------------------------------------------------
// Operand faces.
// ---------------------------------------------------------------------------

struct PFace {
    plane: Plane,
    curves: Vec<C3>,
    /// `curves` in this face's own uv.
    edges: Vec<E2>,
}

struct CFace {
    cyl: Cylinder,
    /// First angle and angular span of the wall (a whole turn is 2pi).
    u0: f64,
    span: f64,
}

enum AFace {
    Plane(PFace),
    Cyl(CFace),
    /// A full-turn sphere zone or cone band about the one axis every such face of the pair shares.
    Rev(RFace),
}

fn cyl_pt(c: &Cylinder, th: f64, v: f64) -> Vec3 {
    add(add(c.origin, scale(c.axis, v)), scale(add(scale(c.e1, th.cos()), scale(c.e2, th.sin())), c.radius))
}

fn cyl_hand(c: &Cylinder) -> f64 {
    if dot(cross(c.e1, c.e2), c.axis) >= 0.0 {
        1.0
    } else {
        -1.0
    }
}

fn extract(solid: &TSolid) -> Option<Vec<AFace>> {
    let mut out = Vec::new();
    for f in solid.faces() {
        let fb = f.borrow();
        match &fb.surface {
            Surface::Plane(plane) => {
                let mut curves = Vec::new();
                for w in &fb.boundary {
                    for u in &w.borrow().edges {
                        let e = u.edge.borrow();
                        curves.push(match &e.curve {
                            Curve::Segment { a, b } => C3::Seg(*a, *b),
                            Curve::Circle { center, radius, normal } => {
                                C3::Arc { center: *center, radius: *radius, normal: *normal, start: e.a.borrow().point, sweep: TAU }
                            }
                            Curve::Arc { center, radius, normal, x_axis, sweep } => C3::Arc {
                                center: *center,
                                radius: *radius,
                                normal: *normal,
                                start: add(*center, scale(normalize(*x_axis), *radius)),
                                sweep: *sweep,
                            },
                            _ => return None,
                        });
                    }
                }
                if curves.is_empty() {
                    return None;
                }
                let edges: Option<Vec<E2>> = curves.iter().map(|c| to_e2(c, plane)).collect();
                out.push(AFace::Plane(PFace { plane: plane.clone(), curves, edges: edges? }));
            }
            Surface::Cylinder(cy) => {
                if cy.cross.is_some() || fb.boundary.len() != 1 || cy.radius <= EPS {
                    return None;
                }
                let (u0, span) = match &cy.arc {
                    Some(a) => (a.start, a.span),
                    None => (0.0, TAU),
                };
                out.push(AFace::Cyl(CFace { cyl: cy.clone(), u0, span }));
            }
            Surface::Sphere(sp) => {
                let full_u = (sp.u_range[1] - sp.u_range[0] - TAU).abs() < 1e-9;
                if sp.trim.is_some() || !full_u || sp.u_range[0].abs() > 1e-9 || fb.boundary.len() != 1 || !fb.forward || sp.radius <= EPS {
                    return None;
                }
                out.push(AFace::Rev(RFace::unplaced(Surface::Sphere(sp.clone()))));
            }
            Surface::Cone(c) => {
                if fb.boundary.len() != 1 || !fb.forward || c.base_radius <= EPS || c.half_angle <= 1e-6 || c.half_angle >= std::f64::consts::FRAC_PI_2 - 1e-6 || c.v_range[1] - c.v_range[0] <= EPS {
                    return None;
                }
                out.push(AFace::Rev(RFace::unplaced(Surface::Cone(c.clone()))));
            }
            _ => return None,
        }
    }
    Some(out)
}

/// A whole circle on a plane face has an arbitrary start; the cylinder wall it
/// bounds has its seam at angle zero. Start the circle at the seam, or the two
/// halves of one circle cannot be welded after a cut.
fn align_circles(out: &mut [AFace]) -> Option<()> {
    let walls: Vec<Cylinder> = out.iter().filter_map(|f| if let AFace::Cyl(c) = f { Some(c.cyl.clone()) } else { None }).collect();
    for f in out.iter_mut() {
        if let AFace::Plane(p) = f {
            for c in p.curves.iter_mut() {
                if let C3::Arc { center, radius, start, sweep, .. } = c {
                    if sweep.abs() < TAU - 1e-9 {
                        continue;
                    }
                    for w in &walls {
                        let rel = sub(*center, w.origin);
                        let v = dot(rel, w.axis);
                        let off = len(sub(rel, scale(w.axis, v)));
                        if off < EPS && (*radius - w.radius).abs() < EPS && ((v - w.vmin).abs() < EPS || (v - w.vmax).abs() < EPS) {
                            *start = cyl_pt(w, 0.0, v);
                            break;
                        }
                    }
                }
            }
            p.edges = p.curves.iter().map(|c| to_e2(c, &p.plane)).collect::<Option<_>>()?;
        }
    }
    Some(())
}

type Box3 = ([f64; 3], [f64; 3]);

fn aabb_plane(curves: &[C3]) -> Box3 {
    let mut b = ([f64::MAX; 3], [f64::MIN; 3]);
    for c in curves {
        let (p, pad) = match *c {
            C3::Seg(a, bb) => {
                for q in [a, bb] {
                    for k in 0..3 {
                        b.0[k] = b.0[k].min(q[k]);
                        b.1[k] = b.1[k].max(q[k]);
                    }
                }
                continue;
            }
            C3::Arc { center, radius, .. } => (center, radius),
        };
        for k in 0..3 {
            b.0[k] = b.0[k].min(p[k] - pad);
            b.1[k] = b.1[k].max(p[k] + pad);
        }
    }
    b
}

fn aabb_cyl(c: &Cylinder) -> Box3 {
    let mut b = ([f64::MAX; 3], [f64::MIN; 3]);
    for v in [c.vmin, c.vmax] {
        let p = add(c.origin, scale(c.axis, v));
        for k in 0..3 {
            b.0[k] = b.0[k].min(p[k] - c.radius);
            b.1[k] = b.1[k].max(p[k] + c.radius);
        }
    }
    b
}

fn aabb(f: &AFace) -> Box3 {
    match f {
        AFace::Plane(p) => aabb_plane(&p.curves),
        AFace::Cyl(c) => aabb_cyl(&c.cyl),
        AFace::Rev(r) => aabb_rev(r),
    }
}

fn boxes_meet(a: &Box3, b: &Box3) -> bool {
    (0..3).all(|k| a.0[k] <= b.1[k] + EPS && b.0[k] <= a.1[k] + EPS)
}

// ---------------------------------------------------------------------------
// Spheres and cones about ONE axis (S4h).
//
// Every plane section of a sphere is a circle, but only a plane SQUARE to the sphere's polar axis
// gives a circle of constant latitude, and the same holds for a cone. So a sphere or cone face is
// handled only when every cut on it is such a circle: a plane square to the axis, a cylinder
// about the axis, or another sphere or cone about the axis. Each such face is a band between two
// heights on the axis (a full turn in angle), cut at constant heights into bands that are each
// classified whole. Anything else (an oblique or parallel plane that reaches the surface, a
// cylinder off the axis, a tangent, a coincident surface) refuses.
// ---------------------------------------------------------------------------

/// The axis shared by every sphere and cone face of a pair, and the direction (`e1`) every
/// circle starts at, so that the two bands that meet on a circle agree on its seam vertex.
#[derive(Clone, Copy, Debug)]
struct Fam {
    o: Vec3,
    a: Vec3,
    e1: Vec3,
}

#[derive(Clone)]
struct RFace {
    surf: Surface,
    fam: Fam,
    /// +1 when the face's own axis points along the family axis, -1 against it.
    sigma: f64,
    /// Position on the family axis (from `fam.o`) of the sphere's centre or the cone's base.
    z0: f64,
    /// Axial extent of the face (family coordinates).
    zlo: f64,
    zhi: f64,
}

/// The radius of a surface of revolution as a function of the position on the axis.
#[derive(Clone, Copy, Debug)]
enum Prof {
    /// A sphere of radius `r` centred at `zc`.
    Sphere { zc: f64, r: f64 },
    /// `rho = a + m z`: a cylinder (m = 0) or a cone.
    Line { a: f64, m: f64 },
}

impl Prof {
    fn rho(&self, z: f64) -> f64 {
        match *self {
            Prof::Sphere { zc, r } => {
                let d = (z - zc).abs();
                if r - d < 1e-9 * r {
                    0.0
                } else {
                    ((r - d) * (r + d)).sqrt()
                }
            }
            Prof::Line { a, m } => a + m * z,
        }
    }
}

/// The axial positions where two surfaces of revolution about one axis meet, each a circle of a
/// positive radius. Coincident surfaces, tangent surfaces and a meeting at an apex refuse.
fn meet_profiles(p: Prof, q: Prof) -> Result<Vec<f64>, ()> {
    match (p, q) {
        (Prof::Line { a: a1, m: m1 }, Prof::Line { a: a2, m: m2 }) => {
            if (m1 - m2).abs() < 1e-12 {
                if (a1 - a2).abs() < EPS {
                    bail!(); // the same surface
                }
                return Ok(Vec::new());
            }
            let z = (a2 - a1) / (m1 - m2);
            let rho = a1 + m1 * z;
            if rho < -EPS {
                return Ok(Vec::new()); // the two mirror nappes meet, not the faces
            }
            if rho < EPS {
                bail!(); // meet at an apex
            }
            Ok(vec![z])
        }
        (Prof::Sphere { zc: z1, r: r1 }, Prof::Sphere { zc: z2, r: r2 }) => {
            let dz = z2 - z1;
            if dz.abs() < EPS {
                if (r1 - r2).abs() < EPS {
                    bail!(); // the same sphere
                }
                return Ok(Vec::new());
            }
            let z = (r1 * r1 - r2 * r2 + z2 * z2 - z1 * z1) / (2.0 * dz);
            let rho2 = r1 * r1 - (z - z1) * (z - z1);
            if rho2.abs() < 1e-9 * r1.max(r2).powi(2) {
                bail!(); // tangent
            }
            if rho2 < 0.0 {
                return Ok(Vec::new());
            }
            Ok(vec![z])
        }
        (Prof::Sphere { zc, r }, Prof::Line { a, m }) | (Prof::Line { a, m }, Prof::Sphere { zc, r }) => {
            // r^2 - (z - zc)^2 = (a + m z)^2
            let qa = -(1.0 + m * m);
            let qb = 2.0 * zc - 2.0 * a * m;
            let qc = r * r - zc * zc - a * a;
            let disc = qb * qb - 4.0 * qa * qc;
            let tol = 1e-9 * (qb * qb + (4.0 * qa * qc).abs() + 1.0);
            if disc < -tol {
                return Ok(Vec::new());
            }
            if disc.abs() <= tol {
                bail!(); // tangent
            }
            let mut out = Vec::new();
            for s in [-1.0, 1.0] {
                let z = (-qb + s * disc.sqrt()) / (2.0 * qa);
                let rho = a + m * z;
                if rho < -EPS {
                    continue; // the mirror nappe of a cone
                }
                if rho < EPS {
                    bail!(); // an apex on the sphere
                }
                out.push(z);
            }
            Ok(out)
        }
    }
}

impl RFace {
    fn unplaced(surf: Surface) -> RFace {
        RFace { surf, fam: Fam { o: [0.0; 3], a: [0.0, 0.0, 1.0], e1: [1.0, 0.0, 0.0] }, sigma: 1.0, z0: 0.0, zlo: 0.0, zhi: 0.0 }
    }
    /// The surface's own axis (unit), and a point of it.
    fn own_axis(&self) -> (Vec3, Vec3) {
        match &self.surf {
            Surface::Sphere(s) => (normalize(s.axis), s.center),
            Surface::Cone(c) => (normalize(c.axis), c.base),
            _ => unreachable!(),
        }
    }
    fn e1(&self) -> Vec3 {
        match &self.surf {
            Surface::Sphere(s) => normalize(s.e1),
            Surface::Cone(c) => normalize(c.e1),
            _ => unreachable!(),
        }
    }
    /// +1 for a frame whose (e1, e2, axis) is right-handed (u runs counter-clockwise about the axis).
    fn hand(&self) -> f64 {
        let (e1, e2, ax) = match &self.surf {
            Surface::Sphere(s) => (s.e1, s.e2, s.axis),
            Surface::Cone(c) => (c.e1, c.e2, c.axis),
            _ => unreachable!(),
        };
        if dot(cross(e1, e2), ax) >= 0.0 {
            1.0
        } else {
            -1.0
        }
    }
    fn v_range(&self) -> [f64; 2] {
        match &self.surf {
            Surface::Sphere(s) => s.v_range,
            Surface::Cone(c) => c.v_range,
            _ => unreachable!(),
        }
    }
    fn z_of_v(&self, v: f64) -> f64 {
        match &self.surf {
            Surface::Sphere(s) => self.z0 + self.sigma * (-s.radius * v.cos()),
            Surface::Cone(c) => self.z0 + self.sigma * v * c.half_angle.cos(),
            _ => unreachable!(),
        }
    }
    fn v_of_z(&self, z: f64) -> f64 {
        match &self.surf {
            Surface::Sphere(s) => (-self.sigma * (z - self.z0) / s.radius).clamp(-1.0, 1.0).acos(),
            Surface::Cone(c) => self.sigma * (z - self.z0) / c.half_angle.cos(),
            _ => unreachable!(),
        }
    }
    fn prof(&self) -> Prof {
        match &self.surf {
            Surface::Sphere(s) => Prof::Sphere { zc: self.z0, r: s.radius },
            Surface::Cone(c) => {
                let m = -self.sigma * c.half_angle.tan();
                Prof::Line { a: c.base_radius - m * self.z0, m }
            }
            _ => unreachable!(),
        }
    }
    fn rho(&self, z: f64) -> f64 {
        self.prof().rho(z)
    }
    fn centre(&self, z: f64) -> Vec3 {
        add(self.fam.o, scale(self.fam.a, z))
    }
    /// The point of the circle at `z` at angle zero (the seam).
    fn seam_pt(&self, z: f64) -> Vec3 {
        add(self.centre(z), scale(self.fam.e1, self.rho(z)))
    }
    fn max_rho(&self) -> f64 {
        let mut m = self.rho(self.zlo).max(self.rho(self.zhi));
        if let Surface::Sphere(s) = &self.surf {
            if self.zlo <= self.z0 && self.z0 <= self.zhi {
                m = s.radius;
            }
        }
        m
    }
}

fn aabb_rev(f: &RFace) -> Box3 {
    let mut b = ([f64::MAX; 3], [f64::MIN; 3]);
    let pad = f.max_rho();
    for z in [f.zlo, f.zhi] {
        let p = f.centre(z);
        for k in 0..3 {
            b.0[k] = b.0[k].min(p[k] - pad);
            b.1[k] = b.1[k].max(p[k] + pad);
        }
    }
    b
}

/// Is `p` on the line `o + t a`?
fn on_line(p: Vec3, o: Vec3, a: Vec3) -> bool {
    len(cross(sub(p, o), a)) < 1e-6
}

/// Choose the axis of the pair, put every sphere and cone face in it, and compute each face's
/// place on it. `Ok(None)` when there is no sphere or cone face at all; `Err` when the faces do
/// not share one axis and one seam direction.
fn rev_family(pa: &mut [AFace], pb: &mut [AFace], hint: Option<(Vec3, Vec3)>) -> Result<Option<Fam>, ()> {
    let revs = |pa: &[AFace], pb: &[AFace]| -> Vec<RFace> {
        pa.iter().chain(pb.iter()).filter_map(|f| if let AFace::Rev(r) = f { Some(r.clone()) } else { None }).collect()
    };
    let all = revs(pa, pb);
    if all.is_empty() {
        return Ok(None);
    }
    // An anchor fixes the frame: a cone, or a sphere that is only a zone.
    let full_sphere = |r: &RFace| match &r.surf {
        Surface::Sphere(s) => s.v_range[0].abs() < 1e-9 && (s.v_range[1] - std::f64::consts::PI).abs() < 1e-9,
        _ => false,
    };
    let mut fam: Option<Fam> = None;
    for r in all.iter().filter(|r| !full_sphere(r)) {
        let (a, o) = r.own_axis();
        let cand = Fam { o, a, e1: r.e1() };
        match fam {
            None => fam = Some(cand),
            Some(f) => {
                if len(cross(f.a, a)) > 1e-9 || !on_line(o, f.o, f.a) || dot(f.e1, cand.e1) < 1.0 - 1e-9 {
                    bail!();
                }
            }
        }
    }
    let fam = match fam {
        Some(f) => f,
        None => {
            // Only whole spheres: any two centres are on one line, so that line is the axis; with a
            // single centre every line through it is, and `hint` (an axis another face of the pair
            // has) says which.
            let centres: Vec<Vec3> = all.iter().map(|r| r.own_axis().1).collect();
            let c0 = centres[0];
            if let Some((a, e1)) = hint {
                if !centres.iter().all(|c| on_line(*c, c0, a)) {
                    bail!();
                }
                return finish_family(pa, pb, Fam { o: c0, a, e1 }, &full_sphere);
            }
            let far = centres.iter().copied().find(|c| len(sub(*c, c0)) > EPS);
            let (a, e1) = match far {
                Some(c) => {
                    let a = normalize(sub(c, c0));
                    (a, crate::geom::frame(a).0)
                }
                None => {
                    let r0 = &all[0];
                    (r0.own_axis().0, r0.e1())
                }
            };
            if !centres.iter().all(|c| on_line(*c, c0, a)) {
                bail!();
            }
            Fam { o: c0, a, e1 }
        }
    };
    finish_family(pa, pb, fam, &full_sphere)
}

/// Put every sphere and cone face of the pair in `fam`: a whole sphere takes its frame, and each
/// face gets its place on the axis.
fn finish_family(pa: &mut [AFace], pb: &mut [AFace], fam: Fam, full_sphere: &dyn Fn(&RFace) -> bool) -> Result<Option<Fam>, ()> {
    let z_at = |p: Vec3| dot(sub(p, fam.o), fam.a);
    for f in pa.iter_mut().chain(pb.iter_mut()) {
        let AFace::Rev(r) = f else { continue };
        r.fam = fam;
        if full_sphere(r) {
            let Surface::Sphere(s) = &r.surf else { unreachable!() };
            if !on_line(s.center, fam.o, fam.a) {
                bail!();
            }
            let e2 = scale(cross(fam.a, fam.e1), r.hand());
            r.surf = Surface::Sphere(SphereSurf { center: s.center, radius: s.radius, axis: fam.a, e1: fam.e1, e2, u_range: [0.0, TAU], v_range: s.v_range, trim: None });
        }
        let (ax, o) = r.own_axis();
        r.sigma = dot(ax, fam.a).signum();
        r.z0 = z_at(o);
        let vr = r.v_range();
        let (za, zb) = (r.z_of_v(vr[0]), r.z_of_v(vr[1]));
        r.zlo = za.min(zb);
        r.zhi = za.max(zb);
        if r.zhi - r.zlo <= EPS {
            bail!();
        }
    }
    Ok(Some(fam))
}

/// A whole circle on a plane face that lies on the axis, in a plane square to it: start it at the
/// family's seam direction, unless a cylinder wall already fixed its start.
fn align_family_circles(out: &mut [AFace], fam: &Fam) -> Option<()> {
    for f in out.iter_mut() {
        if let AFace::Plane(p) = f {
            if dot(p.plane.n, fam.a).abs() < 1.0 - 1e-9 {
                continue;
            }
            for c in p.curves.iter_mut() {
                if let C3::Arc { center, radius, start, sweep, .. } = c {
                    if sweep.abs() < TAU - 1e-9 || !on_line(*center, fam.o, fam.a) {
                        continue;
                    }
                    *start = add(*center, scale(fam.e1, *radius));
                }
            }
            p.edges = p.curves.iter().map(|c| to_e2(c, &p.plane)).collect::<Option<_>>()?;
        }
    }
    Some(())
}

/// Is every point of `g`'s box farther than `r` from `c`? (A plane face that cannot touch a sphere.)
fn box_clear_of_ball(b: &Box3, c: Vec3, r: f64) -> bool {
    let mut d2 = 0.0;
    for k in 0..3 {
        let x = c[k].clamp(b.0[k], b.1[k]);
        d2 += (c[k] - x) * (c[k] - x);
    }
    d2.sqrt() > r + 1e-6
}

/// The circle where a plane square to the axis meets `g`, on `f`: `Ok(None)` when the plane misses
/// the band (or the face `f` does not hold the circle), `Ok(Some(circle))` when it cuts it. The
/// circle must lie wholly inside or wholly outside `f`: one that meets an edge of `f` (or lies on
/// one) refuses. A plane that is not square to the axis must be clear of the surface.
fn rev_circle_on_plane(f: &PFace, g: &RFace, plane_box: &Box3) -> Result<Option<E2>, ()> {
    let n = f.plane.n;
    let ax = dot(g.fam.a, n);
    if ax.abs() < 1.0 - 1e-9 {
        let clear = match &g.surf {
            Surface::Sphere(s) => box_clear_of_ball(plane_box, s.center, s.radius),
            _ => false,
        };
        if clear {
            return Ok(None);
        }
        bail!(); // a plane that is not square to the axis reaches the surface
    }
    let z = dot(sub(f.plane.origin, g.fam.o), n) / ax;
    if z < g.zlo - EPS || z > g.zhi + EPS {
        return Ok(None);
    }
    let rho = g.rho(z);
    let at_end = (z - g.zlo).abs() <= EPS || (z - g.zhi).abs() <= EPS;
    if rho <= EPS {
        // The plane touches the apex or the pole.
        bail!();
    }
    if at_end {
        return Ok(None); // a rim of the band: the face next to it holds that circle
    }
    let c3 = C3::Arc { center: g.centre(z), radius: rho, normal: g.fam.a, start: g.seam_pt(z), sweep: TAU };
    let circle = to_e2(&c3, &f.plane).ok_or(())?;
    let E2::Arc { c, r, .. } = circle else { bail!() };
    for e in &f.edges {
        if let E2::Arc { c: c2, r: r2, .. } = *e {
            if dist2(c, c2) < 1e-6 && (r - r2).abs() < 1e-6 {
                bail!(); // the circle lies on an edge of the face
            }
        }
        let (mut a, mut b) = (Vec::new(), Vec::new());
        meet(e, &circle, &mut a, &mut b);
        if !a.is_empty() || !b.is_empty() {
            bail!(); // the circle meets an edge of the face
        }
        // Closest approach without a crossing (a tangent circle) is as bad.
        if dist_to_e2(c, e) < r + 1e-6 && dist_to_e2(c, e) > r - 1e-6 {
            bail!();
        }
    }
    if !in_edges(f.plane.project(g.seam_pt(z)), &f.edges) {
        return Ok(None);
    }
    Ok(Some(circle))
}

/// A cylinder wall about the family axis, with its range of heights on that axis. `Err` when it is
/// not about the axis, or is partial, trimmed, or starts its circles elsewhere.
fn coaxial_cyl(c: &CFace, fam: &Fam) -> Result<(f64, f64, f64), ()> {
    let cy = &c.cyl;
    if len(cross(normalize(cy.axis), fam.a)) > 1e-9 || !on_line(cy.origin, fam.o, fam.a) || cy.arc.is_some() || cy.cross.is_some() || c.span < TAU - 1e-9 {
        bail!();
    }
    if dot(normalize(cy.e1), fam.e1) < 1.0 - 1e-9 {
        bail!();
    }
    let sg = dot(normalize(cy.axis), fam.a).signum();
    let z0 = dot(sub(cy.origin, fam.o), fam.a);
    let (za, zb) = (z0 + sg * cy.vmin, z0 + sg * cy.vmax);
    Ok((za.min(zb), za.max(zb), cy.radius))
}

/// The heights (family coordinates) strictly inside `f` where the other solid's faces cut it.
fn rev_grid(f: &RFace, other: &[AFace]) -> Result<Grid, ()> {
    let me = aabb_rev(f);
    let mut zs: Vec<f64> = Vec::new();
    for g in other {
        if !boxes_meet(&me, &aabb(g)) {
            continue;
        }
        match g {
            AFace::Plane(p) => {
                if let Some(E2::Arc { .. }) = rev_circle_on_plane(p, f, &aabb_plane(&p.curves))? {
                    let z = dot(sub(p.plane.origin, f.fam.o), p.plane.n) / dot(f.fam.a, p.plane.n);
                    zs.push(z);
                }
            }
            AFace::Cyl(c) => {
                let (clo, chi, r) = coaxial_cyl(c, &f.fam)?;
                for z in meet_profiles(f.prof(), Prof::Line { a: r, m: 0.0 })? {
                    if z > f.zlo + EPS && z < f.zhi - EPS && z >= clo - EPS && z <= chi + EPS {
                        zs.push(z);
                    }
                }
            }
            AFace::Rev(r) => {
                for z in meet_profiles(f.prof(), r.prof())? {
                    if z > f.zlo + EPS && z < f.zhi - EPS && z >= r.zlo - EPS && z <= r.zhi + EPS {
                        zs.push(z);
                    }
                }
            }
        }
    }
    zs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    zs.dedup_by(|a, b| (*a - *b).abs() < EPS);
    Ok(Grid { us: Vec::new(), vs: zs })
}

/// The heights where a cylinder wall of the other solid is cut by sphere or cone `r` (in the
/// cylinder's own v, strictly inside the wall).
fn cyl_rev_heights(c: &CFace, r: &RFace, vs: &mut Vec<f64>) -> Result<(), ()> {
    let (clo, chi, rad) = coaxial_cyl(c, &r.fam)?;
    let sg = dot(normalize(c.cyl.axis), r.fam.a).signum();
    let z0 = dot(sub(c.cyl.origin, r.fam.o), r.fam.a);
    for z in meet_profiles(r.prof(), Prof::Line { a: rad, m: 0.0 })? {
        if z > clo + EPS && z < chi - EPS && z >= r.zlo - EPS && z <= r.zhi + EPS {
            vs.push(sg * (z - z0));
        }
    }
    Ok(())
}

/// One band of a sphere or cone face, from height `za` to `zb` (family coordinates), as a finished
/// face with its own seam at angle zero.
fn rev_piece(f: &RFace, za: f64, zb: f64, vertex: VertexFn) -> TFace {
    let (va, vb) = (f.v_of_z(za), f.v_of_z(zb));
    let (v_lo, v_hi) = (va.min(vb), va.max(vb));
    let z_lo = f.z_of_v(v_lo);
    let z_hi = f.z_of_v(v_hi);
    let (ax, _) = f.own_axis();
    let e1 = f.e1();
    let hand = f.hand();
    let seam_pt = |v: f64| f.surf.param(0.0, v);
    let (p_lo, p_hi) = (seam_pt(v_lo), seam_pt(v_hi));
    let (s_lo, s_hi) = (vertex(p_lo), vertex(p_hi));
    let seam = match &f.surf {
        Surface::Sphere(s) => {
            let c = s.center;
            let x_axis = normalize(sub(p_lo, c));
            // The meridian runs from v_lo to v_hi counter-clockwise about e1 x axis.
            topo::edge(s_lo.clone(), s_hi.clone(), true, Curve::Arc { center: c, radius: s.radius, normal: normalize(cross(e1, ax)), x_axis, sweep: v_hi - v_lo })
        }
        _ => topo::edge(s_lo.clone(), s_hi.clone(), true, Curve::Segment { a: p_lo, b: p_hi }),
    };
    let pc = |u0: f64, v0: f64, u1: f64, v1: f64| Pcurve { start: [u0, v0], end: [u1, v1], mid: [0.5 * (u0 + u1), 0.5 * (v0 + v1)] };
    let ring = |z: f64, sv: &topo::VertexRef| topo::edge(sv.clone(), sv.clone(), true, Curve::Circle { center: f.centre(z), radius: f.rho(z), normal: ax });
    // A turn of u runs counter-clockwise about the axis for a right-handed frame, clockwise otherwise.
    let turn = hand > 0.0;
    let mut uses = vec![topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: pc(0.0, v_lo, 0.0, v_hi) }];
    let is_pole = |v: f64| match &f.surf {
        Surface::Sphere(_) => v < 1e-9 || v > std::f64::consts::PI - 1e-9,
        Surface::Cone(c) => c.base_radius - v * c.half_angle.sin() < 1e-9,
        _ => false,
    };
    if !is_pole(v_hi) {
        uses.push(topo::EdgeUse { edge: ring(z_hi, &s_hi), forward: turn, pcurve: pc(0.0, v_hi, TAU, v_hi) });
    }
    uses.push(topo::EdgeUse { edge: seam, forward: false, pcurve: pc(TAU, v_hi, TAU, v_lo) });
    if !is_pole(v_lo) {
        uses.push(topo::EdgeUse { edge: ring(z_lo, &s_lo), forward: !turn, pcurve: pc(TAU, v_lo, 0.0, v_lo) });
    }
    let surface = match &f.surf {
        Surface::Sphere(s) => Surface::Sphere(SphereSurf { v_range: [v_lo, v_hi], u_range: [0.0, TAU], ..s.clone() }),
        Surface::Cone(c) => Surface::Cone(Cone { v_range: [v_lo, v_hi], ..c.clone() }),
        _ => unreachable!(),
    };
    Rc::new(RefCell::new(Face { boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))], forward: true, surface, uv_domain: [[0.0, TAU], [v_lo, v_hi]] }))
}

/// Inside or outside the other solid, for a whole band: several heights and angles must agree.
fn rev_class(f: &RFace, za: f64, zb: f64, other_solid: &TSolid) -> Result<Class, ()> {
    let (va, vb) = (f.v_of_z(za), f.v_of_z(zb));
    let mut verdict: Option<bool> = None;
    for t in [0.5, 0.25, 0.75] {
        let v = va + (vb - va) * t;
        for k in 0..3 {
            let u = 0.9 + 2.1 * k as f64;
            let inside = ops::inside_solid(other_solid, f.surf.param(u, v));
            match verdict {
                None => verdict = Some(inside),
                Some(x) if x != inside => bail!(),
                _ => {}
            }
        }
    }
    Ok(if verdict == Some(true) { Class::Inside } else { Class::Outside })
}

// ---------------------------------------------------------------------------
// 2D predicates over edge bags.
// ---------------------------------------------------------------------------

/// x positions where the horizontal line at `y` crosses `e`, under the
/// half-open rule (an endpoint counts as above when its y is > `y`), so a
/// chain of edges meeting at vertices counts every crossing once.
fn crossings_x(e: &E2, y: f64, out: &mut Vec<f64>) {
    match *e {
        E2::Seg(a, b) => {
            if (a[1] > y) != (b[1] > y) {
                out.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
            }
        }
        E2::Arc { c, r, a0, sw } => {
            // Split into y-monotone pieces at the top and bottom of the circle.
            let mut cuts = vec![a0];
            for base in [std::f64::consts::FRAC_PI_2, 3.0 * std::f64::consts::FRAC_PI_2] {
                let th = pos_ang(base - a0) + a0;
                if th > a0 + 1e-12 && th < a0 + sw - 1e-12 {
                    cuts.push(th);
                }
            }
            cuts.push(a0 + sw);
            cuts.sort_by(|x, z| x.partial_cmp(z).unwrap());
            for w in cuts.windows(2) {
                let (p, q) = (ang_pt(c, r, w[0]), ang_pt(c, r, w[1]));
                if (p[1] > y) != (q[1] > y) {
                    let dy = y - c[1];
                    if dy.abs() <= r {
                        let sign = if (0.5 * (w[0] + w[1])).cos() >= 0.0 { 1.0 } else { -1.0 };
                        out.push(c[0] + sign * (r * r - dy * dy).max(0.0).sqrt());
                    }
                }
            }
        }
    }
}

/// Even-odd containment against a bag of edges (outer boundary and holes).
fn in_edges(p: P2, edges: &[E2]) -> bool {
    let mut xs = Vec::new();
    for e in edges {
        crossings_x(e, p[1], &mut xs);
    }
    xs.iter().filter(|&&x| x > p[0]).count() % 2 == 1
}

fn dist_to_e2(p: P2, e: &E2) -> f64 {
    match *e {
        E2::Seg(a, b) => {
            let d = sub2(b, a);
            let l2 = dot2(d, d);
            let t = if l2 < 1e-30 { 0.0 } else { (dot2(sub2(p, a), d) / l2).clamp(0.0, 1.0) };
            dist2(p, [a[0] + d[0] * t, a[1] + d[1] * t])
        }
        E2::Arc { c, r, a0, sw } => {
            let rel = pos_ang((p[1] - c[1]).atan2(p[0] - c[0]) - a0);
            if rel <= sw {
                (dist2(p, c) - r).abs()
            } else {
                dist2(p, ang_pt(c, r, a0)).min(dist2(p, ang_pt(c, r, a0 + sw)))
            }
        }
    }
}

fn on_edges(p: P2, edges: &[E2]) -> bool {
    edges.iter().any(|e| dist_to_e2(p, e) < 10.0 * EPS)
}

fn area2(poly: &[P2]) -> f64 {
    let n = poly.len();
    (0..n).map(|i| cross2(poly[i], poly[(i + 1) % n])).sum::<f64>() * 0.5
}

fn in_poly(p: P2, poly: &[P2]) -> bool {
    let n = poly.len();
    let mut inside = false;
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        if (a[1] > p[1]) != (b[1] > p[1]) && a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]) > p[0] {
            inside = !inside;
        }
    }
    inside
}

// ---------------------------------------------------------------------------
// Where two 2D edges meet (parameters on each, in [0, 1]).
// ---------------------------------------------------------------------------

fn meet(e1: &E2, e2: &E2, o1: &mut Vec<f64>, o2: &mut Vec<f64>) {
    match (*e1, *e2) {
        (E2::Seg(a1, b1), E2::Seg(a2, b2)) => {
            let (d1, d2) = (sub2(b1, a1), sub2(b2, a2));
            let (l1, l2) = (dist2(a1, b1), dist2(a2, b2));
            let den = cross2(d1, d2);
            let w = sub2(a2, a1);
            if den.abs() > 1e-12 * l1 * l2 {
                let t = cross2(w, d2) / den;
                let s = cross2(w, d1) / den;
                let (t_tol, s_tol) = (EPS / l1, EPS / l2);
                if t >= -t_tol && t <= 1.0 + t_tol && s >= -s_tol && s <= 1.0 + s_tol {
                    o1.push(t.clamp(0.0, 1.0));
                    o2.push(s.clamp(0.0, 1.0));
                }
            } else if cross2(w, d1).abs() / l1 < EPS {
                let along = |a: P2, d: P2, l: f64, q: P2| dot2(sub2(q, a), d) / (l * l);
                for q in [a2, b2] {
                    let t = along(a1, d1, l1, q);
                    if t > 0.0 && t < 1.0 {
                        o1.push(t);
                    }
                }
                for q in [a1, b1] {
                    let s = along(a2, d2, l2, q);
                    if s > 0.0 && s < 1.0 {
                        o2.push(s);
                    }
                }
            }
        }
        (E2::Seg(a, b), E2::Arc { c, r, a0, sw }) => seg_arc(a, b, c, r, a0, sw, o1, o2),
        (E2::Arc { c, r, a0, sw }, E2::Seg(a, b)) => seg_arc(a, b, c, r, a0, sw, o2, o1),
        (E2::Arc { c: c1, r: r1, a0: s1, sw: w1 }, E2::Arc { c: c2, r: r2, a0: s2, sw: w2 }) => {
            let d = dist2(c1, c2);
            if d < EPS && (r1 - r2).abs() < EPS {
                // The same circle: each arc's ends split the other.
                for th in [s2, s2 + w2] {
                    if let Some(t) = arc_param(s1, w1, r1, th) {
                        if t > 0.0 && t < 1.0 {
                            o1.push(t);
                        }
                    }
                }
                for th in [s1, s1 + w1] {
                    if let Some(t) = arc_param(s2, w2, r2, th) {
                        if t > 0.0 && t < 1.0 {
                            o2.push(t);
                        }
                    }
                }
            } else if d > EPS && d <= r1 + r2 + EPS && d >= (r1 - r2).abs() - EPS {
                let phi = (c2[1] - c1[1]).atan2(c2[0] - c1[0]);
                let ca = ((r1 * r1 + d * d - r2 * r2) / (2.0 * r1 * d)).clamp(-1.0, 1.0);
                let al = ca.acos();
                let ths = if al < 1e-9 { vec![phi] } else { vec![phi + al, phi - al] };
                for th1 in ths {
                    let p = ang_pt(c1, r1, th1);
                    let th2 = (p[1] - c2[1]).atan2(p[0] - c2[0]);
                    if let (Some(t1), Some(t2)) = (arc_param(s1, w1, r1, th1), arc_param(s2, w2, r2, th2)) {
                        o1.push(t1);
                        o2.push(t2);
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn seg_arc(a: P2, b: P2, c: P2, r: f64, a0: f64, sw: f64, os: &mut Vec<f64>, oa: &mut Vec<f64>) {
    let d = sub2(b, a);
    let l = dist2(a, b);
    if l < 1e-12 {
        return;
    }
    let u = [d[0] / l, d[1] / l];
    let f = sub2(a, c);
    let proj = -dot2(f, u);
    let perp = cross2(u, f).abs();
    if perp > r + EPS {
        return;
    }
    let half = if (r - perp).abs() <= EPS { 0.0 } else { (r * r - perp * perp).max(0.0).sqrt() };
    let ts = if half == 0.0 { vec![proj] } else { vec![proj - half, proj + half] };
    for s in ts {
        if s < -EPS || s > l + EPS {
            continue;
        }
        let p = [a[0] + u[0] * s, a[1] + u[1] * s];
        let th = (p[1] - c[1]).atan2(p[0] - c[0]);
        if let Some(t) = arc_param(a0, sw, r, th) {
            os.push((s / l).clamp(0.0, 1.0));
            oa.push(t);
        }
    }
}

/// Whether `q` (on the plane of `f`) lies inside the face, with straight edges AND circular
/// arcs taken exactly. `None` when the face has an edge this module does not read.
/// `ops::plane_face_contains` used to sample every arc with 16 chords, which misjudges a
/// point within about 0.03 mm of a circular edge of a hole 6 mm across.
pub(crate) fn face_contains_exact(g: &Plane, f: &Face<crate::build::Curve3, crate::build::Surface3>, q: Vec3) -> Option<bool> {
    let mut edges: Vec<E2> = Vec::new();
    for w in &f.boundary {
        for u in &w.borrow().edges {
            let e = u.edge.borrow();
            let c3 = match &e.curve {
                Curve::Segment { a, b } => C3::Seg(*a, *b),
                Curve::Circle { center, radius, normal } => C3::Arc { center: *center, radius: *radius, normal: *normal, start: e.a.borrow().point, sweep: TAU },
                Curve::Arc { center, radius, normal, x_axis, sweep } => {
                    C3::Arc { center: *center, radius: *radius, normal: *normal, start: add(*center, scale(normalize(*x_axis), *radius)), sweep: *sweep }
                }
                _ => return None,
            };
            edges.push(to_e2(&c3, g)?);
        }
    }
    if edges.is_empty() {
        return None;
    }
    Some(in_edges(g.project(q), &edges))
}

/// A solid with a vertex lying in the middle of another face's straight edge (a
/// T-junction). Its faces share no edge there, so a mesh welded by position has an open seam,
/// although the B-rep's own edge-use count can still read two.
pub(crate) fn has_t_junction(solid: &TSolid) -> bool {
    let faces = solid.faces();
    let mut verts: Vec<Vec3> = Vec::new();
    let mut segs: Vec<(Vec3, Vec3)> = Vec::new();
    for f in &faces {
        let fb = f.borrow();
        // Curved faces count too: a vertex of a hole's rim lying in the middle of a straight
        // edge of the next face is the same open seam (G4).
        for w in &fb.boundary {
            for u in &w.borrow().edges {
                let e = u.edge.borrow();
                match e.curve {
                    Curve::Segment { a, b } => {
                        verts.push(a);
                        verts.push(b);
                        segs.push((a, b));
                    }
                    _ => {
                        verts.push(e.a.borrow().point);
                        verts.push(e.b.borrow().point);
                    }
                }
            }
        }
    }
    for &(a, b) in &segs {
        let d = sub(b, a);
        let l2 = dot(d, d);
        if l2 < 1e-18 {
            continue;
        }
        for &p in &verts {
            let t = dot(sub(p, a), d) / l2;
            if t > 1e-9 && t < 1.0 - 1e-9 && len(sub(p, add(a, scale(d, t)))) < 1e-7 {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Cutting a plane face: the arrangement of its outline and the cut curves.
// ---------------------------------------------------------------------------

type Chain = Vec<(E2, bool)>;

struct Region {
    outer: Chain,
    holes: Vec<Chain>,
}

struct GEdge {
    u: usize,
    v: usize,
    e: E2,
}

fn find(c: &mut HashMap<usize, usize>, x: usize) -> usize {
    let p = c[&x];
    if p == x {
        return x;
    }
    let r = find(c, p);
    c.insert(x, r);
    r
}

/// Node the face outline and the cuts into a planar graph and trace the
/// sub-regions of the face. `Err` when the graph is not what a closed solid
/// can produce.
fn split_face(f: &PFace, cuts: &[E2], nodes_at: &[P2]) -> Result<Vec<Region>, ()> {
    let mut es: Vec<E2> = f.edges.clone();
    for c in cuts {
        if c.length() > EPS {
            es.push(*c);
        }
    }
    let mut splits: Vec<Vec<f64>> = es.iter().map(|_| vec![0.0, 1.0]).collect();
    for i in 0..es.len() {
        for j in (i + 1)..es.len() {
            let (mut a, mut b) = (Vec::new(), Vec::new());
            meet(&es[i], &es[j], &mut a, &mut b);
            splits[i].extend(a);
            splits[j].extend(b);
        }
    }
    // Extra break points (the cylinder grid), wherever they lie on an edge.
    for p in nodes_at {
        for (i, e) in es.iter().enumerate() {
            if dist_to_e2(*p, e) >= EPS {
                continue;
            }
            let t = match *e {
                E2::Seg(a, b) => {
                    let d = sub2(b, a);
                    dot2(sub2(*p, a), d) / dot2(d, d)
                }
                E2::Arc { c, r, a0, sw } => match arc_param(a0, sw, r, (p[1] - c[1]).atan2(p[0] - c[0])) {
                    Some(t) => t,
                    None => continue,
                },
            };
            splits[i].push(t.clamp(0.0, 1.0));
        }
    }
    let mut nodes: Vec<P2> = Vec::new();
    let mut node = |p: P2| -> usize {
        if let Some(i) = nodes.iter().position(|q| dist2(*q, p) < EPS) {
            return i;
        }
        nodes.push(p);
        nodes.len() - 1
    };
    let mut gedges: Vec<GEdge> = Vec::new();
    for (i, e) in es.iter().enumerate() {
        let mut ts = splits[i].clone();
        ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
        let l = e.length();
        let mut prev = ts[0];
        let last = ts.len() - 1;
        for (k, &t) in ts.iter().enumerate().skip(1) {
            // A whole circle with no other split keeps its single span.
            let whole_circle = e.is_full() && k == last && prev <= 0.0;
            if (t - prev) * l < EPS && !whole_circle {
                continue;
            }
            let piece = match *e {
                E2::Seg(..) => E2::Seg(e.at(prev), e.at(t)),
                E2::Arc { c, r, a0, sw } => E2::Arc { c, r, a0: a0 + sw * prev, sw: sw * (t - prev) },
            };
            let (u, v) = (node(piece.at(0.0)), node(piece.at(1.0)));
            let same = |g: &GEdge| ((g.u == u && g.v == v) || (g.u == v && g.v == u)) && dist2(g.e.at(0.5), piece.at(0.5)) < 10.0 * EPS;
            if !gedges.iter().any(same) && !(u == v && !matches!(piece, E2::Arc { .. })) {
                gedges.push(GEdge { u, v, e: piece });
            }
            prev = t;
        }
    }
    // Keep graph edges on or inside the face; drop what lies outside it.
    gedges.retain(|g| {
        let m = g.e.at(0.5);
        on_edges(m, &f.edges) || in_edges(m, &f.edges)
    });
    // Prune dangling edges (degree one) until none are left.
    loop {
        let mut deg: HashMap<usize, usize> = HashMap::new();
        for g in &gedges {
            *deg.entry(g.u).or_insert(0) += 1;
            *deg.entry(g.v).or_insert(0) += 1;
        }
        let before = gedges.len();
        gedges.retain(|g| deg[&g.u] > 1 && deg[&g.v] > 1);
        if gedges.len() == before {
            break;
        }
    }
    if gedges.is_empty() {
        bail!();
    }
    // Half-edge h = 2 * edge + dir; dir 1 runs the edge backwards.
    let origin = |h: usize| if h & 1 == 0 { gedges[h >> 1].u } else { gedges[h >> 1].v };
    let dest = |h: usize| if h & 1 == 0 { gedges[h >> 1].v } else { gedges[h >> 1].u };
    let out_dir = |h: usize| -> (f64, f64) {
        let g = &gedges[h >> 1];
        if h & 1 == 0 {
            let (t, k) = g.e.tangent(0.0);
            (pos_ang(t[1].atan2(t[0])), k)
        } else {
            let (t, k) = g.e.tangent(1.0);
            (pos_ang((-t[1]).atan2(-t[0])), -k)
        }
    };
    let mut ring: HashMap<usize, Vec<usize>> = HashMap::new();
    for h in 0..gedges.len() * 2 {
        ring.entry(origin(h)).or_default().push(h);
    }
    for hs in ring.values_mut() {
        hs.sort_by(|&x, &y| {
            let ((ax, kx), (ay, ky)) = (out_dir(x), out_dir(y));
            if (ax - ay).abs() < 1e-9 {
                kx.partial_cmp(&ky).unwrap()
            } else {
                ax.partial_cmp(&ay).unwrap()
            }
        });
    }
    // Connected components.
    let mut comp: HashMap<usize, usize> = ring.keys().map(|&k| (k, k)).collect();
    for g in &gedges {
        let (ru, rv) = (find(&mut comp, g.u), find(&mut comp, g.v));
        if ru != rv {
            comp.insert(ru, rv);
        }
    }
    let mut seen: HashSet<usize> = HashSet::new();
    let mut pos: Vec<(Vec<usize>, f64, usize, Vec<P2>)> = Vec::new();
    let mut neg: Vec<(Vec<usize>, usize, Vec<P2>)> = Vec::new();
    for sh in 0..gedges.len() * 2 {
        if seen.contains(&sh) {
            continue;
        }
        let mut cyc = Vec::new();
        let mut h = sh;
        loop {
            seen.insert(h);
            cyc.push(h);
            let r = &ring[&dest(h)];
            let idx = r.iter().position(|&x| x == (h ^ 1)).ok_or(())?;
            h = r[(idx + r.len() - 1) % r.len()];
            if h == sh {
                break;
            }
            if cyc.len() > 4 * gedges.len() + 8 {
                bail!();
            }
        }
        let poly: Vec<P2> = cyc.iter().flat_map(|&h| gedges[h >> 1].e.sample(h & 1 == 1)).collect();
        let a = area2(&poly);
        let c = find(&mut comp, origin(sh));
        if a > 1e-12 {
            pos.push((cyc, a, c, poly));
        } else if a < -1e-12 {
            neg.push((cyc, c, poly));
        }
    }
    // A component's outer boundary is a hole of the smallest bounded cycle of
    // ANOTHER component that contains it.
    let mut holes_of: Vec<Vec<usize>> = vec![Vec::new(); pos.len()];
    for (ni, (_, c, poly)) in neg.iter().enumerate() {
        let probe = poly[0];
        let mut best: Option<usize> = None;
        for (pi, (_, pa, comp_p, ppoly)) in pos.iter().enumerate() {
            if comp_p == c {
                continue;
            }
            if in_poly(probe, ppoly) && best.map_or(true, |b| *pa < pos[b].1) {
                best = Some(pi);
            }
        }
        if let Some(b) = best {
            holes_of[b].push(ni);
        }
    }
    let chain_of = |cyc: &[usize]| -> Chain { cyc.iter().map(|&h| (gedges[h >> 1].e, h & 1 == 1)).collect() };
    Ok(pos
        .iter()
        .enumerate()
        .map(|(pi, (cyc, ..))| Region { outer: chain_of(cyc), holes: holes_of[pi].iter().map(|&ni| chain_of(&neg[ni].0)).collect() })
        .collect())
}

/// An interior point of a region (outer boundary minus holes), by scanline.
fn interior_point(r: &Region) -> Option<P2> {
    let all: Vec<E2> = r.outer.iter().chain(r.holes.iter().flatten()).map(|(e, _)| *e).collect();
    let mut ys: Vec<f64> = Vec::new();
    for e in &all {
        ys.push(e.at(0.0)[1]);
        ys.push(e.at(1.0)[1]);
        if let E2::Arc { c, r, a0, sw } = *e {
            for base in [std::f64::consts::FRAC_PI_2, 3.0 * std::f64::consts::FRAC_PI_2] {
                let th = pos_ang(base - a0) + a0;
                if th < a0 + sw {
                    ys.push(c[1] + r * th.sin());
                }
            }
        }
    }
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let mut gaps: Vec<(f64, f64)> = ys.windows(2).map(|w| (w[1] - w[0], 0.5 * (w[0] + w[1]))).collect();
    gaps.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    for (gap, y) in gaps {
        if gap < 1e-6 {
            break;
        }
        let mut xs = Vec::new();
        for e in &all {
            crossings_x(e, y, &mut xs);
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut best: Option<(f64, f64)> = None;
        for pair in xs.chunks(2) {
            if pair.len() == 2 && best.map_or(true, |b| pair[1] - pair[0] > b.0) {
                best = Some((pair[1] - pair[0], 0.5 * (pair[0] + pair[1])));
            }
        }
        if let Some((w, x)) = best {
            if w > 1e-6 {
                return Some([x, y]);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Cuts one face of the other operand leaves on a given face.
// ---------------------------------------------------------------------------

/// Where the line `p0 + t dir` (in `g`'s plane) lies inside face `g`:
/// intervals of `t`. A vertex within EPS of the line counts as on its positive
/// side, so crossings pair up evenly. `Err` on a parity failure.
fn line_intervals(g: &PFace, p0: Vec3, dir: Vec3) -> Result<Vec<(f64, f64)>, ()> {
    let o = g.plane.project(p0);
    let d = [dot(dir, g.plane.u), dot(dir, g.plane.v)];
    let side = |p: P2| cross2(d, sub2(p, o));
    let param = |p: P2| dot2(d, sub2(p, o));
    let plus = |p: P2| side(p) >= -EPS;
    let mut hits: Vec<f64> = Vec::new();
    for e in &g.edges {
        match *e {
            E2::Seg(a, b) => {
                if plus(a) != plus(b) {
                    let (sa, sb) = (side(a), side(b));
                    let t = sa / (sa - sb);
                    hits.push(param([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
                }
            }
            E2::Arc { c, r, a0, sw } => {
                // side(theta) = side(c) + r sin(theta - psi)
                let psi = d[1].atan2(d[0]);
                let k = -side(c) / r;
                let mut bps: Vec<f64> = vec![0.0];
                if k.abs() <= 1.0 {
                    let phi = k.clamp(-1.0, 1.0).asin();
                    let mut roots: Vec<f64> = [psi + phi, psi + std::f64::consts::PI - phi]
                        .iter()
                        .map(|&th| pos_ang(th - a0))
                        .filter(|&rel| rel > 1e-9 && rel < sw - 1e-9)
                        .collect();
                    roots.sort_by(|x, y| x.partial_cmp(y).unwrap());
                    roots.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
                    bps.extend(roots);
                }
                bps.push(sw);
                let at = |rel: f64| ang_pt(c, r, a0 + rel);
                let mut vals = vec![plus(at(0.0))];
                for w in bps.windows(2) {
                    vals.push(plus(at(0.5 * (w[0] + w[1]))));
                }
                vals.push(plus(at(sw)));
                for j in 0..vals.len() - 1 {
                    if vals[j] != vals[j + 1] {
                        hits.push(param(at(bps[j.min(bps.len() - 1)])));
                    }
                }
            }
        }
    }
    if hits.len() % 2 != 0 {
        bail!();
    }
    hits.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Ok(hits.chunks(2).filter(|p| p[1] - p[0] > EPS).map(|p| (p[0], p[1])).collect())
}

/// A plane parallel to a cylinder wall's axis and tangent to it touches the wall along one straight line.
/// `k` is the signed distance from the axis to the plane along the plane's OUTWARD normal, so k > 0 means the
/// cylinder lies on the material side of the plane's solid. Only a solid cylinder's outward wall is handled, and
/// only the contacts whose result is a manifold by construction (the tangent line is an ordinary edge or nothing):
///   * k > 0, the cylinder inside the plane's solid (a box face flush with a cylinder in a cut, join or keep): fine
///     for every operation EXCEPT cutting the cylinder out of the plane's solid, which would leave a tunnel that
///     touches the surface along a line;
///   * k < 0, the two solids touching from outside along a line: fine for a cut or a keep (nothing happens there),
///     but a join would be one solid holding a line contact, which a 2-manifold cannot represent.
/// Anything else (a bore wall) refuses, as before. `wall_is_a`: the cylinder belongs to the first operand.
fn tangent_allowed(wall: &Cylinder, k: f64, wall_is_a: bool) -> bool {
    if cyl_hand(wall) < 0.0 {
        return false;
    }
    match (k > 0.0, CUR_OP.with(|c| c.get())) {
        (false, 0) => false,
        (true, 1) => wall_is_a,
        _ => true,
    }
}

fn coplanar(f: &PFace, g: &PFace) -> bool {
    len(cross(f.plane.n, g.plane.n)) < 1e-9 && f.plane.distance(g.plane.origin).abs() < EPS
}

fn cuts_on_plane(f: &PFace, other: &[AFace], plane_is_a: bool) -> Result<Vec<E2>, ()> {
    let me = aabb_plane(&f.curves);
    let mut out = Vec::new();
    for g in other {
        if !boxes_meet(&me, &aabb(g)) {
            continue;
        }
        match g {
            AFace::Plane(g) => {
                if len(cross(f.plane.n, g.plane.n)) < 1e-9 {
                    if coplanar(f, g) {
                        for c in &g.curves {
                            out.push(to_e2(c, &f.plane).ok_or(())?);
                        }
                    }
                    continue;
                }
                let w = cross(f.plane.n, g.plane.n);
                let (df, dg) = (dot(f.plane.n, f.plane.origin), dot(g.plane.n, g.plane.origin));
                let w2 = dot(w, w);
                let p0 = scale(add(scale(cross(g.plane.n, w), df), scale(cross(w, f.plane.n), dg)), 1.0 / w2);
                let dir = normalize(w);
                for (t0, t1) in line_intervals(g, p0, dir)? {
                    out.push(E2::Seg(f.plane.project(add(p0, scale(dir, t0))), f.plane.project(add(p0, scale(dir, t1)))));
                }
            }
            AFace::Cyl(g) => out.extend(cyl_on_plane(f, g, &me, plane_is_a)?),
            AFace::Rev(g) => out.extend(rev_circle_on_plane(f, g, &me)?),
        }
    }
    Ok(out)
}

/// The curves where cylinder wall `g` meets the plane of `f`: two lines when
/// the plane is parallel to the axis, a circle when it is square to it.
fn cyl_on_plane(f: &PFace, g: &CFace, plane_box: &Box3, plane_is_a: bool) -> Result<Vec<E2>, ()> {
    let c = &g.cyl;
    let n = f.plane.n;
    let ax = dot(c.axis, n);
    let mut out = Vec::new();
    if ax.abs() < 1e-9 {
        let k = dot(sub(f.plane.origin, c.origin), n);
        let (a, b) = (dot(c.e1, n), dot(c.e2, n));
        let rr = c.radius * (a * a + b * b).sqrt();
        if k.abs() > rr + EPS {
            return Ok(out);
        }
        let tangent = k.abs() > rr - EPS;
        if tangent && !tangent_allowed(c, k, !plane_is_a) {
            bail!();
        }
        let (phi, del) = (b.atan2(a), if tangent { if k > 0.0 { 0.0 } else { std::f64::consts::PI } } else { (k / rr).acos() });
        for (i, th) in [phi + del, phi - del].into_iter().enumerate() {
            let rel = pos_ang(th - g.u0);
            if tangent && i == 1 {
                continue; // one line of contact, not two
            }
            if rel <= g.span + EPS / c.radius {
                out.push(E2::Seg(f.plane.project(cyl_pt(c, th, c.vmin)), f.plane.project(cyl_pt(c, th, c.vmax))));
            }
        }
    } else if ax.abs() > 1.0 - 1e-9 {
        let v0 = dot(sub(f.plane.origin, c.origin), n) / ax;
        if v0 > c.vmin + EPS && v0 < c.vmax - EPS {
            let arc = C3::Arc {
                center: add(c.origin, scale(c.axis, v0)),
                radius: c.radius,
                normal: c.axis,
                start: cyl_pt(c, g.u0, v0),
                sweep: cyl_hand(c) * g.span,
            };
            out.push(to_e2(&arc, &f.plane).ok_or(())?);
        }
    } else if boxes_meet(plane_box, &aabb_cyl(c)) {
        // An oblique plane meets the wall in an ellipse: not modelled.
        bail!();
    }
    Ok(out)
}

/// The grid lines along which other faces cut a cylinder wall: angles (`us`,
/// absolute, with the seam included whenever there is any cut) and heights
/// (`vs`, strictly inside the wall). Every cut curve is a piece of one of these
/// lines, so the wall splits into (angle x height) rectangles, none of which a
/// cut crosses: each is classified whole. A cut that covers only part of the
/// wall simply ends on a line of the other family.
struct Grid {
    us: Vec<f64>,
    vs: Vec<f64>,
}

fn wall_grid(f: &CFace, other: &[AFace], skip: &dyn Fn(usize) -> bool, wall_is_a: bool) -> Result<Grid, ()> {
    let c = &f.cyl;
    let me = aabb_cyl(c);
    let tol = EPS / c.radius;
    let (mut us, mut vs) = (Vec::new(), Vec::new());
    for (gi, g) in other.iter().enumerate() {
        if skip(gi) {
            continue; // the crossing cylinder is handled as a pair
        }
        if !boxes_meet(&me, &aabb(g)) {
            continue;
        }
        let g = match g {
            AFace::Plane(p) => p,
            AFace::Cyl(gc) => {
                parallel_wall_lines(f, gc, &mut us, &mut vs)?;
                continue;
            }
            AFace::Rev(r) => {
                cyl_rev_heights(f, r, &mut vs)?;
                continue;
            }
        };
        let n = g.plane.n;
        let ax = dot(c.axis, n);
        if ax.abs() < 1e-9 {
            let k = dot(sub(g.plane.origin, c.origin), n);
            let (a, b) = (dot(c.e1, n), dot(c.e2, n));
            let rr = c.radius * (a * a + b * b).sqrt();
            if k.abs() > rr + EPS {
                continue;
            }
            let tangent = k.abs() > rr - EPS;
            if tangent && !tangent_allowed(c, k, wall_is_a) {
                bail!();
            }
            let (phi, del) = (b.atan2(a), if tangent { if k > 0.0 { 0.0 } else { std::f64::consts::PI } } else { (k / rr).acos() });
            for th in [phi + del, phi - del] {
                let rel = pos_ang(th - f.u0);
                if rel > f.span + tol || (f.span < TAU - 1e-9 && (rel < tol || rel > f.span - tol)) {
                    continue;
                }
                // Where the other solid's face holds this line: any overlap with
                // the wall's height makes it a grid line, and each end that stops
                // inside the wall is a height line too.
                let mut touched = false;
                for (t0, t1) in line_intervals(g, cyl_pt(c, th, 0.0), c.axis)? {
                    let (lo, hi) = (t0.max(c.vmin), t1.min(c.vmax));
                    if hi - lo <= EPS {
                        continue;
                    }
                    touched = true;
                    if lo > c.vmin + EPS {
                        vs.push(lo);
                    }
                    if hi < c.vmax - EPS {
                        vs.push(hi);
                    }
                }
                if touched {
                    us.push(rel + f.u0);
                }
            }
        } else if ax.abs() > 1.0 - 1e-9 {
            let v0 = dot(sub(g.plane.origin, c.origin), n) / ax;
            if v0 <= c.vmin + EPS || v0 >= c.vmax - EPS {
                continue;
            }
            // The circle at v0 over this wall's angles, broken wherever an edge
            // of the other face crosses it; any piece inside the face is a cut.
            let centre = add(c.origin, scale(c.axis, v0));
            let circle = E2::Arc { c: g.plane.project(centre), r: c.radius, a0: 0.0, sw: TAU };
            let mut rels = vec![0.0, f.span];
            for e in &g.edges {
                let (mut a, mut b) = (Vec::new(), Vec::new());
                meet(e, &circle, &mut a, &mut b);
                for t in b {
                    let d = sub(g.plane.point(circle.at(t)), centre);
                    let rel = pos_ang(dot(d, c.e2).atan2(dot(d, c.e1)) - f.u0);
                    if rel > tol && rel < f.span - tol {
                        rels.push(rel);
                    }
                }
            }
            rels.sort_by(|x, y| x.partial_cmp(y).unwrap());
            let inside = rels.windows(2).any(|w| w[1] - w[0] > tol && in_edges(g.plane.project(cyl_pt(c, f.u0 + 0.5 * (w[0] + w[1]), v0)), &g.edges));
            if inside {
                vs.push(v0);
                us.extend(rels.iter().filter(|&&r| r > tol && r < f.span - tol).map(|&r| r + f.u0));
            }
        } else if boxes_meet(&me, &aabb_plane(&g.curves)) {
            bail!();
        }
    }
    us.sort_by(|a, b| a.partial_cmp(b).unwrap());
    us.dedup_by(|a, b| (*a - *b).abs() < tol);
    vs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    vs.dedup_by(|a, b| (*a - *b).abs() < EPS);
    // A circle on a plane face always has a node at the wall's seam, so a cut
    // whole-turn wall splits there as well: no cell crosses it.
    if f.span >= TAU - 1e-9 && !us.is_empty() && !us.iter().any(|&x| (x - f.u0).abs() < tol) {
        us.insert(0, f.u0);
    }
    Ok(Grid { us, vs })
}

/// Where a second cylinder wall with a PARALLEL axis meets wall `f`: two straight
/// lines along the axis, over the heights where the two walls overlap. They
/// become grid lines of `f` (an angle each, and a height wherever the overlap
/// stops short of the wall). Tangent walls, equal coaxial walls and axes that are
/// not parallel refuse.
fn parallel_wall_lines(f: &CFace, g: &CFace, us: &mut Vec<f64>, vs: &mut Vec<f64>) -> Result<(), ()> {
    let c = &f.cyl;
    let gc = &g.cyl;
    let a = normalize(c.axis);
    if len(cross(a, normalize(gc.axis))) > 1e-9 {
        bail!(); // slanted or crossing axes: not modelled here
    }
    let delta = sub(gc.origin, c.origin);
    let perp = sub(delta, scale(a, dot(delta, a)));
    let d = len(perp);
    let (big, small) = (c.radius, gc.radius);
    if d < EPS {
        if (big - small).abs() < EPS {
            // The same surface (a peg in its own hole, or two equal bores): the cells that lie on both are
            // classed OnSame or OnOpposite by `coincident_wall`. Whole-turn walls only, so no angular line
            // is needed: the overlap is a band of heights.
            if f.span < TAU - 1e-9 || g.span < TAU - 1e-9 {
                bail!();
            }
            let ga = dot(gc.axis, a);
            let g0 = dot(delta, a) + ga * gc.vmin;
            let g1 = dot(delta, a) + ga * gc.vmax;
            let (lo, hi) = ((c.vmin).max(g0.min(g1)), (c.vmax).min(g0.max(g1)));
            if hi - lo > EPS {
                if lo > c.vmin + EPS {
                    vs.push(lo);
                }
                if hi < c.vmax - EPS {
                    vs.push(hi);
                }
            }
            return Ok(());
        }
        return Ok(()); // coaxial and different: they never meet
    }
    if d > big + small + EPS || d < (big - small).abs() - EPS {
        return Ok(()); // apart, or one inside the other
    }
    if (d - (big + small)).abs() <= EPS || (d - (big - small).abs()).abs() <= EPS {
        bail!(); // tangent
    }
    // The two circles' meeting points, in the plane square to the axis.
    let e = scale(perp, 1.0 / d);
    let h = cross(a, e);
    let x = (d * d + big * big - small * small) / (2.0 * d);
    let y = (big * big - x * x).max(0.0).sqrt();
    // Heights, along f's own axis, where g's wall exists.
    let ga = dot(gc.axis, a);
    let g0 = dot(delta, a) + ga * gc.vmin;
    let g1 = dot(delta, a) + ga * gc.vmax;
    let (lo, hi) = ((c.vmin).max(g0.min(g1)), (c.vmax).min(g0.max(g1)));
    if hi - lo <= EPS {
        return Ok(());
    }
    let tol = EPS / c.radius;
    for sy in [y, -y] {
        let p = add(scale(e, x), scale(h, sy));
        let th = dot(p, c.e2).atan2(dot(p, c.e1));
        let rel = pos_ang(th - f.u0);
        if rel > f.span + tol || (f.span < TAU - 1e-9 && (rel < tol || rel > f.span - tol)) {
            continue;
        }
        us.push(rel + f.u0);
        if lo > c.vmin + EPS {
            vs.push(lo);
        }
        if hi < c.vmax - EPS {
            vs.push(hi);
        }
    }
    Ok(())
}

/// Two parallel walls of ONE solid that overlap (the sides of two holes that merge) share the
/// line where they meet, each as the edge of one of its cells. A height that splits a cell
/// there must split the other cell too, or the shared edge is whole on one side and in pieces
/// on the other and never pairs up. Repeated until no cell changes (a chain of holes).
fn share_heights(faces: &[AFace], grids: &mut [Option<Grid>]) {
    let n = faces.len();
    // For each ordered pair of cells that really share a line: i, j, and the height offset
    // and direction taking j's heights into i's.
    let mut links: Vec<(usize, usize, f64, f64)> = Vec::new();
    for i in 0..n {
        for j in 0..n {
            let (AFace::Cyl(wi), AFace::Cyl(wj)) = (&faces[i], &faces[j]) else { continue };
            if i == j {
                continue;
            }
            let (ci, cj) = (&wi.cyl, &wj.cyl);
            let a = normalize(ci.axis);
            let aj = dot(normalize(cj.axis), a);
            if aj.abs() < 1.0 - 1e-9 {
                continue;
            }
            let delta = sub(cj.origin, ci.origin);
            let perp = sub(delta, scale(a, dot(delta, a)));
            let d = len(perp);
            let (big, small) = (ci.radius, cj.radius);
            if d < EPS || d > big + small - EPS || d < (big - small).abs() + EPS {
                continue; // coaxial, apart, tangent or nested: no shared line
            }
            let e = scale(perp, 1.0 / d);
            let h = cross(a, e);
            let x = (d * d + big * big - small * small) / (2.0 * d);
            let y = (big * big - x * x).max(0.0).sqrt();
            let shares = |sy: f64| {
                let p = add(scale(e, x), scale(h, sy));
                let on = |w: &CFace, rel: Vec3| {
                    let th = dot(rel, w.cyl.e2).atan2(dot(rel, w.cyl.e1));
                    let r = pos_ang(th - w.u0);
                    let tol = EPS / w.cyl.radius;
                    r <= w.span + tol || r >= TAU - tol
                };
                on(wi, p) && on(wj, sub(p, perp))
            };
            if shares(y) || shares(-y) {
                links.push((i, j, dot(delta, a), aj));
            }
        }
    }
    for _ in 0..8 {
        let mut changed = false;
        for &(i, j, off, aj) in &links {
            let (Some(gj), AFace::Cyl(wi)) = (grids[j].as_ref(), &faces[i]) else { continue };
            let incoming: Vec<f64> = gj.vs.iter().map(|&v| off + aj * v).filter(|&vi| vi > wi.cyl.vmin + EPS && vi < wi.cyl.vmax - EPS).collect();
            if let Some(gi) = grids[i].as_mut() {
                for vi in incoming {
                    if !gi.vs.iter().any(|&w| (w - vi).abs() < EPS) {
                        gi.vs.push(vi);
                        changed = true;
                    }
                }
                gi.vs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            }
        }
        if !changed {
            break;
        }
    }
}

/// Points a plane face's outline and cuts must be broken at so they match the
/// grid of every cylinder wall that meets the plane: the wall's rim circle and
/// its meeting circle get a node at each grid angle, and its meeting lines get
/// a node at each grid height. A point off the face's edges is simply unused.
fn grid_nodes(f: &PFace, walls: &[(&CFace, &Grid)]) -> Vec<P2> {
    let n = f.plane.n;
    let mut out = Vec::new();
    for (w, g) in walls {
        let c = &w.cyl;
        let ax = dot(c.axis, n);
        if ax.abs() > 1.0 - 1e-9 {
            let v0 = dot(sub(f.plane.origin, c.origin), n) / ax;
            if v0 >= c.vmin - EPS && v0 <= c.vmax + EPS {
                for &th in &g.us {
                    out.push(f.plane.project(cyl_pt(c, th, v0)));
                }
            }
        } else if ax.abs() < 1e-9 {
            let k = dot(sub(f.plane.origin, c.origin), n);
            let (a, b) = (dot(c.e1, n), dot(c.e2, n));
            let rr = c.radius * (a * a + b * b).sqrt();
            if k.abs() < rr - EPS {
                let (phi, del) = (b.atan2(a), (k / rr).acos());
                for th in [phi + del, phi - del] {
                    for &v in &g.vs {
                        out.push(f.plane.project(cyl_pt(c, th, v)));
                    }
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Two round holes that cross (S3b): a bore wall pierced by a second bore.
// ---------------------------------------------------------------------------

/// The widest tool, as a fraction of the bore, whose meeting curve this models.
const CROSS_MAX_RATIO: f64 = 0.95;

/// A bore wall `W` (inward-facing wall of a hole in solid A) crossed by a tool
/// cylinder `T` (solid B) at right angles, T's axis through W's axis, T narrower
/// than W. Frames are rewritten to `n = a x d`: W `(n, d)`, T `(n, a)`.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    /// A tool bore pierces a bore wall of a block (subtract).
    Bore,
    /// Two SOLID cylinders at right angles: keep everything outside the other (union).
    Union,
    /// Two solid cylinders at right angles: keep what is inside the other (intersect).
    Intersect,
}

#[derive(Clone, Debug)]
struct Crossing {
    mode: Mode,
    wi: usize,
    ti: usize,
    a: Vec3,
    d: Vec3,
    n: Vec3,
    big_r: f64,
    r: f64,
    /// Where the two axes meet.
    p0: Vec3,
    /// Height of that point on W's axis, from W's origin.
    c_v: f64,
    /// T's extent along `d` from `p0`.
    xl: f64,
    xh: f64,
    /// T goes through W's wall on its `+d` side / `-d` side.
    plus: bool,
    minus: bool,
}

fn find_crossings(pa: &[AFace], pb: &[AFace]) -> Vec<Crossing> {
    let mut out = Vec::new();
    for (wi, fw) in pa.iter().enumerate() {
        let AFace::Cyl(w) = fw else { continue };
        if cyl_hand(&w.cyl) >= 0.0 || w.span < TAU - 1e-9 {
            continue;
        }
        for (ti, ft) in pb.iter().enumerate() {
            let AFace::Cyl(t) = ft else { continue };
            if cyl_hand(&t.cyl) <= 0.0 || t.span < TAU - 1e-9 {
                continue;
            }
            let (wc, tc) = (&w.cyl, &t.cyl);
            let (a, d) = (normalize(wc.axis), normalize(tc.axis));
            if dot(a, d).abs() > 1e-9 {
                continue;
            }
            let (big_r, r) = (wc.radius, tc.radius);
            if r < 1e-6 * big_r || r > big_r * CROSS_MAX_RATIO {
                continue;
            }
            let delta = sub(tc.origin, wc.origin);
            if dot(delta, normalize(cross(a, d))).abs() > 1e-9 * big_r.max(1.0) {
                continue; // skew axes
            }
            let c_v = dot(delta, a);
            let p0 = add(wc.origin, scale(a, c_v));
            let m = 1e-6 * big_r;
            if !(c_v - r > wc.vmin + m && c_v + r < wc.vmax - m) {
                continue;
            }
            let x0 = dot(sub(tc.origin, p0), d);
            let (xl, xh) = (x0 + tc.vmin, x0 + tc.vmax);
            let s0 = (big_r * big_r - r * r).sqrt();
            let tol = 1e-9 * big_r.max(1.0);
            // Each end of the tool either clears the wall (beyond R) or stops inside
            // the void (short of the nearest the meeting curve comes, s0).
            let side = |x: f64| -> Option<bool> {
                if x >= big_r - tol {
                    Some(true)
                } else if x <= s0 + m {
                    Some(false)
                } else {
                    None
                }
            };
            let (Some(plus), Some(minus)) = (side(xh), side(-xl)) else { continue };
            if !plus && !minus {
                continue;
            }
            out.push(Crossing { mode: Mode::Bore, wi, ti, a, d, n: normalize(cross(a, d)), big_r, r, p0, c_v, xl, xh, plus, minus });
        }
    }
    out
}

/// Two SOLID cylinders at right angles whose axes meet, the small one (r <= 0.95 R) laid across the
/// big one's side clear of its caps (S4e). Each end of the small one either clears the big one
/// (`>= R`, flush counts) or stops inside it (`|x| <= sqrt(R^2 - r^2)`, short of the nearest the
/// meeting curve comes); at least one clears it. `plus`/`minus` say which ends clear. The mode is
/// set by the caller.
fn find_solid_crossings(pa: &[AFace], pb: &[AFace]) -> Vec<Crossing> {
    let mut out = Vec::new();
    for (wi, fw) in pa.iter().enumerate() {
        let AFace::Cyl(w) = fw else { continue };
        if cyl_hand(&w.cyl) <= 0.0 || w.span < TAU - 1e-9 || w.cyl.cross.is_some() || w.cyl.arc.is_some() {
            continue;
        }
        for (ti, ft) in pb.iter().enumerate() {
            let AFace::Cyl(t) = ft else { continue };
            if cyl_hand(&t.cyl) <= 0.0 || t.span < TAU - 1e-9 || t.cyl.cross.is_some() || t.cyl.arc.is_some() {
                continue;
            }
            let (wc, tc) = (&w.cyl, &t.cyl);
            let (a, d) = (normalize(wc.axis), normalize(tc.axis));
            if dot(a, d).abs() > 1e-9 {
                continue;
            }
            let (big_r, r) = (wc.radius, tc.radius);
            if r < 1e-6 * big_r || r > big_r * CROSS_MAX_RATIO {
                continue;
            }
            let delta = sub(tc.origin, wc.origin);
            if dot(delta, normalize(cross(a, d))).abs() > 1e-9 * big_r.max(1.0) {
                continue; // skew axes
            }
            let c_v = dot(delta, a);
            let p0 = add(wc.origin, scale(a, c_v));
            let m = 1e-6 * big_r;
            if !(c_v - r > wc.vmin + m && c_v + r < wc.vmax - m) {
                continue;
            }
            // The tool's ends along d from p0, the way d points (tc.axis may be -d).
            let x0 = dot(sub(tc.origin, p0), d);
            let sg = dot(tc.axis, d).signum();
            let (e1, e2) = (x0 + sg * tc.vmin, x0 + sg * tc.vmax);
            let (xl, xh) = (e1.min(e2), e1.max(e2));
            let s0 = (big_r * big_r - r * r).sqrt();
            let tol = 1e-9 * big_r.max(1.0);
            let plus = xh >= big_r - tol;
            let minus = xl <= -(big_r - tol);
            let ok_end = |x: f64, clears: bool| clears || x.abs() <= s0 - m;
            if !(plus || minus) || !ok_end(xh, plus) || !ok_end(xl, minus) {
                continue;
            }
            out.push(Crossing { mode: Mode::Union, wi, ti, a, d, n: normalize(cross(a, d)), big_r, r, p0, c_v, xl, xh, plus, minus });
        }
    }
    out
}

/// Put both walls of each crossing into the frame the trims are written in, so
/// the seams of every circle on the plane faces line up with them.
fn reframe(pa: &mut [AFace], pb: &mut [AFace], cs: &[Crossing]) {
    for c in cs {
        if let AFace::Cyl(w) = &mut pa[c.wi] {
            w.cyl.e1 = c.n;
            // A bore wall faces the void (left-handed frame); a solid cylinder's own wall faces out.
            w.cyl.e2 = if c.mode == Mode::Bore { c.d } else { scale(c.d, -1.0) };
            w.u0 = 0.0;
            w.span = TAU;
            w.cyl.arc = None;
        }
        if let AFace::Cyl(t) = &mut pb[c.ti] {
            t.cyl.origin = c.p0;
            t.cyl.axis = c.d;
            t.cyl.e1 = c.n;
            t.cyl.e2 = c.a;
            t.cyl.vmin = c.xl;
            t.cyl.vmax = c.xh;
            t.u0 = 0.0;
            t.span = TAU;
            t.cyl.arc = None;
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Lvl {
    Const(f64),
    /// The meeting curve, branch `+1` or `-1`.
    Curve(f64),
}

type CurveEdge = (topo::EdgeRef<crate::build::Curve3>, topo::VertexRef, Vec3);

/// The faces a crossing makes: the bore wall with its holes, and each piece of
/// the tool's wall that lies in material, between a face of A and the meeting
/// curve. Both carry the same meeting-curve edges by handle.
fn cross_pair(cr: &Crossing, w: &CFace, t: &CFace, a_solid: &TSolid, b_solid: &TSolid, tgrid: &Grid, vertex: VertexFn) -> Result<Vec<Kept>, ()> {
    let (a, d, n, big_r, r, p0) = (cr.a, cr.d, cr.n, cr.big_r, cr.r, cr.p0);
    let s0 = (big_r * big_r - r * r).sqrt();
    let (wc, tc) = (&w.cyl, &t.cyl);
    let m = 1e-6 * big_r;
    let tol = 1e-9 * big_r.max(1.0);
    if !tgrid.us.is_empty() {
        bail!();
    }
    let curve = |sign: f64| Curve::CylCyl { center: p0, d, n, a, big_r, r, sign };
    let mk = |sign: f64, vertex: &mut dyn FnMut(Vec3) -> topo::VertexRef| -> CurveEdge {
        let tip = curve(sign).point_at(0.0);
        let v = vertex(tip);
        (topo::edge(v.clone(), v.clone(), true, curve(sign)), v, tip)
    };
    let loop_p: Option<CurveEdge> = if cr.plus { Some(mk(1.0, vertex)) } else { None };
    let loop_m: Option<CurveEdge> = if cr.minus { Some(mk(-1.0, vertex)) } else { None };
    let z = Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
    let us = |e: &topo::EdgeRef<crate::build::Curve3>, forward: bool| topo::EdgeUse { edge: e.clone(), forward, pcurve: z };
    let wire = |uses: Vec<topo::EdgeUse<crate::build::Curve3>>| Rc::new(RefCell::new(Wire { edges: uses }));
    let tau = TAU;
    let mut out = Vec::new();

    // --- the bore wall, holes where the tool goes through ---------------------
    let ring = |v: f64| add(wc.origin, scale(a, v));
    let (p_lo, p_hi) = (add(ring(wc.vmin), scale(n, big_r)), add(ring(wc.vmax), scale(n, big_r)));
    let (v_rb, v_rt) = (vertex(p_lo), vertex(p_hi));
    let seam_w = topo::edge(v_rb.clone(), v_rt.clone(), true, Curve::Segment { a: p_lo, b: p_hi });
    // Whole-sweep arcs, not circles: an arc starts exactly at the seam (a circle at a point its
    // normal chooses), which the trimmed-face meshers rely on. Normal -a so the sweep runs
    // toward increasing u in this left-handed frame.
    let rim = |v: f64, at: &topo::VertexRef| topo::edge(at.clone(), at.clone(), true, Curve::Arc { center: ring(v), radius: big_r, normal: scale(a, -1.0), x_axis: n, sweep: TAU });
    let (rim_lo, rim_hi) = (rim(wc.vmin, &v_rb), rim(wc.vmax, &v_rt));
    let mut wires = vec![wire(vec![us(&seam_w, true), us(&rim_hi, true), us(&seam_w, false), us(&rim_lo, false)])];
    for l in [&loop_p, &loop_m].into_iter().flatten() {
        wires.push(wire(vec![us(&l.0, false)]));
    }
    // With e2 = +d the hole at +d is centred at u = pi/2 and the hole at -d at 3 pi/2,
    // the other way round from a part's own wall (e2 = -d): the flags swap.
    let keep_w = !ops::inside_solid(b_solid, cyl_pt(wc, 0.0, 0.5 * (wc.vmin + wc.vmax)));
    if !keep_w {
        bail!();
    }
    out.push(Kept::Wall(Rc::new(RefCell::new(Face {
        boundary: wires,
        forward: true,
        surface: Surface::Cylinder(Cylinder {
            origin: wc.origin,
            axis: a,
            e1: n,
            e2: d,
            radius: big_r,
            vmin: wc.vmin,
            vmax: wc.vmax,
            arc: None,
            cross: Some(crate::geom::Cross::Wall { r, c_v: cr.c_v, plus: cr.minus, minus: cr.plus }),
        }),
        uv_domain: [[0.0, tau], [0.0, 1.0]],
    }))));

    // --- the tool's wall: strips between levels along its axis -----------------
    let mut levels: Vec<(f64, Lvl)> = Vec::new();
    let mut consts = vec![tc.vmin, tc.vmax];
    consts.extend(tgrid.vs.iter().copied());
    for c in consts {
        // A flat face may cut the tool only where it cannot meet the curve.
        if !(c.abs() >= big_r - tol || c.abs() <= s0 - m) {
            bail!();
        }
        levels.push((c, Lvl::Const(c)));
    }
    if cr.plus {
        levels.push((s0, Lvl::Curve(1.0)));
    }
    if cr.minus {
        levels.push((-s0, Lvl::Curve(-1.0)));
    }
    levels.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
    levels.dedup_by(|x, y| matches!((x.1, y.1), (Lvl::Const(_), Lvl::Const(_))) && (x.0 - y.0).abs() < tol);
    for pair in levels.windows(2) {
        let ((k1, l1), (k2, l2)) = (pair[0], pair[1]);
        if k2 - k1 < tol {
            continue;
        }
        let mid = add(add(p0, scale(d, 0.5 * (k1 + k2))), scale(n, r));
        let inside = ops::inside_solid(a_solid, mid);
        match (l1, l2) {
            (Lvl::Curve(_), Lvl::Curve(_)) | (Lvl::Const(_), Lvl::Const(_)) => {
                if inside {
                    bail!();
                }
            }
            _ if !inside => {}
            (c_lo, c_hi) => {
                let (c, sign, const_is_lo) = match (c_lo, c_hi) {
                    (Lvl::Const(c), Lvl::Curve(s)) => (c, s, true),
                    (Lvl::Curve(s), Lvl::Const(c)) => (c, s, false),
                    _ => bail!(),
                };
                let (lp, tip_v, tip_p) = match if sign > 0.0 { &loop_p } else { &loop_m } {
                    Some(l) => (l.0.clone(), l.1.clone(), l.2),
                    None => bail!(),
                };
                let seam_pt = add(add(p0, scale(d, c)), scale(n, r));
                let v_c = vertex(seam_pt);
                let circle = topo::edge(v_c.clone(), v_c.clone(), true, Curve::Arc { center: add(p0, scale(d, c)), radius: r, normal: scale(d, -1.0), x_axis: n, sweep: TAU });
                let seam_t = topo::edge(tip_v.clone(), v_c.clone(), true, Curve::Segment { a: tip_p, b: seam_pt });
                let uses = vec![us(&lp, true), us(&seam_t, true), us(&circle, true), us(&seam_t, false)];
                let (lo, hi, lo_sign, hi_sign) = if const_is_lo { (Some(c), None, -1.0, sign) } else { (None, Some(c), sign, 1.0) };
                let extent = [c, sign * s0, sign * big_r];
                let vmin = extent.iter().cloned().fold(f64::MAX, f64::min);
                let vmax = extent.iter().cloned().fold(f64::MIN, f64::max);
                out.push(Kept::Wall(Rc::new(RefCell::new(Face {
                    boundary: vec![wire(uses)],
                    forward: true,
                    surface: Surface::Cylinder(Cylinder {
                        origin: p0,
                        axis: d,
                        // The wall of the void: looks into the bore, the way a subtracted tool's wall does.
                        e1: n,
                        e2: scale(a, -1.0),
                        radius: r,
                        vmin,
                        vmax,
                        arc: None,
                        cross: Some(crate::geom::Cross::Tool { big_r, lo, hi, lo_sign, hi_sign }),
                    }),
                    uv_domain: [[0.0, tau], [0.0, 1.0]],
                }))));
            }
        }
    }
    Ok(out)
}

/// The faces two crossing SOLID cylinders make (S4e), all with outward normals.
///
/// Union keeps the big wall with a hole where the small one goes through (`Cross::Wall`, frame
/// `(n, -d)`) and the small wall between the meeting curve and each flat end that clears the big
/// cylinder (`Cross::Tool`, frame `(n, a)`). Intersect keeps what lies inside the other: for the
/// big wall one `Cross::Patch` per hole, for the small wall the strips between the meeting curve
/// and a flat end that stops inside, or between the two curves. Both share the meeting-curve loops
/// by handle.
fn cross_pair_solid(cr: &Crossing, w: &CFace, t: &CFace, a_solid: &TSolid, b_solid: &TSolid, tgrid: &Grid, vertex: VertexFn) -> Result<Vec<Kept>, ()> {
    let (a, d, n, big_r, r, p0) = (cr.a, cr.d, cr.n, cr.big_r, cr.r, cr.p0);
    let union = cr.mode == Mode::Union;
    let s0 = (big_r * big_r - r * r).sqrt();
    let (wc, tc) = (&w.cyl, &t.cyl);
    let m = 1e-6 * big_r;
    let tol = 1e-9 * big_r.max(1.0);
    if !tgrid.us.is_empty() || !tgrid.vs.is_empty() {
        bail!();
    }
    let curve = |sign: f64| Curve::CylCyl { center: p0, d, n, a, big_r, r, sign };
    let mk = |sign: f64, vertex: &mut dyn FnMut(Vec3) -> topo::VertexRef| -> CurveEdge {
        let tip = curve(sign).point_at(0.0);
        let v = vertex(tip);
        (topo::edge(v.clone(), v.clone(), true, curve(sign)), v, tip)
    };
    let loop_p: Option<CurveEdge> = if cr.plus { Some(mk(1.0, vertex)) } else { None };
    let loop_m: Option<CurveEdge> = if cr.minus { Some(mk(-1.0, vertex)) } else { None };
    let z = Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
    let us = |e: &topo::EdgeRef<crate::build::Curve3>, forward: bool| topo::EdgeUse { edge: e.clone(), forward, pcurve: z };
    let wire = |uses: Vec<topo::EdgeUse<crate::build::Curve3>>| Rc::new(RefCell::new(Wire { edges: uses }));
    let tau = TAU;
    let mut out = Vec::new();
    let wall_surface = |cross: crate::geom::Cross| {
        Surface::Cylinder(Cylinder { origin: wc.origin, axis: a, e1: n, e2: scale(d, -1.0), radius: big_r, vmin: wc.vmin, vmax: wc.vmax, arc: None, cross: Some(cross) })
    };

    // --- the big wall ---------------------------------------------------------
    if union {
        let ring = |v: f64| add(wc.origin, scale(a, v));
        let (p_lo, p_hi) = (add(ring(wc.vmin), scale(n, big_r)), add(ring(wc.vmax), scale(n, big_r)));
        let (v_rb, v_rt) = (vertex(p_lo), vertex(p_hi));
        let seam_w = topo::edge(v_rb.clone(), v_rt.clone(), true, Curve::Segment { a: p_lo, b: p_hi });
        let rim = |v: f64, at: &topo::VertexRef| topo::edge(at.clone(), at.clone(), true, Curve::Arc { center: ring(v), radius: big_r, normal: a, x_axis: n, sweep: tau });
        let (rim_lo, rim_hi) = (rim(wc.vmin, &v_rb), rim(wc.vmax, &v_rt));
        let mut wires = vec![wire(vec![us(&seam_w, true), us(&rim_hi, true), us(&seam_w, false), us(&rim_lo, false)])];
        for l in [&loop_p, &loop_m].into_iter().flatten() {
            wires.push(wire(vec![us(&l.0, false)]));
        }
        // A wall point at the seam is outside the small cylinder, so the wall is kept whole less its holes.
        if ops::inside_solid(b_solid, cyl_pt(wc, 0.0, 0.5 * (wc.vmin + wc.vmax))) {
            bail!();
        }
        out.push(Kept::Wall(Rc::new(RefCell::new(Face {
            boundary: wires,
            forward: true,
            surface: wall_surface(crate::geom::Cross::Wall { r, c_v: cr.c_v, plus: cr.plus, minus: cr.minus }),
            uv_domain: [[0.0, tau], [0.0, 1.0]],
        }))));
    } else {
        for (l, plus) in [(&loop_p, true), (&loop_m, false)] {
            let Some(l) = l else { continue };
            out.push(Kept::Wall(Rc::new(RefCell::new(Face {
                boundary: vec![wire(vec![us(&l.0, true)])],
                forward: true,
                surface: wall_surface(crate::geom::Cross::Patch { r, c_v: cr.c_v, plus, minus: !plus }),
                uv_domain: [[0.0, tau], [0.0, 1.0]],
            }))));
        }
    }

    // --- the small wall: strips between levels along its axis -----------------
    let mut levels: Vec<(f64, Lvl)> = Vec::new();
    for c in [tc.vmin, tc.vmax] {
        if !(c.abs() >= big_r - tol || c.abs() <= s0 - m) {
            bail!();
        }
        levels.push((c, Lvl::Const(c)));
    }
    if cr.plus {
        levels.push((s0, Lvl::Curve(1.0)));
    }
    if cr.minus {
        levels.push((-s0, Lvl::Curve(-1.0)));
    }
    levels.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
    levels.dedup_by(|x, y| matches!((x.1, y.1), (Lvl::Const(_), Lvl::Const(_))) && (x.0 - y.0).abs() < tol);
    for pair in levels.windows(2) {
        let ((k1, l1), (k2, l2)) = (pair[0], pair[1]);
        if k2 - k1 < tol {
            continue;
        }
        let mid = add(add(p0, scale(d, 0.5 * (k1 + k2))), scale(n, r));
        let inside = ops::inside_solid(a_solid, mid);
        if inside == union {
            // Union keeps what is outside the big cylinder, intersect what is inside it.
            continue;
        }
        let tool_face = |uses: Vec<topo::EdgeUse<crate::build::Curve3>>, lo: Option<f64>, hi: Option<f64>, lo_sign: f64, hi_sign: f64, vmin: f64, vmax: f64| -> Kept {
            Kept::Wall(Rc::new(RefCell::new(Face {
                boundary: vec![wire(uses)],
                forward: true,
                surface: Surface::Cylinder(Cylinder {
                    origin: p0,
                    axis: d,
                    e1: n,
                    e2: a,
                    radius: r,
                    vmin,
                    vmax,
                    arc: None,
                    cross: Some(crate::geom::Cross::Tool { big_r, lo, hi, lo_sign, hi_sign }),
                }),
                uv_domain: [[0.0, tau], [0.0, 1.0]],
            })))
        };
        match (l1, l2) {
            (Lvl::Const(_), Lvl::Const(_)) => bail!(),
            (Lvl::Curve(_), Lvl::Curve(_)) => {
                // Only the part of the small wall between the two meeting curves (intersect, through).
                let (Some(lp), Some(lm)) = (&loop_p, &loop_m) else { bail!() };
                let seam_t = topo::edge(lm.1.clone(), lp.1.clone(), true, Curve::Segment { a: lm.2, b: lp.2 });
                let uses = vec![us(&seam_t, false), us(&lm.0, false), us(&seam_t, true), us(&lp.0, false)];
                out.push(tool_face(uses, None, None, -1.0, 1.0, -big_r, big_r));
            }
            (c_lo, c_hi) => {
                let (c, sign, const_is_lo) = match (c_lo, c_hi) {
                    (Lvl::Const(c), Lvl::Curve(s)) => (c, s, true),
                    (Lvl::Curve(s), Lvl::Const(c)) => (c, s, false),
                    _ => bail!(),
                };
                let (lp, tip_v, tip_p) = match if sign > 0.0 { &loop_p } else { &loop_m } {
                    Some(l) => (l.0.clone(), l.1.clone(), l.2),
                    None => bail!(),
                };
                let seam_pt = add(add(p0, scale(d, c)), scale(n, r));
                let v_c = vertex(seam_pt);
                let circle = topo::edge(v_c.clone(), v_c.clone(), true, Curve::Arc { center: add(p0, scale(d, c)), radius: r, normal: scale(d, -1.0), x_axis: n, sweep: tau });
                let seam_t = topo::edge(tip_v.clone(), v_c.clone(), true, Curve::Segment { a: tip_p, b: seam_pt });
                // The loop runs the same way on both faces that share it: forward here for the strip
                // outside the big cylinder (union), reversed for the one inside it (intersect).
                let uses = vec![us(&lp, union), us(&seam_t, true), us(&circle, true), us(&seam_t, false)];
                let (lo, hi, lo_sign, hi_sign) = if const_is_lo { (Some(c), None, -1.0, sign) } else { (None, Some(c), sign, 1.0) };
                let extent = [c, sign * s0, sign * big_r];
                let vmin = extent.iter().cloned().fold(f64::MAX, f64::min);
                let vmax = extent.iter().cloned().fold(f64::MIN, f64::max);
                out.push(tool_face(uses, lo, hi, lo_sign, hi_sign, vmin, vmax));
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Classification and assembly.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Class {
    Inside,
    Outside,
    OnSame,
    OnOpposite,
}

fn classify_plane(f: &PFace, p3: Vec3, other: &[AFace], other_solid: &TSolid) -> Result<Class, ()> {
    for g in other {
        if let AFace::Plane(g) = g {
            if coplanar(f, g) {
                let ge: Vec<E2> = g.curves.iter().map(|c| to_e2(c, &f.plane)).collect::<Option<_>>().ok_or(())?;
                if in_edges(f.plane.project(p3), &ge) {
                    return Ok(if dot(f.plane.n, g.plane.n) > 0.0 { Class::OnSame } else { Class::OnOpposite });
                }
            }
        }
    }
    Ok(if ops::inside_solid(other_solid, p3) { Class::Inside } else { Class::Outside })
}

/// A cell of cylinder wall `f` at height `v` that lies ON a whole-turn wall of the other solid with the same axis
/// line and radius is OnSame (both normals alike: two bores, two pegs) or OnOpposite (a peg in its own hole). The
/// other wall must be a whole turn, which `parallel_wall_lines` has already required.
fn coincident_wall(f: &CFace, other: &[AFace], v: f64) -> Option<Class> {
    let c = &f.cyl;
    let a = normalize(c.axis);
    for g in other {
        let AFace::Cyl(g) = g else { continue };
        let gc = &g.cyl;
        if len(cross(a, normalize(gc.axis))) > 1e-9 || (gc.radius - c.radius).abs() >= EPS || g.span < TAU - 1e-9 {
            continue;
        }
        let delta = sub(gc.origin, c.origin);
        if len(sub(delta, scale(a, dot(delta, a)))) >= EPS {
            continue;
        }
        let ga = dot(gc.axis, a);
        let (g0, g1) = (dot(delta, a) + ga * gc.vmin, dot(delta, a) + ga * gc.vmax);
        if v > g0.min(g1) + EPS && v < g0.max(g1) - EPS {
            return Some(if cyl_hand(c) * cyl_hand(gc) > 0.0 { Class::OnSame } else { Class::OnOpposite });
        }
    }
    None
}

enum Kept {
    Plane { plane: Plane, region: Region },
    /// A finished cylinder-wall face, already flipped when it must be.
    Wall(TFace),
}

type VertexFn<'a> = &'a mut dyn FnMut(Vec3) -> topo::VertexRef;

/// A flat end of the small cylinder of a solid crossing that clears the big one (at or beyond its
/// wall): outside it, touching it at most along a line when flush, and cut by nothing.
fn clear_end_disk(c: &Crossing, f: &AFace) -> bool {
    let AFace::Plane(f) = f else { return false };
    c.mode != Mode::Bore && len(cross(f.plane.n, c.d)) < 1e-9 && dot(sub(f.plane.origin, c.p0), c.d).abs() >= c.big_r - 1e-9 * c.big_r.max(1.0)
}

#[allow(clippy::too_many_arguments)]
fn pieces(
    faces: &[AFace],
    grids: &[Option<Grid>],
    other: &[AFace],
    other_grids: &[Option<Grid>],
    own_solid: &TSolid,
    other_solid: &TSolid,
    keep: &dyn Fn(Class) -> bool,
    flip: bool,
    walls: &[(&CFace, &Grid)],
    crossings: &[Crossing],
    side: usize,
    vertex: VertexFn,
) -> Result<Vec<Kept>, ()> {
    let mut out = Vec::new();
    for (fi, (face, grid)) in faces.iter().zip(grids).enumerate() {
        match face {
            AFace::Plane(f) => {
                let clear = side == 1 && crossings.iter().any(|c| clear_end_disk(c, face));
                let cuts = if clear { Vec::new() } else { cuts_on_plane(f, other, side == 0)? };
                for region in split_face(f, &cuts, &grid_nodes(f, walls))? {
                    let s = interior_point(&region).ok_or(())?;
                    if !in_edges(s, &f.edges) {
                        continue;
                    }
                    let class = if clear { Class::Outside } else { classify_plane(f, f.plane.point(s), other, other_solid)? };
                    if keep(class) {
                        let plane = if flip { Plane { origin: f.plane.origin, n: scale(f.plane.n, -1.0), u: f.plane.u, v: f.plane.v } } else { f.plane.clone() };
                        out.push(Kept::Plane { plane, region });
                    }
                }
            }
            AFace::Rev(f) => {
                let g = grid.as_ref().ok_or(())?;
                let mut zs = vec![f.zlo];
                zs.extend(g.vs.iter().copied());
                zs.push(f.zhi);
                for w in zs.windows(2) {
                    let class = rev_class(f, w[0], w[1], other_solid)?;
                    if !keep(class) {
                        continue;
                    }
                    let face = rev_piece(f, w[0], w[1], vertex);
                    out.push(Kept::Wall(if flip { ops::flip_face(&face).ok_or(())? } else { face }));
                }
            }
            AFace::Cyl(f) => {
                if side == 1 && crossings.iter().any(|c| c.ti == fi) {
                    continue; // made with its bore wall, below
                }
                let g = grid.as_ref().ok_or(())?;
                if side == 0 {
                    if let Some(cr) = crossings.iter().find(|c| c.wi == fi) {
                        let AFace::Cyl(t) = &other[cr.ti] else { bail!() };
                        let tg = other_grids[cr.ti].as_ref().ok_or(())?;
                        if !g.us.is_empty() || !g.vs.is_empty() {
                            bail!(); // another cut on a pierced wall: not modelled
                        }
                        out.extend(if cr.mode == Mode::Bore {
                            cross_pair(cr, f, t, own_solid, other_solid, tg, vertex)?
                        } else {
                            cross_pair_solid(cr, f, t, own_solid, other_solid, tg, vertex)?
                        });
                        continue;
                    }
                }
                let c = &f.cyl;
                // Angular intervals [a, b] and height intervals [lo, hi].
                let mut arcs: Vec<(f64, f64)> = Vec::new();
                if g.us.is_empty() {
                    arcs.push((f.u0, f.u0 + f.span));
                } else if f.span >= TAU - 1e-9 {
                    for k in 0..g.us.len() {
                        arcs.push((g.us[k], if k + 1 < g.us.len() { g.us[k + 1] } else { f.u0 + TAU }));
                    }
                } else {
                    let mut pts = vec![f.u0];
                    pts.extend(g.us.iter().copied());
                    pts.push(f.u0 + f.span);
                    arcs.extend(pts.windows(2).map(|w| (w[0], w[1])));
                }
                let mut hs = vec![c.vmin];
                hs.extend(g.vs.iter().copied());
                hs.push(c.vmax);
                let uncut = g.us.is_empty() && g.vs.is_empty();
                for &(a, b) in &arcs {
                    for w in hs.windows(2) {
                        let p3 = cyl_pt(c, 0.5 * (a + b), 0.5 * (w[0] + w[1]));
                        let class = match coincident_wall(f, other, 0.5 * (w[0] + w[1])) {
                            Some(c) => c,
                            None if ops::inside_solid(other_solid, p3) => Class::Inside,
                            None => Class::Outside,
                        };
                        if !keep(class) {
                            continue;
                        }
                        let face = wall_piece(c, f, a, b, w[0], w[1], uncut, vertex);
                        out.push(Kept::Wall(if flip { ops::flip_face(&face).ok_or(())? } else { face }));
                    }
                }
            }
        }
    }
    Ok(out)
}

/// One rectangle of a cylinder wall as a finished face. `uncut` keeps the
/// wall's own angular range (and its seam) exactly as it was.
#[allow(clippy::too_many_arguments)]
fn wall_piece(c: &Cylinder, orig: &CFace, th_a: f64, th_b: f64, v_lo: f64, v_hi: f64, uncut: bool, vertex: VertexFn) -> TFace {
    let sw = th_b - th_a;
    let closed = orig.span >= TAU - 1e-9 && sw >= TAU - 1e-9;
    let hand = cyl_hand(c);
    let (s_lo, s_hi) = (vertex(cyl_pt(c, th_a, v_lo)), vertex(cyl_pt(c, th_a, v_hi)));
    let seam_a = topo::edge(s_lo.clone(), s_hi.clone(), true, Curve::Segment { a: cyl_pt(c, th_a, v_lo), b: cyl_pt(c, th_a, v_hi) });
    let pc = |u0: f64, v0: f64, u1: f64, v1: f64| Pcurve { start: [u0, v0], end: [u1, v1], mid: [0.5 * (u0 + u1), 0.5 * (v0 + v1)] };
    let ring = |v: f64| add(c.origin, scale(c.axis, v));
    let uses = if closed {
        let top = topo::edge(s_hi.clone(), s_hi.clone(), true, Curve::Circle { center: ring(v_hi), radius: c.radius, normal: c.axis });
        let bot = topo::edge(s_lo.clone(), s_lo.clone(), true, Curve::Circle { center: ring(v_lo), radius: c.radius, normal: c.axis });
        vec![
            topo::EdgeUse { edge: seam_a.clone(), forward: true, pcurve: pc(th_a, v_lo, th_a, v_hi) },
            topo::EdgeUse { edge: top, forward: true, pcurve: pc(th_a, v_hi, th_b, v_hi) },
            topo::EdgeUse { edge: seam_a, forward: false, pcurve: pc(th_b, v_hi, th_b, v_lo) },
            topo::EdgeUse { edge: bot, forward: false, pcurve: pc(th_b, v_lo, th_a, v_lo) },
        ]
    } else {
        let (e_lo, e_hi) = (vertex(cyl_pt(c, th_b, v_lo)), vertex(cyl_pt(c, th_b, v_hi)));
        let seam_b = topo::edge(e_lo.clone(), e_hi.clone(), true, Curve::Segment { a: cyl_pt(c, th_b, v_lo), b: cyl_pt(c, th_b, v_hi) });
        let x_axis = normalize(add(scale(c.e1, th_a.cos()), scale(c.e2, th_a.sin())));
        let arc = |v: f64, a: &topo::VertexRef, b: &topo::VertexRef| topo::edge(a.clone(), b.clone(), true, Curve::Arc { center: ring(v), radius: c.radius, normal: c.axis, x_axis, sweep: hand * sw });
        let top = arc(v_hi, &s_hi, &e_hi);
        let bot = arc(v_lo, &s_lo, &e_lo);
        vec![
            topo::EdgeUse { edge: seam_a, forward: true, pcurve: pc(th_a, v_lo, th_a, v_hi) },
            topo::EdgeUse { edge: top, forward: true, pcurve: pc(th_a, v_hi, th_b, v_hi) },
            topo::EdgeUse { edge: seam_b, forward: false, pcurve: pc(th_b, v_hi, th_b, v_lo) },
            topo::EdgeUse { edge: bot, forward: false, pcurve: pc(th_b, v_lo, th_a, v_lo) },
        ]
    };
    let mut cyl = c.clone();
    cyl.vmin = v_lo;
    cyl.vmax = v_hi;
    cyl.arc = if closed || uncut { c.arc.clone() } else { Some(ArcRange { start: th_a, span: sw }) };
    cyl.cross = None;
    Rc::new(RefCell::new(Face {
        boundary: vec![Rc::new(RefCell::new(Wire { edges: uses }))],
        forward: true,
        surface: Surface::Cylinder(cyl),
        uv_domain: [[th_a, th_b], [v_lo, v_hi]],
    }))
}

fn e2_curve(e: &E2, plane: &Plane, as_arc: bool) -> (Curve, Vec3, Vec3) {
    match *e {
        E2::Seg(a, b) => {
            let (pa, pb) = (plane.point(a), plane.point(b));
            (Curve::Segment { a: pa, b: pb }, pa, pb)
        }
        E2::Arc { c, r, a0, sw } => {
            let center = plane.point(c);
            let normal = normalize(cross(plane.u, plane.v));
            let x_axis = add(scale(plane.u, a0.cos()), scale(plane.v, a0.sin()));
            let start = add(center, scale(x_axis, r));
            let end = plane.point(ang_pt(c, r, a0 + sw));
            if e.is_full() && !as_arc {
                (Curve::Circle { center, radius: r, normal }, start, start)
            } else {
                (Curve::Arc { center, radius: r, normal, x_axis, sweep: sw }, start, end)
            }
        }
    }
}

fn chain_poly(ch: &Chain) -> Vec<P2> {
    ch.iter().flat_map(|(e, rev)| e.sample(*rev)).collect()
}

fn reverse_chain(ch: &Chain) -> Chain {
    ch.iter().rev().map(|(e, rev)| (*e, !*rev)).collect()
}

fn build_result(kept: Vec<Kept>, crossings: &[Crossing], vertex: VertexFn) -> Option<TSolid> {
    let mut faces: Vec<TFace> = Vec::new();
    for k in kept {
        let (plane, region) = match k {
            Kept::Wall(f) => {
                faces.push(f);
                continue;
            }
            Kept::Plane { plane, region } => (plane, region),
        };
        let handed = dot(cross(plane.u, plane.v), plane.n) > 0.0;
        let mut wires = Vec::new();
        let mut rings: Vec<(&Chain, bool)> = vec![(&region.outer, false)];
        rings.extend(region.holes.iter().map(|h| (h, true)));
        for (chain, hole) in rings {
            // Outer counter-clockwise about the normal, holes clockwise.
            let ccw_uv = area2(&chain_poly(chain)) > 0.0;
            let want_ccw_uv = if hole { !handed } else { handed };
            let ch = if ccw_uv != want_ccw_uv { reverse_chain(chain) } else { chain.clone() };
            let mut uses = Vec::new();
            for (e, rev) in &ch {
                // A whole circle that bounds a crossing wall is an arc, to match that wall's rim.
                let as_arc = e.is_full() && {
                    let ce = if let E2::Arc { c, r, .. } = *e { (plane.point(c), r) } else { ([0.0; 3], 0.0) };
                    crossings.iter().any(|x| {
                        let on_line = |axis: Vec3, o: Vec3| len(cross(sub(ce.0, o), axis)) < 1e-6 && dot(plane.n, axis).abs() > 1.0 - 1e-9;
                        (on_line(x.a, x.p0) && (ce.1 - x.big_r).abs() < EPS) || (on_line(x.d, x.p0) && (ce.1 - x.r).abs() < EPS)
                    })
                };
                let (curve, pa, pb) = e2_curve(e, &plane, as_arc);
                let edge = topo::edge(vertex(pa), vertex(pb), true, curve);
                let (s, t) = if *rev { (e.at(1.0), e.at(0.0)) } else { (e.at(0.0), e.at(1.0)) };
                uses.push(topo::EdgeUse { edge, forward: !*rev, pcurve: Pcurve { start: s, end: t, mid: e.at(0.5) } });
            }
            wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
        }
        faces.push(Rc::new(RefCell::new(Face {
            boundary: wires,
            forward: true,
            surface: Surface::Plane(plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        })));
    }
    if faces.is_empty() {
        return None;
    }
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

/// One boolean through the pipeline, then every structural guard. `Ok(None)`
/// for an empty answer.
fn core(op: &str, a: &TSolid, b: &TSolid, pa: &[AFace], pb: &[AFace], crossings: &[Crossing]) -> Result<Option<TSolid>, ()> {
    core_carry(op, a, b, pa, pb, crossings, Vec::new())
}

/// `core`, with faces of `a` that the cut never reaches (`carry`, copies, adjacent to the faces
/// in `pa` only through shared edge geometry) added to the result before it is welded and checked.
fn core_carry(op: &str, a: &TSolid, b: &TSolid, pa: &[AFace], pb: &[AFace], crossings: &[Crossing], carry: Vec<TFace>) -> Result<Option<TSolid>, ()> {
    CUR_OP.with(|c| c.set(match op { "union" => 0, "subtract" => 1, _ => 2 }));
    let (ka, kb): (Box<dyn Fn(Class) -> bool>, Box<dyn Fn(Class) -> bool>) = match op {
        "union" => (Box::new(|c| matches!(c, Class::Outside | Class::OnSame)), Box::new(|c| c == Class::Outside)),
        "subtract" => (Box::new(|c| matches!(c, Class::Outside | Class::OnOpposite)), Box::new(|c| c == Class::Inside)),
        "intersect" => (Box::new(|c| matches!(c, Class::Inside | Class::OnSame)), Box::new(|c| c == Class::Inside)),
        _ => bail!(),
    };
    let mut verts: Vec<topo::VertexRef> = Vec::new();
    let mut vertex = |p: Vec3| -> topo::VertexRef {
        for v in &verts {
            if len(sub(v.borrow().point, p)) < EPS {
                return v.clone();
            }
        }
        let v = topo::vertex(p);
        verts.push(v.clone());
        v
    };
    let grid_of = |faces: &[AFace], other: &[AFace], side: usize| -> Result<Vec<Option<Grid>>, ()> {
        faces
            .iter()
            .enumerate()
            .map(|(i, f)| {
                if let AFace::Rev(r) = f {
                    rev_grid(r, other).map(Some)
                } else if let AFace::Cyl(w) = f {
                    let skip = |gi: usize| {
                        crossings.iter().any(|c| {
                            if side == 0 { c.wi == i && (c.ti == gi || clear_end_disk(c, &other[gi])) } else { c.ti == i && c.wi == gi }
                        })
                    };
                    wall_grid(w, other, &skip, side == 0).map(Some)
                } else {
                    Ok(None)
                }
            })
            .collect()
    };
    let (mut ga, mut gb) = (grid_of(pa, pb, 0)?, grid_of(pb, pa, 1)?);
    share_heights(pa, &mut ga);
    share_heights(pb, &mut gb);
    let mut walls: Vec<(&CFace, &Grid)> = Vec::new();
    for (faces, grids) in [(pa, &ga), (pb, &gb)] {
        for (f, g) in faces.iter().zip(grids) {
            if let (AFace::Cyl(w), Some(g)) = (f, g) {
                walls.push((w, g));
            }
        }
    }
    let mut kept = pieces(pa, &ga, pb, &gb, a, b, ka.as_ref(), false, &walls, crossings, 0, &mut vertex)?;
    kept.extend(pieces(pb, &gb, pa, &ga, b, a, kb.as_ref(), op == "subtract", &walls, crossings, 1, &mut vertex)?);
    let Some(solid) = build_result(kept, crossings, &mut vertex) else {
        return Ok(None);
    };
    let mut faces = solid.faces();
    faces.extend(carry);
    // A planar sliver of no area is a legitimate leftover and is dropped. A CURVED face of no area is
    // never a sliver: it is a band built without its heights (perm#4862), and dropping it would delete
    // a whole closed ball or cone from the result without opening the shell, so no guard downstream
    // could see it.
    if faces.iter().any(|f| {
        let fb = f.borrow();
        !matches!(fb.surface, Surface::Plane(_)) && build::face_area_centroid(&fb).0 <= 1e-9
    }) {
        bail!();
    }
    ops::drop_degenerate_faces(&mut faces);
    ops::split_t_junctions(&mut faces);
    ops::weld_shared_edges(&mut faces);
    if faces.is_empty() {
        return Ok(None);
    }
    // Every edge is used by exactly two faces (a cylinder seam by the same
    // face twice), no exceptions.
    if ops::edge_use_counts(&faces).values().any(|&n| n != 2) || !ops::unmatched_once_edges(&faces).is_empty() {
        #[cfg(test)]
        if std::env::var("PLANAR_DEBUG").is_ok() {
            let counts = ops::edge_use_counts(&faces);
            for f in &faces {
                let fb = f.borrow();
                let kind = match &fb.surface {
                    Surface::Plane(p) => format!("plane n={:?} z={:.3}", p.n, p.origin[2]),
                    Surface::Cylinder(c) => format!("cyl r={} v=[{:.3},{:.3}] arc={:?}", c.radius, c.vmin, c.vmax, c.arc.as_ref().map(|a| (a.start, a.span))),
                    _ => "?".into(),
                };
                for w in &fb.boundary {
                    for u in &w.borrow().edges {
                        let key = Rc::as_ptr(&u.edge) as *const () as usize;
                        if counts[&key] != 2 {
                            let e = u.edge.borrow();
                            eprintln!("  [{kind}] edge x{}: a={:?} b={:?} {}", counts[&key], e.a.borrow().point, e.b.borrow().point, match &e.curve { Curve::Segment { .. } => "Seg".to_string(), Curve::Arc { sweep, radius, .. } => format!("Arc sweep={sweep:.4} r={radius}"), Curve::Circle { radius, .. } => format!("Circle r={radius}"), _ => "?".into() });
                        }
                    }
                }
            }
        }
        bail!();
    }
    let result = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    if !ops::volume_is_translation_invariant(&result) {
        bail!();
    }
    // `inside_solid` cannot read a trimmed cylinder, so a result that carries one is
    // checked against the OPERANDS only: every flat face must have different
    // membership of A - B just inside and just outside it.
    let sound = if crossings.is_empty() { ops::boolean_result_is_sound(op, a, b, &result) } else { ops::with_face_boxes(&[a, b, &result], || faces_bound_something(op, a, b, &result)) };
    if !sound {
        #[cfg(test)]
        if SKIP_SOUND.with(|c| c.get()) {
            return Ok(Some(result));
        }
        bail!();
    }
    Ok(Some(result))
}

fn faces_bound_something(op: &str, a: &TSolid, b: &TSolid, r: &TSolid) -> bool {
    const DELTA: f64 = 1e-4;
    let member = |q: Vec3| match op {
        "union" => ops::inside_solid(a, q) || ops::inside_solid(b, q),
        "intersect" => ops::inside_solid(a, q) && ops::inside_solid(b, q),
        _ => ops::inside_solid(a, q) && !ops::inside_solid(b, q),
    };
    for f in r.faces() {
        let samples = ops::planar_face_samples(&f);
        if samples.is_empty() {
            continue;
        }
        let all_equal = samples.iter().all(|&(p, n)| member(add(p, scale(n, DELTA))) == member(sub(p, scale(n, DELTA))));
        if all_equal {
            return false;
        }
    }
    true
}

fn volume_of(r: &Option<TSolid>) -> f64 {
    r.as_ref().map_or(0.0, build::solid_volume)
}

/// Union or intersect of two solid cylinders at right angles (S4e), either one the big one. Both
/// operations are built and must satisfy V(A+B) + V(A*B) = V(A) + V(B) to 1e-9: the partner this
/// configuration did not have for a bore. `None` when the pair is not such a crossing.
fn solid_crossing_boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<Outcome> {
    for swap in [false, true] {
        let (x, y) = if swap { (b, a) } else { (a, b) };
        let (mut px, mut py) = (extract(x)?, extract(y)?);
        let found = find_solid_crossings(&px, &py);
        if found.is_empty() {
            continue;
        }
        if found.len() != 1 {
            return Some(Outcome::Refused);
        }
        reframe(&mut px, &mut py, &found);
        if align_circles(&mut px).is_none() || align_circles(&mut py).is_none() {
            return Some(Outcome::Refused);
        }
        let with = |mode: Mode| -> Vec<Crossing> { found.iter().map(|c| Crossing { mode, ..c.clone() }).collect() };
        let (Ok(Some(u)), Ok(Some(i))) = (core("union", x, y, &px, &py, &with(Mode::Union)), core("intersect", x, y, &px, &py, &with(Mode::Intersect))) else {
            return Some(Outcome::Refused);
        };
        let want = build::solid_volume(a) + build::solid_volume(b);
        if (build::solid_volume(&u) + build::solid_volume(&i) - want).abs() > 1e-9 * want.abs().max(1.0) {
            return Some(Outcome::Refused);
        }
        return Some(Outcome::Built(if op == "union" { u } else { i }));
    }
    None
}


/// A subtract from a part that carries faces this module cannot model (a round, a chamfer's cone,
/// a sphere corner), when the tool never comes near them. The faces the tool's box does not
/// reach are carried through as copies; the rest must be planes and whole cylinders and go through
/// `core` as usual. Membership tests on the part count rays only along lines that miss every
/// face with an untrustworthy count (`ops::RAY_AVOID`), and every guard of the planar path still
/// applies to the welded whole. `None` means this is not the case (nothing to carry).
fn carry_subtract(a: &TSolid, b: &TSolid) -> Option<Outcome> {
    let mut pb = extract(b)?;
    // A sphere or cone TOOL is a revolved face (`AFace::Rev`) that only `boolean_planar_with` frames
    // (`rev_family` gives it its axis and its heights). Carried through here it keeps zlo = zhi = 0, so
    // the one band it builds has no height, an area of 0, and `drop_degenerate_faces` throws it away: a
    // ball sealed inside a rounded cylinder came back as the rounded cylinder with no void and an empty
    // refusals map (integration sweep of S4, perm#4862). This module cannot judge such a tool: no answer.
    if pb.iter().any(|f| matches!(f, AFace::Rev(_))) {
        return None;
    }
    let tb = build::solid_aabb(b);
    if tb.is_empty() {
        return None;
    }
    let copy = a.map_geom(&|c| c.clone(), &|s| s.clone());
    let (mut touched, mut carried): (Vec<TFace>, Vec<TFace>) = (Vec::new(), Vec::new());
    for f in copy.faces() {
        let meets = |r: &crate::math::Aabb| (0..3).all(|i| r.lo[i] <= tb.hi[i] + 1e-6 && r.hi[i] >= tb.lo[i] - 1e-6);
        let apart = if ops::unsafe_surface(&f) {
            ops::face_cover_boxes(&f).is_some_and(|bs| !bs.iter().any(meets))
        } else {
            ops::face_reach_box(&f).is_some_and(|r| !meets(&r))
        };
        if apart {
            carried.push(f);
        } else {
            touched.push(f);
        }
    }
    let refuse = |why: &'static str| {
        REASON.with(|r| r.set(Some(why)));
        Some(Outcome::Refused)
    };
    const CURVED: &str = "the cut reaches a rounded, chamfered or otherwise curved face of the part, which brep-rs cannot cut across yet; drill the part before you round or chamfer it, or keep the hole clear of the curved faces";
    if carried.is_empty() || touched.is_empty() {
        return None;
    }
    if touched.iter().any(ops::unsafe_surface) {
        return refuse(CURVED);
    }
    let part = TSolid { shells: vec![Rc::new(RefCell::new(Shell { faces: touched }))] };
    let Some(mut pa) = extract(&part) else {
        return refuse(CURVED);
    };
    let Some(avoid) = ops::unsafe_face_boxes(a) else {
        return refuse("brep-rs cannot tell where a curved face of the part lies, so it cannot check this cut");
    };
    if !find_crossings(&pa, &pb).is_empty() {
        return refuse("this cut crosses a bore wall of the part, which brep-rs cannot combine with the curved faces elsewhere on the part yet");
    }
    if align_circles(&mut pa).is_none() || align_circles(&mut pb).is_none() {
        return Some(Outcome::Refused);
    }
    struct Avoid;
    impl Drop for Avoid {
        fn drop(&mut self) {
            ops::RAY_AVOID.with(|v| v.borrow_mut().clear());
        }
    }
    ops::RAY_AVOID.with(|v| *v.borrow_mut() = avoid);
    ops::RAY_AVOID_FAILED.with(|f| f.set(false));
    let _guard = Avoid;
    let run = || -> Outcome {
        let Ok(Some(result)) = core_carry("subtract", a, b, &pa, &pb, &[], carried) else {
            return Outcome::Refused;
        };
        let Ok(other) = core("intersect", a, b, &pa, &pb, &[]) else {
            return Outcome::Refused;
        };
        let (va, vm, vo) = (build::solid_volume(a), build::solid_volume(&result), volume_of(&other));
        if (vm + vo - va).abs() > 1e-9 * va.abs().max(1.0) {
            return Outcome::Refused;
        }
        Outcome::Built(result)
    };
    let out = run();
    if ops::RAY_AVOID_FAILED.with(|f| f.get()) {
        return refuse("brep-rs cannot tell inside from outside of this part reliably near the cut, so it will not guess");
    }
    Some(out)
}

/// How many separate pieces the faces of `s` make, joined where they share an edge handle (the
/// weld has made every shared edge ONE handle, so this is exact for a result of this module).
fn face_components(s: &TSolid) -> usize {
    let faces = s.faces();
    let mut owner: HashMap<usize, usize> = HashMap::new();
    let mut parent: Vec<usize> = (0..faces.len()).collect();
    fn root(p: &mut Vec<usize>, mut x: usize) -> usize {
        while p[x] != x {
            p[x] = p[p[x]];
            x = p[x];
        }
        x
    }
    for (i, f) in faces.iter().enumerate() {
        for w in &f.borrow().boundary {
            for u in &w.borrow().edges {
                let k = Rc::as_ptr(&u.edge) as *const () as usize;
                match owner.get(&k) {
                    Some(&j) => {
                        let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                        parent[a] = b;
                    }
                    None => {
                        owner.insert(k, i);
                    }
                }
            }
        }
    }
    (0..faces.len()).filter(|&i| root(&mut parent, i) == i).count()
}

/// A result with more pieces than its operands could account for is not one solid: a cut that
/// strands a tip, or seals a void (a cavity belongs in its own shell, which this module does not
/// build). Refused, as the older path refuses the same shapes.
fn too_many_pieces(op: &str, a: &TSolid, b: &TSolid, r: &TSolid) -> bool {
    let allowed = match op {
        "union" => a.shells.len() + b.shells.len(),
        _ => a.shells.len(),
    };
    face_components(r) > allowed.max(1)
}

/// The planar boolean. Besides the structural guards, the answer must agree
/// with its partner operation by inclusion-exclusion
/// (V(A+B) + V(A*B) = V(A) + V(B); V(A-B) + V(A*B) = V(A)), which no
/// face-selection mistake survives unless it is made twice in step.
pub fn boolean_planar(op: &str, a: &TSolid, b: &TSolid) -> Outcome {
    if op == "subtract" && extract(a).is_none() {
        if let Some(out) = carry_subtract(a, b) {
            return out;
        }
    }
    let first = boolean_planar_with(op, a, b, None);
    if !matches!(first, Outcome::Refused) {
        return first;
    }
    // A part whose cone or sphere faces the coaxial path cannot place (a chamfered cylinder drilled
    // off its axis) still goes to the carry-through subtract, which keeps those faces untouched.
    // Only for a tool made of planes and cylinders: a cone or sphere TOOL is the coaxial path's own
    // business, and carrying faces through cannot judge it.
    if op == "subtract" && extract(b).is_some_and(|fs| !fs.iter().any(|f| matches!(f, AFace::Rev(_)))) {
        if let Some(out) = carry_subtract(a, b) {
            return out;
        }
    }
    // Whole spheres have no axis of their own: when the pair has nothing else to fix one, try the
    // axes its other faces suggest (a cylinder's, a plate's) before refusing.
    let (Some(pa), Some(pb)) = (extract(a), extract(b)) else {
        return first;
    };
    let only_balls = pa.iter().chain(pb.iter()).all(|f| match f {
        AFace::Rev(r) => matches!(&r.surf, Surface::Sphere(s) if s.v_range[0].abs() < 1e-9 && (s.v_range[1] - std::f64::consts::PI).abs() < 1e-9),
        _ => true,
    });
    if !only_balls || !pa.iter().chain(pb.iter()).any(|f| matches!(f, AFace::Rev(_))) {
        return first;
    }
    let mut hints: Vec<(Vec3, Vec3)> = Vec::new();
    // A cylinder's axis first (its circles start where its own frame says), then a plate's normal.
    for walls in [true, false] {
        for f in pa.iter().chain(pb.iter()) {
            let cand = match f {
                AFace::Cyl(c) if walls => Some((normalize(c.cyl.axis), normalize(c.cyl.e1))),
                AFace::Plane(p) if !walls => Some((normalize(p.plane.n), crate::geom::frame(p.plane.n).0)),
                _ => None,
            };
            if let Some((a, e1)) = cand {
                if !hints.iter().any(|h| len(cross(h.0, a)) < 1e-9) && hints.len() < 8 {
                    hints.push((a, e1));
                }
            }
        }
    }
    for h in hints {
        if let Outcome::Built(r) = boolean_planar_with(op, a, b, Some(h)) {
            return Outcome::Built(r);
        }
    }
    first
}

fn boolean_planar_with(op: &str, a: &TSolid, b: &TSolid, hint: Option<(Vec3, Vec3)>) -> Outcome {
    let (Some(mut pa), Some(mut pb)) = (extract(a), extract(b)) else {
        return Outcome::NotPlanar;
    };
    let Ok(fam) = rev_family(&mut pa, &mut pb, hint) else {
        return Outcome::Refused;
    };
    if let Some(fam) = &fam {
        // Spheres and cones are modelled only about one axis, with no crossing bores in the pair.
        if !find_crossings(&pa, &pb).is_empty() || !find_solid_crossings(&pa, &pb).is_empty() || !find_solid_crossings(&pb, &pa).is_empty() {
            return Outcome::Refused;
        }
        if align_family_circles(&mut pa, fam).is_none() || align_family_circles(&mut pb, fam).is_none() {
            return Outcome::Refused;
        }
    } else if op == "union" || op == "intersect" {
        if let Some(out) = solid_crossing_boolean(op, a, b) {
            return out;
        }
    }
    // A bore wall crossed by a second bore (subtract only).
    let crossings = if op == "subtract" && fam.is_none() { find_crossings(&pa, &pb) } else { Vec::new() };
    reframe(&mut pa, &mut pb, &crossings);
    if align_circles(&mut pa).is_none() || align_circles(&mut pb).is_none() {
        return Outcome::Refused;
    }
    if !crossings.is_empty() {
        // The inclusion-exclusion partner would need a third kind of trimmed face;
        // this configuration rests on closure, translation invariance, the
        // soundness probes and the numeric oracles in the tests instead.
        return match core(op, a, b, &pa, &pb, &crossings) {
            Ok(Some(r)) => Outcome::Built(r),
            _ => Outcome::Refused,
        };
    }
    let Ok(main) = core(op, a, b, &pa, &pb, &crossings) else {
        return Outcome::Refused;
    };
    let Some(result) = main else {
        return Outcome::Refused;
    };
    if fam.is_some() && too_many_pieces(op, a, b, &result) {
        return Outcome::Refused;
    }
    let partner = if op == "union" { "intersect" } else if op == "intersect" { "union" } else { "intersect" };
    let Ok(other) = core(partner, a, b, &pa, &pb, &crossings) else {
        return Outcome::Refused;
    };
    let (va, vb) = (build::solid_volume(a), build::solid_volume(b));
    let (vm, vo) = (build::solid_volume(&result), volume_of(&other));
    let want = match op {
        "subtract" => va,
        _ => va + vb,
    };
    if (vm + vo - want).abs() > 1e-9 * want.abs().max(1.0) {
        return Outcome::Refused;
    }
    Outcome::Built(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(size: Vec3, c: Vec3) -> TSolid {
        build::box_solid(size, c, None)
    }

    fn vol(s: &TSolid) -> f64 {
        build::solid_volume(s)
    }

    fn sub_op(a: &TSolid, b: &TSolid) -> TSolid {
        ops::boolean("subtract", a, b).expect("subtract builds")
    }

    fn built(op: &str, a: &TSolid, b: &TSolid) -> TSolid {
        match boolean_planar(op, a, b) {
            Outcome::Built(r) => r,
            Outcome::Refused => panic!("{op} refused"),
            Outcome::NotPlanar => panic!("{op} not planar"),
        }
    }

    // Hollow box: 40x40x20, wall 2 -> 36x36x16 cavity.
    fn hollow() -> TSolid {
        sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 16.0], [0.0; 3]))
    }

    fn half_cutter() -> TSolid {
        bx([60.0, 30.0, 40.0], [0.0, 15.0, 0.0])
    }

    #[test]
    fn hollow_box_cut_in_half_is_exactly_half() {
        let h = hollow();
        assert!((vol(&h) - 11264.0).abs() < 1e-6);
        let r = built("subtract", &h, &half_cutter());
        assert!((vol(&r) - 5632.0).abs() < 1e-6, "got {}", vol(&r));
        // Through the public entry point too.
        let r2 = ops::boolean("subtract", &h, &half_cutter()).expect("boolean builds");
        assert!((vol(&r2) - 5632.0).abs() < 1e-6);
    }

    #[test]
    fn open_cup_half_and_notch() {
        // Inner box pokes out of the top, so the cup is open.
        let cup = sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 20.0], [0.0, 0.0, 2.0]));
        assert!((vol(&cup) - 8672.0).abs() < 1e-6, "cup {}", vol(&cup));
        let half = built("subtract", &cup, &half_cutter());
        assert!((vol(&half) - 4336.0).abs() < 1e-6, "half {}", vol(&half));
        let notch = built("subtract", &cup, &bx([10.0, 10.0, 6.0], [20.0, 0.0, 0.0]));
        assert!((vol(&notch) - 8552.0).abs() < 1e-6, "notch {}", vol(&notch));
    }

    #[test]
    fn pocket_and_through_hole_half() {
        let base = bx([40.0, 40.0, 20.0], [0.0; 3]);
        let pocket = sub_op(&base, &bx([10.0, 10.0, 8.0], [0.0, 0.0, 6.0]));
        assert!((vol(&pocket) - 31200.0).abs() < 1e-6);
        let r = built("subtract", &pocket, &half_cutter());
        assert!((vol(&r) - 15600.0).abs() < 1e-6, "pocket half {}", vol(&r));
        let thru = sub_op(&base, &bx([10.0, 10.0, 30.0], [0.0; 3]));
        assert!((vol(&thru) - 30000.0).abs() < 1e-6);
        let r = built("subtract", &thru, &half_cutter());
        assert!((vol(&r) - 15000.0).abs() < 1e-6, "through half {}", vol(&r));
    }

    pub(super) struct Lcg(pub(super) u64);
    impl Lcg {
        pub(super) fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as f64) / ((1u64 << 31) as f64)
        }
    }

    fn overlap(sa: Vec3, ca: Vec3, sb: Vec3, cb: Vec3) -> f64 {
        (0..3)
            .map(|k| ((ca[k] + sa[k] / 2.0).min(cb[k] + sb[k] / 2.0) - (ca[k] - sa[k] / 2.0).max(cb[k] - sb[k] / 2.0)).max(0.0))
            .product()
    }

    /// Box pairs against the closed form. A refusal is allowed (and counted);
    /// a built solid with the wrong volume never is.
    fn sweep(seed: u64, n: usize, grid: bool) -> (usize, usize) {
        let mut r = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for _ in 0..n {
            let mut pick = |lo: f64, hi: f64| {
                let x = lo + (hi - lo) * r.next();
                if grid { x.round() } else { x }
            };
            let sa = [pick(2.0, 8.0), pick(2.0, 8.0), pick(2.0, 8.0)];
            let sb = [pick(2.0, 8.0), pick(2.0, 8.0), pick(2.0, 8.0)];
            let ca = [pick(-6.0, 6.0), pick(-6.0, 6.0), pick(-6.0, 6.0)];
            let cb = [pick(-6.0, 6.0), pick(-6.0, 6.0), pick(-6.0, 6.0)];
            let (va, vb) = (sa[0] * sa[1] * sa[2], sb[0] * sb[1] * sb[2]);
            let vi = overlap(sa, ca, sb, cb);
            let a = bx(sa, ca);
            let b = bx(sb, cb);
            for (op, want) in [("union", va + vb - vi), ("subtract", va - vi), ("intersect", vi)] {
                match boolean_planar(op, &a, &b) {
                    Outcome::Built(res) => {
                        built_n += 1;
                        assert!((vol(&res) - want).abs() < 1e-7, "{op} wrong: {} vs {want}, a={sa:?}@{ca:?} b={sb:?}@{cb:?}", vol(&res));
                    }
                    Outcome::Refused => {
                        refused_n += 1;
                        let kind = if vi <= 0.0 { "disjoint" } else if (vi - va).abs() < 1e-9 { "a-inside-b" } else if (vi - vb).abs() < 1e-9 { "b-inside-a" } else { "overlap" };
                        let _ = (kind, want);
                    }
                    Outcome::NotPlanar => panic!("boxes are planar"),
                }
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn random_box_pairs_match_the_closed_form() {
        // Refusals are legitimate only for an EMPTY result (nothing to build);
        // sweep() prints each one, and for generic position there must be none
        // with a non-empty answer.
        let (b, r) = sweep(7, 500, false);
        let empties = 374; // intersect of disjoint boxes, measured
        eprintln!("generic: built {b}, refused {r}");
        assert_eq!(b + r, 1500);
        assert!(r <= empties, "a non-empty answer was refused: {r} refusals");
    }

    #[test]
    fn grid_aligned_box_pairs_never_build_a_wrong_volume() {
        let (b, r) = sweep(11, 500, true);
        eprintln!("grid: built {b}, refused {r}");
    }

    #[test]
    fn results_mesh_watertight_with_the_volume_of_the_closed_form() {
        let cup = sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 20.0], [0.0, 0.0, 2.0]));
        for (r, want) in [
            (built("subtract", &hollow(), &half_cutter()), 5632.0),
            (built("subtract", &cup, &half_cutter()), 4336.0),
            (built("subtract", &cup, &bx([10.0, 10.0, 6.0], [20.0, 0.0, 0.0])), 8552.0),
        ] {
            let m = crate::mesh::mesh_solid(&r, 0.05).expect("meshes");
            assert!(ops::check_watertight(&m), "mesh of the {want} solid is not watertight");
            // Signed volume of the triangles equals the closed form.
            let mut v = 0.0;
            for t in m.indices.chunks(3) {
                let p = |k: u32| m.positions[k as usize];
                let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
                v += dot(a, cross(b, c)) / 6.0;
            }
            assert!((v - want).abs() < 1e-3, "mesh volume {v} vs {want}");
        }
    }

    // ---- S2: parts with round holes -------------------------------------------------------
    fn bored(r: f64, floor_z: Option<f64>) -> TSolid {
        bored_at(r, floor_z, 0.0, 0.0)
    }

    fn bored_at(r: f64, floor_z: Option<f64>, cx: f64, cy: f64) -> TSolid {
        let base = bx([40.0, 40.0, 20.0], [0.0; 3]);
        let tool = match floor_z {
            None => build::cylinder_solid([cx, cy, 0.0], r, 30.0, [0.0, 0.0, 1.0]),
            Some(z) => build::cylinder_solid([cx, cy, (z + 10.0) / 2.0 + 0.0], r, 10.0 - z, [0.0, 0.0, 1.0]),
        };
        sub_op(&base, &tool)
    }

    /// Area of the disk of radius r left of x = a.
    fn disk_left(r: f64, a: f64) -> f64 {
        std::f64::consts::PI * r * r - (r * r * (a / r).acos() - a * (r * r - a * a).sqrt())
    }

    #[test]
    fn through_bore_cut_by_planes_parallel_to_the_axis() {
        let r = 6.0;
        let part = bored(r, None);
        let whole = 32000.0 - std::f64::consts::PI * r * r * 20.0;
        assert!((vol(&part) - whole).abs() < 1e-6);
        // Through the axis: exactly half.
        let half = built("subtract", &part, &half_cutter());
        assert!((vol(&half) - whole / 2.0).abs() < 1e-6, "half {}", vol(&half));
        // Off the axis: remove x > a.
        for a in [-5.0, -2.5, 0.0, 3.0, 4.5] {
            let cutter = bx([60.0, 60.0, 40.0], [a + 30.0, 0.0, 0.0]);
            let got = built("subtract", &part, &cutter);
            let want = (a + 20.0) * 40.0 * 20.0 - disk_left(r, a) * 20.0;
            assert!((vol(&got) - want).abs() < 1e-6, "a={a}: {} vs {want}", vol(&got));
        }
        // A cutter that misses the hole entirely leaves it untouched.
        let far = built("subtract", &part, &bx([10.0, 60.0, 40.0], [15.0, 0.0, 0.0]));
        assert!((vol(&far) - (whole - 10.0 * 40.0 * 20.0)).abs() < 1e-6, "far {}", vol(&far));
    }

    #[test]
    fn bored_box_cut_square_to_the_axis() {
        let r = 6.0;
        let part = bored(r, None);
        let whole = 32000.0 - std::f64::consts::PI * r * r * 20.0;
        // Everything above z = 0 removed: half the part, the bore half as tall.
        let low = built("subtract", &part, &bx([60.0, 60.0, 20.0], [0.0, 0.0, 10.0]));
        assert!((vol(&low) - whole / 2.0).abs() < 1e-6, "low {}", vol(&low));
        // Above z = 4: a bore wall 14 tall remains.
        let cut4 = built("subtract", &part, &bx([60.0, 60.0, 20.0], [0.0, 0.0, 14.0]));
        assert!((vol(&cut4) - (40.0 * 40.0 * 14.0 - std::f64::consts::PI * r * r * 14.0)).abs() < 1e-6, "cut4 {}", vol(&cut4));
    }

    #[test]
    fn blind_bore_cut_both_ways() {
        let r = 6.0;
        // Floor at z = 2, so the bore is 8 deep.
        let part = bored(r, Some(2.0));
        let whole = 32000.0 - std::f64::consts::PI * r * r * 8.0;
        assert!((vol(&part) - whole).abs() < 1e-6, "{}", vol(&part));
        let half = built("subtract", &part, &half_cutter());
        assert!((vol(&half) - whole / 2.0).abs() < 1e-6, "half {}", vol(&half));
        // Cut above z = 0: the bore is gone, a plain half box.
        let low = built("subtract", &part, &bx([60.0, 60.0, 20.0], [0.0, 0.0, 10.0]));
        assert!((vol(&low) - 16000.0).abs() < 1e-6, "low {}", vol(&low));
        // Cut above z = 6: a bore from 2 to 6 remains.
        let up = built("subtract", &part, &bx([60.0, 60.0, 20.0], [0.0, 0.0, 16.0]));
        assert!((vol(&up) - (40.0 * 40.0 * 16.0 - std::f64::consts::PI * r * r * 4.0)).abs() < 1e-6, "up {}", vol(&up));
    }

    #[test]
    fn a_cut_that_covers_only_part_of_the_wall_builds_exactly() {
        let pi = std::f64::consts::PI;
        let part = bored(6.0, None);
        let whole = 32000.0 - pi * 36.0 * 20.0;
        // A cutter 6 tall in z reaches only part of the 20 tall bore wall: it removes the
        // y > 0 box slab (20 x 40 x 6) less the half bore inside it (pi r^2 / 2 x 6).
        let mid = built("subtract", &part, &bx([60.0, 30.0, 6.0], [0.0, 15.0, 0.0]));
        assert!((vol(&mid) - (whole - (20.0 * 40.0 * 6.0 - pi * 36.0 / 2.0 * 6.0))).abs() < 1e-6, "mid {}", vol(&mid));
        // Reaching the top rim: z in [2, 10] is 8 tall.
        let top = built("subtract", &part, &bx([60.0, 30.0, 8.0], [0.0, 15.0, 6.0]));
        assert!((vol(&top) - (whole - (20.0 * 40.0 * 8.0 - pi * 36.0 / 2.0 * 8.0))).abs() < 1e-6, "top {}", vol(&top));
        for r in [&mid, &top] {
            let m = crate::mesh::mesh_solid(r, 0.05).expect("meshes");
            assert!(ops::check_watertight(&m));
        }
        // A cutter box sunk in the middle of the wall on one side only (x in [0, 30], y in [0, 30], z in [-3, 3]).
        let corner = built("subtract", &part, &bx([30.0, 30.0, 6.0], [15.0, 15.0, 0.0]));
        let want = whole - (cyl_free_box(20.0, 20.0, 6.0) - pi * 36.0 / 4.0 * 6.0);
        assert!((vol(&corner) - want).abs() < 1e-6, "corner {} vs {want}", vol(&corner));
    }

    /// Volume of the part of a 20-deep box corner quadrant [0,a] x [0,b] x h inside the 40 x 40 plate.
    fn cyl_free_box(a: f64, b: f64, h: f64) -> f64 {
        a * b * h
    }

    #[test]
    fn bored_results_mesh_watertight() {
        let part = bored(6.0, None);
        let r = built("subtract", &part, &half_cutter());
        let m = crate::mesh::mesh_solid(&r, 0.05).expect("meshes");
        assert!(ops::check_watertight(&m));
    }

    /// Area of the disk (centre (cx, cy), radius r) inside the rectangle
    /// [x0,x1] x [y0,y1]: exact, by integrating the chord overlap piecewise
    /// with the antiderivative of the half-chord sqrt(r^2 - x^2).
    fn disk_rect(cx: f64, cy: f64, r: f64, x0: f64, x1: f64, y0: f64, y1: f64) -> f64 {
        let (xa, xb) = ((x0 - cx).max(-r), (x1 - cx).min(r));
        if xb <= xa {
            return 0.0;
        }
        let (ya, yb) = (y0 - cy, y1 - cy);
        let g = |x: f64| 0.5 * (x * (r * r - x * x).max(0.0).sqrt() + r * r * (x / r).clamp(-1.0, 1.0).asin());
        let mut xs = vec![xa, xb];
        for y in [ya, yb] {
            if y.abs() < r {
                let x = (r * r - y * y).sqrt();
                for q in [-x, x] {
                    if q > xa && q < xb {
                        xs.push(q);
                    }
                }
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut area = 0.0;
        for w in xs.windows(2) {
            let m = 0.5 * (w[0] + w[1]);
            let h = (r * r - m * m).max(0.0).sqrt();
            // hi = min(h, yb), lo = max(-h, ya), each either the chord or a constant.
            let (hi_is_chord, lo_is_chord) = (h <= yb, -h >= ya);
            let width = w[1] - w[0];
            let mut seg = 0.0;
            seg += if hi_is_chord { g(w[1]) - g(w[0]) } else { yb * width };
            seg -= if lo_is_chord { -(g(w[1]) - g(w[0])) } else { ya * width };
            if (hi_is_chord && lo_is_chord) || h.min(yb) > (-h).max(ya) {
                area += seg;
            }
        }
        area
    }

    /// Volume of a vertical cylinder (radius r at (cx,cy), z in [z0,z1]) inside a box.
    fn cyl_in_box(cx: f64, cy: f64, r: f64, z0: f64, z1: f64, size: Vec3, c: Vec3) -> f64 {
        let dz = ((c[2] + size[2] / 2.0).min(z1) - (c[2] - size[2] / 2.0).max(z0)).max(0.0);
        dz * disk_rect(cx, cy, r, c[0] - size[0] / 2.0, c[0] + size[0] / 2.0, c[1] - size[1] / 2.0, c[1] + size[1] / 2.0)
    }

    #[test]
    fn disk_rect_oracle_is_right() {
        let pi = std::f64::consts::PI;
        assert!((disk_rect(0.0, 0.0, 6.0, -100.0, 100.0, -100.0, 100.0) - pi * 36.0).abs() < 1e-9);
        assert!((disk_rect(0.0, 0.0, 6.0, 0.0, 100.0, -100.0, 100.0) - pi * 18.0).abs() < 1e-9);
        assert!((disk_rect(0.0, 0.0, 6.0, 0.0, 100.0, 0.0, 100.0) - pi * 9.0).abs() < 1e-9);
        assert!((disk_rect(0.0, 0.0, 6.0, -3.0, 3.0, -3.0, 3.0) - 36.0).abs() < 1e-9); // the whole square lies inside the disk
        assert!((disk_rect(1.0, 2.0, 1.0, 0.0, 2.0, 1.0, 3.0) - pi).abs() < 1e-9);
    }

    /// A bored box cut by random axis-aligned boxes, against the closed form. With
    /// `tall` the cutter spans the whole part in z, so every wall cut runs the
    /// wall's full length and nothing legitimate should refuse.
    fn bore_sweep(seed: u64, n: usize, tall: bool, off_centre: bool) -> (usize, usize) {
        let mut r = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for _ in 0..n {
            let rad = 3.0 + 6.0 * r.next();
            let blind = r.next() < 0.5;
            let floor = -10.0 + 4.0 + 12.0 * r.next();
            let reach = 19.0 - rad;
            let (cx, cy) = if off_centre { (reach * (2.0 * r.next() - 1.0), reach * (2.0 * r.next() - 1.0)) } else { (0.0, 0.0) };
            let part = bored_at(rad, if blind { Some(floor) } else { None }, cx, cy);
            let (z0, z1) = if blind { (floor, 10.0) } else { (-10.0, 10.0) };
            let size = [4.0 + 36.0 * r.next(), 4.0 + 36.0 * r.next(), if tall { 40.0 } else { 3.0 + 25.0 * r.next() }];
            let c = [-22.0 + 44.0 * r.next(), -22.0 + 44.0 * r.next(), if tall { 0.0 } else { -12.0 + 24.0 * r.next() }];
            let cutter = bx(size, c);
            let box_vol = overlap([40.0, 40.0, 20.0], [0.0; 3], size, c);
            let bore_all = std::f64::consts::PI * rad * rad * (z1 - z0);
            let bore_cut = cyl_in_box(cx, cy, rad, z0, z1, size, c);
            // (box minus bore) minus cutter = box - cutter - (bore - bore_in_cutter) (bore lies inside the box)
            let want = 32000.0 - box_vol - (bore_all - bore_cut);
            match boolean_planar("subtract", &part, &cutter) {
                Outcome::Built(res) => {
                    built_n += 1;
                    assert!((vol(&res) - want).abs() < 1e-6, "WRONG {} vs {want}: rad={rad} blind={blind} floor={floor} cutter={size:?}@{c:?}", vol(&res));
                    if built_n % 7 == 0 {
                        let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
                        assert!(ops::check_watertight(&m), "not watertight: rad={rad} blind={blind} floor={floor} cutter={size:?}@{c:?}");
                    }
                }
                Outcome::Refused => {
                    refused_n += 1;
                    eprintln!("SWEEP REFUSED rad={rad} blind={blind} floor={floor} centre=({cx},{cy}) cutter={size:?}@{c:?}");
                }
                Outcome::NotPlanar => panic!("planes and a cylinder are in scope"),
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn bored_box_random_cutters_that_span_the_part() {
        let (b, r) = bore_sweep(21, 300, true, false);
        eprintln!("tall cutters: built {b}, refused {r}");
        assert_eq!((b, r), (300, 0));
    }

    #[test]
    fn off_centre_bores_random_cutters_never_wrong() {
        let (b, r) = bore_sweep(57, 400, false, true);
        eprintln!("off-centre bores: built {b}, refused {r}");
        assert_eq!(b + r, 400);
        assert!(r * 10 <= b, "too many refusals: {r} of {}", b + r);
    }

    #[test]
    fn bored_box_random_cutters_never_wrong() {
        let (b, r) = bore_sweep(33, 400, false, false);
        eprintln!("random cutters: built {b}, refused {r}");
        assert_eq!((b, r), (400, 0));
    }

    // ---- S3b: a second bore crossing the first ---------------------------------------------
    /// Volume shared by two perpendicular cylinders whose axes meet (R > r): the integral over
    /// y of the cross-section 4 sqrt(R^2 - y^2) sqrt(r^2 - y^2), by Simpson's rule on y = r sin t
    /// (smooth in t), the same oracle transverse-bore.test.mjs uses.
    fn steinmetz(big_r: f64, r: f64) -> f64 {
        let n = 200_000;
        let h = std::f64::consts::FRAC_PI_2 / n as f64;
        let f = |t: f64| {
            let y = r * t.sin();
            4.0 * (big_r * big_r - y * y).sqrt() * (r * r - y * y).max(0.0).sqrt() * r * t.cos()
        };
        let mut sum = f(0.0) + f(std::f64::consts::FRAC_PI_2);
        for i in 1..n {
            sum += f(i as f64 * h) * if i % 2 == 1 { 4.0 } else { 2.0 };
        }
        2.0 * sum * h / 3.0
    }

    fn side_tool(r: f64, axis: Vec3, centre: Vec3, len: f64) -> TSolid {
        build::cylinder_solid(centre, r, len, axis)
    }

    #[test]
    fn a_side_bore_through_a_through_bore_is_exact() {
        let pi = std::f64::consts::PI;
        let big_r = 6.0;
        let part = bored(big_r, None);
        let a0 = vol(&part);
        for (r, axis, off) in [(2.0, [1.0, 0.0, 0.0], 0.0), (3.0, [1.0, 0.0, 0.0], 0.0), (5.0, [1.0, 0.0, 0.0], 0.0), (2.0, [0.0, 1.0, 0.0], 0.0), (3.0, [1.0, 0.0, 0.0], 2.5), (1.0, [1.0, 0.0, 0.0], -6.0)] {
            // a tool 50 long, centred at height `off`, runs through the whole 40 wide block
            let centre = if axis[0] == 1.0 { [0.0, 0.0, off] } else { [0.0, 0.0, off] };
            let tool = side_tool(r, axis, centre, 50.0);
            SKIP_SOUND.with(|c| c.set(std::env::var("SKIP_SOUND").is_ok()));
            let got = match boolean_planar("subtract", &part, &tool) {
                Outcome::Built(x) => x,
                Outcome::Refused => panic!("refused r={r} axis={axis:?} off={off}"),
                Outcome::NotPlanar => panic!("not planar"),
            };
            let removed = pi * r * r * 40.0 - steinmetz(big_r, r);
            assert!((vol(&got) - (a0 - removed)).abs() < 1e-6, "r={r} axis={axis:?} off={off}: {} vs {}", vol(&got), a0 - removed);
        }
    }

    #[test]
    fn crossing_bores_mesh_watertight_with_the_exact_volume() {
        let part = bored(6.0, None);
        for (r, axis) in [(2.0, [1.0, 0.0, 0.0]), (4.0, [0.0, 1.0, 0.0]), (5.5, [1.0, 0.0, 0.0])] {
            let tool = side_tool(r, axis, [0.0, 0.0, 0.0], 50.0);
            let Outcome::Built(res) = boolean_planar("subtract", &part, &tool) else { panic!("refused r={r}") };
            let m = crate::mesh::mesh_solid(&res, 0.02).unwrap_or_else(|| panic!("no mesh r={r}"));
            assert!(ops::check_watertight(&m), "not watertight r={r}");
            let mut v = 0.0;
            for t in m.indices.chunks(3) {
                let (a, b, c) = (m.positions[t[0] as usize], m.positions[t[1] as usize], m.positions[t[2] as usize]);
                v += dot(a, cross(b, c)) / 6.0;
            }
            let exact = vol(&res);
            // a chord-tolerance polyhedron under-estimates a convex-curved boundary by a few parts per thousand
            assert!(v > 0.0 && (v - exact).abs() < 4e-3 * exact, "r={r}: mesh volume {v} vs exact {exact}");
        }
    }


    /// Random crossing bores against the numeric oracle: through or blind first bore at a random
    /// place, a narrower side bore (axis x or y) through its axis at a random height.
    fn crossing_sweep(seed: u64, n: usize) -> (usize, usize) {
        let pi = std::f64::consts::PI;
        let mut r = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for _ in 0..n {
            let big_r = 3.0 + 6.0 * r.next();
            let small = (0.15 + 0.7 * r.next()) * big_r;
            let blind = r.next() < 0.5;
            let floor = -6.0 + 6.0 * r.next();
            let reach = 19.0 - big_r;
            let (cx, cy) = (reach * (2.0 * r.next() - 1.0), reach * (2.0 * r.next() - 1.0));
            let lo = if blind { floor } else { -10.0 };
            // the side bore must clear the floor and the top, and stay inside the block
            let (c_lo, c_hi) = (lo + small + 0.3, 10.0 - small - 0.3);
            if c_hi <= c_lo {
                continue;
            }
            let cz = c_lo + (c_hi - c_lo) * r.next();
            let along_x = r.next() < 0.5;
            let part = bored_at(big_r, if blind { Some(floor) } else { None }, cx, cy);
            let (axis, centre) = if along_x { ([1.0, 0.0, 0.0], [0.0, cy, cz]) } else { ([0.0, 1.0, 0.0], [cx, 0.0, cz]) };
            let tool = side_tool(small, axis, centre, 50.0);
            let removed = pi * small * small * 40.0 - steinmetz(big_r, small);
            let want = vol(&part) - removed;
            match boolean_planar("subtract", &part, &tool) {
                Outcome::Built(res) => {
                    built_n += 1;
                    assert!((vol(&res) - want).abs() < 1e-6, "WRONG {} vs {want}: R={big_r} r={small} blind={blind} floor={floor} c=({cx},{cy}) cz={cz} x={along_x}", vol(&res));
                    if built_n % 5 == 0 {
                        let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
                        assert!(ops::check_watertight(&m), "not watertight: R={big_r} r={small} blind={blind} floor={floor} c=({cx},{cy}) cz={cz} x={along_x}");
                    }
                }
                Outcome::Refused => {
                    refused_n += 1;
                    eprintln!("CROSS REFUSED R={big_r} r={small} blind={blind} floor={floor} c=({cx},{cy}) cz={cz} x={along_x}");
                }
                Outcome::NotPlanar => panic!("planes and cylinders are in scope"),
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn random_crossing_bores_match_the_numeric_oracle() {
        let (b, r) = crossing_sweep(91, 300);
        eprintln!("crossing bores: built {b}, refused {r}");
        assert!(b > 200 && r * 20 <= b, "built {b}, refused {r}");
    }

    // ---- S3b-1: two holes with parallel axes that overlap ------------------------------------
    /// Area shared by two disks of radii r1, r2 whose centres are d apart.
    fn lens(r1: f64, r2: f64, d: f64) -> f64 {
        if d >= r1 + r2 {
            return 0.0;
        }
        if d <= (r1 - r2).abs() {
            return std::f64::consts::PI * r1.min(r2).powi(2);
        }
        let a1 = ((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1)).clamp(-1.0, 1.0).acos();
        let a2 = ((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2)).clamp(-1.0, 1.0).acos();
        r1 * r1 * a1 + r2 * r2 * a2 - 0.5 * ((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)).max(0.0).sqrt()
    }

    fn z_tool(r: f64, cx: f64, cy: f64, zlo: f64, zhi: f64) -> TSolid {
        build::cylinder_solid([cx, cy, 0.5 * (zlo + zhi)], r, zhi - zlo, [0.0, 0.0, 1.0])
    }

    #[test]
    fn two_overlapping_through_holes_make_a_slot_exactly() {
        let pi = std::f64::consts::PI;
        let part = bored(5.0, None);
        for (r, d) in [(3.0, 4.0), (5.0, 5.0), (2.0, 6.5), (6.0, 3.0), (4.0, 8.0)] {
            let tool = z_tool(r, d, 0.0, -12.0, 12.0);
            let Outcome::Built(res) = boolean_planar("subtract", &part, &tool) else { panic!("refused r={r} d={d}") };
            let want = vol(&part) - (pi * r * r - lens(5.0, r, d)) * 20.0;
            assert!((vol(&res) - want).abs() < 1e-6, "r={r} d={d}: {} vs {want}", vol(&res));
            let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
            assert!(ops::check_watertight(&m), "r={r} d={d}");
        }
    }

    #[test]
    fn a_wider_coaxial_counterbore_is_exact() {
        let pi = std::f64::consts::PI;
        let part = bored(4.0, None);
        // r = 7 from the top, 6 deep (z 4..10): removes the annulus between the bore and the counterbore.
        let Outcome::Built(res) = boolean_planar("subtract", &part, &z_tool(7.0, 0.0, 0.0, 4.0, 12.0)) else { panic!("refused") };
        assert!((vol(&res) - (vol(&part) - pi * (49.0 - 16.0) * 6.0)).abs() < 1e-6, "{}", vol(&res));
    }

    /// Random pairs of parallel holes (through or blind, either one) against the lens oracle.
    fn parallel_sweep(seed: u64, n: usize) -> (usize, usize) {
        let pi = std::f64::consts::PI;
        let mut rng = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for _ in 0..n {
            let big = 3.0 + 4.0 * rng.next();
            let small = 2.0 + 5.0 * rng.next();
            let (lo, hi) = ((big - small).abs() + 0.4, big + small - 0.4);
            if hi <= lo {
                continue;
            }
            let d = lo + (hi - lo) * rng.next();
            let phi = std::f64::consts::TAU * rng.next();
            let (cx, cy) = (-3.0 + 6.0 * rng.next(), -3.0 + 6.0 * rng.next());
            let (tx, ty) = (cx + d * phi.cos(), cy + d * phi.sin());
            if tx.abs() + small > 19.0 || ty.abs() + small > 19.0 || cx.abs() + big > 19.0 || cy.abs() + big > 19.0 {
                continue;
            }
            let w_blind = rng.next() < 0.5;
            let wfloor = -9.0 + 17.0 * rng.next();
            let t_blind = rng.next() < 0.5;
            let tfloor = -9.0 + 17.0 * rng.next();
            let part = bored_at(big, if w_blind { Some(wfloor) } else { None }, cx, cy);
            let (wlo, thlo) = (if w_blind { wfloor } else { -10.0 }, if t_blind { tfloor } else { -12.0 });
            let tool = z_tool(small, tx, ty, thlo, 12.0);
            let t_in_box = 10.0 - thlo.max(-10.0);
            let shared = (10.0 - wlo.max(thlo)).max(0.0);
            let want = vol(&part) - (pi * small * small * t_in_box - lens(big, small, d) * shared);
            match boolean_planar("subtract", &part, &tool) {
                Outcome::Built(res) => {
                    built_n += 1;
                    assert!((vol(&res) - want).abs() < 1e-6, "WRONG {} vs {want}: R={big} r={small} d={d} w_blind={w_blind}/{wfloor} t_blind={t_blind}/{tfloor}", vol(&res));
                    if built_n % 5 == 0 {
                        let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
                        assert!(ops::check_watertight(&m), "not watertight: R={big} r={small} d={d} w_blind={w_blind}/{wfloor} t_blind={t_blind}/{tfloor}");
                    }
                }
                Outcome::Refused => {
                    refused_n += 1;
                    eprintln!("PARALLEL REFUSED R={big} r={small} d={d} w_blind={w_blind}/{wfloor} t_blind={t_blind}/{tfloor}");
                }
                Outcome::NotPlanar => panic!("planes and cylinders are in scope"),
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn random_parallel_holes_match_the_lens_oracle() {
        let (b, r) = parallel_sweep(123, 400);
        eprintln!("parallel holes: built {b}, refused {r}");
        assert!(b > 200 && r * 20 <= b, "built {b}, refused {r}");
    }

    #[test]
    /// A flipped wall piece has a NEGATIVE start angle; `inside_solid` used to take the angle
    /// relative to it without reducing it, and called points inside the piece outside it.
    fn inside_solid_reads_a_result_whose_wall_pieces_were_flipped() {
        let part = bored(5.0, None);
        let Outcome::Built(res) = boolean_planar("subtract", &part, &z_tool(3.0, 4.0, 0.0, 0.0, 12.0)) else { panic!("refused") };
        let truth = |p: Vec3| {
            let in_box = p[0].abs() < 20.0 && p[1].abs() < 20.0 && p[2].abs() < 10.0;
            let in_bore = p[0] * p[0] + p[1] * p[1] < 25.0;
            let in_tool = (p[0] - 4.0).powi(2) + p[1] * p[1] < 9.0 && p[2] > 0.0 && p[2] < 12.0;
            in_box && !in_bore && !in_tool
        };
        let mut rng = Lcg(5);
        let mut bad = Vec::new();
        for _ in 0..4000 {
            let p = [-9.0 + 18.0 * rng.next(), -9.0 + 18.0 * rng.next(), -10.5 + 21.0 * rng.next()];
            if ops::inside_solid(&res, p) != truth(p) {
                bad.push(p);
            }
        }
        assert!(bad.is_empty(), "{} of 4000 points misread, e.g. {:?}", bad.len(), bad.iter().take(3).collect::<Vec<_>>());
    }


    /// Smoke sweep over the WHOLE boolean (older path first): random boxes and vertical
    /// cylinders under all three operations; any solid it returns must mesh watertight with a
    /// positive volume. Catches a path that used to refuse only by accident.
    #[test]
    fn random_box_and_cylinder_booleans_never_return_an_open_solid() {
        let mut rng = Lcg(2024);
        let mut built = 0;
        for _ in 0..300 {
            let mut desc = String::new();
            let mut shape = |rng: &mut Lcg| -> TSolid {
                let c = [-6.0 + 12.0 * rng.next(), -6.0 + 12.0 * rng.next(), -4.0 + 8.0 * rng.next()];
                if rng.next() < 0.5 {
                    let sz = [4.0 + 14.0 * rng.next(), 4.0 + 14.0 * rng.next(), 4.0 + 10.0 * rng.next()];
                    desc += &format!(" box{sz:?}@{c:?}");
                    bx(sz, c)
                } else {
                    let (r, h) = (2.0 + 6.0 * rng.next(), 4.0 + 12.0 * rng.next());
                    desc += &format!(" cyl r={r} h={h} @{c:?}");
                    build::cylinder_solid(c, r, h, [0.0, 0.0, 1.0])
                }
            };
            let (a, b) = (shape(&mut rng), shape(&mut rng));
            for op in ["union", "subtract", "intersect"] {
                if let Some(r) = ops::boolean(op, &a, &b) {
                    built += 1;
                    assert!(vol(&r) > 0.0, "{op}: non-positive volume");
                    if let Some(m) = crate::mesh::mesh_solid(&r, 0.05) {
                        let planar = matches!(boolean_planar(op, &a, &b), Outcome::Built(_));
                        assert!(ops::check_watertight(&m), "{op}: an open solid was returned (planar path built it: {planar}){desc}");
                    }
                }
            }
        }
        eprintln!("legacy smoke: {built} solids returned, all watertight");
        assert!(built > 300);
    }

    /// The dispatcher (older path first) on random box pairs: every solid it returns has the closed-form
    /// volume and a WATERTIGHT mesh. The older path alone left a vertex in the middle of a neighbour's
    /// edge in about 78% of overlapping pairs, so its mesh had open seams (measured 233 of 300).
    #[test]
    fn box_booleans_through_the_dispatcher_have_watertight_meshes() {
        let mut rng = Lcg(77);
        for _ in 0..200 {
            let mut mk = |rng: &mut Lcg| {
                let (s, c) = ([4.0 + 14.0 * rng.next(), 4.0 + 14.0 * rng.next(), 4.0 + 10.0 * rng.next()], [-6.0 + 12.0 * rng.next(), -6.0 + 12.0 * rng.next(), -4.0 + 8.0 * rng.next()]);
                (bx(s, c), s, c)
            };
            let ((a, sa, ca), (b, sb, cb)) = (mk(&mut rng), mk(&mut rng));
            let (va, vb) = (sa[0] * sa[1] * sa[2], sb[0] * sb[1] * sb[2]);
            let vi = overlap(sa, ca, sb, cb);
            for (op, want) in [("union", va + vb - vi), ("subtract", va - vi), ("intersect", vi)] {
                let Some(r) = ops::boolean(op, &a, &b) else { continue };
                assert!((vol(&r) - want).abs() < 1e-7, "{op}: {} vs {want}", vol(&r));
                let m = crate::mesh::mesh_solid(&r, 0.05).expect("meshes");
                assert!(ops::check_watertight(&m), "{op}: open mesh, {} faces", r.faces().len());
            }
        }
    }




    #[test]
    fn a_blind_hole_overlapping_a_slot_builds() {
        let base = bx([40.0, 40.0, 20.0], [0.0; 3]);
        let two = sub_op(&sub_op(&base, &z_tool(5.0, 0.0, 0.0, -12.0, 12.0)), &z_tool(3.0, 4.0, 0.0, -12.0, 12.0));
        // The blind floor cuts the second hole's wall at a height; the cells of the first hole's wall
        // that share the meeting line must split there too.
        for tool in [z_tool(3.0, 9.0, 3.0, -2.0, 12.0), z_tool(3.0, -6.0, 2.0, -2.0, 12.0)] {
            let Outcome::Built(res) = boolean_planar("subtract", &two, &tool) else { panic!("refused") };
            let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
            assert!(ops::check_watertight(&m));
        }
    }

    // ---- S4e: two solid cylinders at right angles --------------------------------------------
    /// Volume the big cylinder (radius R, axis z, tall enough) and a perpendicular one (radius r, axis x,
    /// axes meeting) share when the small one runs from xl to xh: the integral over y of the section
    /// 2 sqrt(r^2 - y^2) x the length of [-sqrt(R^2 - y^2), sqrt(R^2 - y^2)] met by [xl, xh], Simpson on y = r sin t.
    fn cap_volume(big_r: f64, r: f64, xl: f64, xh: f64, n: usize) -> f64 {
        let h = std::f64::consts::PI / n as f64;
        let f = |t: f64| {
            let y = r * t.sin();
            let x = (big_r * big_r - y * y).sqrt();
            let z = (r * r - y * y).max(0.0).sqrt();
            2.0 * z * ((x.min(xh) - (-x).max(xl)).max(0.0)) * r * t.cos()
        };
        let a = -std::f64::consts::FRAC_PI_2;
        let mut sum = f(a) + f(-a);
        for i in 1..n {
            sum += f(a + i as f64 * h) * if i % 2 == 1 { 4.0 } else { 2.0 };
        }
        sum * h / 3.0
    }

    fn unit(i: usize, sign: f64) -> Vec3 {
        let mut v = [0.0; 3];
        v[i] = sign;
        v
    }

    /// The big cylinder (radius R, `h` tall, centred on the origin, axis `ia`) and the small one
    /// (radius r, from `xl` to `xh` along axis `id`, its axis crossing the big one's at height `c_v`).
    #[allow(clippy::too_many_arguments)]
    fn tee(big_r: f64, h: f64, r: f64, xl: f64, xh: f64, c_v: f64, ia: usize, id: usize) -> (TSolid, TSolid) {
        let big = build::cylinder_solid([0.0; 3], big_r, h, unit(ia, 1.0));
        let centre = add(scale(unit(ia, 1.0), c_v), scale(unit(id, 1.0), 0.5 * (xl + xh)));
        (big, build::cylinder_solid(centre, r, xh - xl, unit(id, 1.0)))
    }

    fn tee_expect(big_r: f64, h: f64, r: f64, xl: f64, xh: f64, n: usize) -> (f64, f64) {
        let pi = std::f64::consts::PI;
        let cap = cap_volume(big_r, r, xl, xh, n);
        (pi * big_r * big_r * h + pi * r * r * (xh - xl) - cap, cap)
    }

    fn check_tee_mesh(res: &TSolid, what: &str) {
        let exact = vol(res);
        for defl in [0.05, 0.5] {
            let m = crate::mesh::mesh_solid(res, defl).unwrap_or_else(|| panic!("{what}: no mesh at {defl}"));
            assert!(ops::check_watertight(&m), "{what}: not watertight at {defl}");
            let mut v = 0.0;
            for t in m.indices.chunks(3) {
                let (a, b, c) = (m.positions[t[0] as usize], m.positions[t[1] as usize], m.positions[t[2] as usize]);
                v += dot(a, cross(b, c)) / 6.0;
            }
            let slack = if defl < 0.1 { 0.025 } else { 0.12 };
            assert!(v > 0.0 && (v - exact).abs() < slack * exact + 10.0 * defl, "{what}: mesh volume {v} vs exact {exact} at {defl}");
        }
    }

    #[test]
    fn perpendicular_cylinders_join_and_keep_exactly() {
        // (R, height, r, xl, xh): through both sides, flush ends, an end inside (a radial boss on a shaft), a boss ending on the axis.
        let cases = [
            (20.0, 30.0, 7.0, -20.0, 20.0),
            (10.0, 40.0, 5.0, -20.0, 20.0),
            (10.0, 40.0, 5.0, -15.0, 18.0),
            (10.0, 40.0, 5.0, 0.0, 25.0),
            (10.0, 40.0, 5.0, -4.0, 25.0),
            (10.0, 40.0, 9.0, -30.0, 3.0),
            (10.0, 40.0, 9.0, -30.0, 4.0),
            (10.0, 40.0, 2.0, 3.0, 25.0),
            (10.0, 40.0, 5.0, -3.0, 13.0),
        ];
        for (big_r, h, r, xl, xh) in cases {
            let (a, b) = tee(big_r, h, r, xl, xh, 1.5, 2, 0);
            let (u, i) = tee_expect(big_r, h, r, xl, xh, 400_000);
            let ru = ops::boolean("union", &a, &b).unwrap_or_else(|| panic!("union refused {big_r} {r} {xl} {xh}"));
            let ri = ops::boolean("intersect", &a, &b).unwrap_or_else(|| panic!("intersect refused {big_r} {r} {xl} {xh}"));
            assert!((vol(&ru) - u).abs() < 1e-6 * u, "union {} vs {u} for {big_r} {r} {xl} {xh}", vol(&ru));
            assert!((vol(&ri) - i).abs() < 1e-6 * i, "intersect {} vs {i} for {big_r} {r} {xl} {xh}", vol(&ri));
            check_tee_mesh(&ru, "union");
            check_tee_mesh(&ri, "intersect");
        }
    }

    #[test]
    fn perpendicular_cylinders_in_either_order_and_axis() {
        let (big_r, h, r, xl, xh) = (10.0, 40.0, 4.0, -15.0, 15.0);
        let (u, i) = tee_expect(big_r, h, r, xl, xh, 200_000);
        for (ia, id) in [(0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1)] {
            let (a, b) = tee(big_r, h, r, xl, xh, -2.0, ia, id);
            for (x, y) in [(&a, &b), (&b, &a)] {
                let ru = ops::boolean("union", x, y).unwrap_or_else(|| panic!("union refused axes {ia} {id}"));
                let ri = ops::boolean("intersect", x, y).unwrap_or_else(|| panic!("intersect refused axes {ia} {id}"));
                assert!((vol(&ru) - u).abs() < 1e-6 * u, "union {} vs {u}", vol(&ru));
                assert!((vol(&ri) - i).abs() < 1e-6 * i, "intersect {} vs {i}", vol(&ri));
            }
        }
    }

    /// Random tees: the small cylinder's ends clear the big one or stop inside it, either axis, either
    /// order. Every built result must match the oracle; refusals are counted.
    fn tee_sweep(seed: u64, n: usize, in_scope: bool) -> (usize, usize) {
        let mut rng = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for k in 0..n {
            let big_r = 3.0 + 9.0 * rng.next();
            let r = (0.1 + 0.8 * rng.next()) * big_r;
            let s0 = (big_r * big_r - r * r).sqrt();
            let end = |rng: &mut Lcg, sgn: f64| -> f64 {
                if in_scope {
                    if rng.next() < 0.6 {
                        sgn * (big_r + 8.0 * rng.next())
                    } else {
                        s0 * 0.95 * (2.0 * rng.next() - 1.0)
                    }
                } else {
                    sgn * (2.0 * big_r) * rng.next()
                }
            };
            let (mut xl, mut xh) = (end(&mut rng, -1.0), end(&mut rng, 1.0));
            if xl > xh {
                std::mem::swap(&mut xl, &mut xh);
            }
            if in_scope && xl > -big_r && xh < big_r {
                // both ends inside the big cylinder is no crossing at all: one end must clear it
                if rng.next() < 0.5 { xh = big_r + 8.0 * rng.next() } else { xl = -big_r - 8.0 * rng.next() }
            }
            if xh - xl < 0.5 {
                continue;
            }
            let h = 2.0 * r + 1.0 + 20.0 * rng.next();
            let c_v = (0.5 * h - r - 0.2) * (2.0 * rng.next() - 1.0);
            let (ia, id) = [(0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1)][(rng.next() * 6.0) as usize % 6];
            let (a, b) = tee(big_r, h, r, xl, xh, c_v, ia, id);
            let (a, b) = if rng.next() < 0.5 { (a, b) } else { (b, a) };
            let (u, i) = tee_expect(big_r, h, r, xl, xh, 20_000);
            for (op, want) in [("union", u), ("intersect", i)] {
                match ops::boolean(op, &a, &b) {
                    Some(res) => {
                        built_n += 1;
                        assert!((vol(&res) - want).abs() < 2e-6 * want, "WRONG {op}: {} vs {want}: R={big_r} r={r} x=[{xl},{xh}] h={h} c_v={c_v} axes {ia} {id}", vol(&res));
                        if k % 7 == 0 {
                            let m = crate::mesh::mesh_solid(&res, 0.05).expect("meshes");
                            assert!(ops::check_watertight(&m), "{op}: open mesh: R={big_r} r={r} x=[{xl},{xh}] h={h} c_v={c_v} axes {ia} {id}");
                        }
                    }
                    None => {
                        refused_n += 1;
                        if in_scope {
                            eprintln!("TEE REFUSED {op}: R={big_r} r={r} x=[{xl},{xh}] h={h} c_v={c_v} axes {ia} {id}");
                        }
                    }
                }
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn random_perpendicular_cylinders_match_the_numeric_oracle() {
        let (b, r) = tee_sweep(404, 320, true);
        eprintln!("tees in scope: built {b}, refused {r}");
        assert!(b > 500 && r == 0, "built {b}, refused {r}");
    }

    #[test]
    fn random_perpendicular_cylinders_anywhere_are_never_wrong() {
        let (b, r) = tee_sweep(405, 320, false);
        eprintln!("tees anywhere: built {b}, refused {r}");
    }


    // ---- S4c: a bore through a part that carries faces this module does not model ----------------

    fn cyl_tool(c: Vec3, r: f64, len: f64) -> TSolid {
        build::cylinder_solid(c, r, len, [0.0, 0.0, 1.0])
    }

    /// 40 x 40 x 20 with every edge rounded 3, bored 8 across: 31263.5927 - pi 16 20.
    #[test]
    fn s4c_bore_through_a_fully_rounded_box() {
        let part = build::fillet_box(20.0, 20.0, 10.0, 3.0, [0.0; 3]);
        let tool = cyl_tool([0.0; 3], 4.0, 30.0);
        let r = match boolean_planar("subtract", &part, &tool) {
            Outcome::Built(r) => r,
            Outcome::Refused => panic!("refused: {:?}", take_reason()),
            Outcome::NotPlanar => panic!("not planar"),
        };
        let want = 31263.592_7 - std::f64::consts::PI * 16.0 * 20.0;
        assert!((vol(&r) - want).abs() < 1e-3, "{} vs {want}", vol(&r));
    }


    fn chamfered_cylinder() -> TSolid {
        let profile = [[0.0, 0.0], [20.0, 0.0], [20.0, 17.0], [17.0, 20.0], [0.0, 20.0]];
        build::revolve_profile(&profile, [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 360.0).unwrap().0
    }

    /// Cylinder R 20, h 20, rim chamfer 3 (centre of its box at z = 10), bored 8 down the axis.
    #[test]
    fn s4c_bore_through_a_chamfered_cylinder() {
        let part = chamfered_cylinder();
        let tool = cyl_tool([0.0, 0.0, 10.0], 4.0, 30.0);
        let r = match boolean_planar("subtract", &part, &tool) {
            Outcome::Built(r) => r,
            _ => panic!("the cone must be carried through"),
        };
        let pi = std::f64::consts::PI;
        let want = pi * 400.0 * 20.0 - 2.0 * pi * (20.0 - 1.0) * 4.5 - pi * 16.0 * 20.0;
        assert!((vol(&r) - want).abs() < 1e-6 * want, "{} vs {want}", vol(&r));
        assert!(ops::RAY_AVOID.with(|v| v.borrow().is_empty()), "the ray filter is switched off again");
    }

    /// A bore that reaches the chamfer cone is refused, never cut wrong, and says why.
    #[test]
    fn s4c_a_bore_that_reaches_the_cone_is_refused() {
        let part = chamfered_cylinder();
        // S4h made a bore COAXIAL with the cone exact (the cone meets it in a circle), so only an
        // off-axis bore that reaches the cone is still refused here.
        for (c, r) in [([12.0, 0.0, 10.0], 6.0)] {
            clear_reason();
            let out = boolean_planar("subtract", &part, &cyl_tool(c, r, 30.0));
            assert!(!matches!(out, Outcome::Built(_)), "bore {r} at {c:?} reaches the cone");
        }
        let round = build::fillet_box(20.0, 20.0, 10.0, 3.0, [0.0; 3]);
        clear_reason();
        assert!(!matches!(boolean_planar("subtract", &round, &cyl_tool([15.0, 0.0, 0.0], 4.0, 30.0)), Outcome::Built(_)));
        assert!(take_reason().is_some_and(|w| w.contains("curved")), "a sentence is left for the hole to say");
        assert!(ops::RAY_AVOID.with(|v| v.borrow().is_empty()));
    }

    /// The membership count must never read a sphere root as a crossing: a point right beside a corner
    /// sphere of the rounded box is still decided by rays that miss it.
    #[test]
    fn s4c_membership_avoids_the_carried_faces() {
        let part = build::fillet_box(20.0, 20.0, 10.0, 3.0, [0.0; 3]);
        let avoid = ops::unsafe_face_boxes(&part).expect("covers");
        assert!(!avoid.is_empty());
        ops::RAY_AVOID.with(|v| *v.borrow_mut() = avoid);
        ops::RAY_AVOID_FAILED.with(|f| f.set(false));
        let inside = ops::inside_solid(&part, [0.0, 0.0, 0.0]);
        let outside = ops::inside_solid(&part, [0.0, 0.0, 30.0]);
        let ok = !ops::RAY_AVOID_FAILED.with(|f| f.get());
        ops::RAY_AVOID.with(|v| v.borrow_mut().clear());
        assert!(ok && inside && !outside);
    }

#[cfg(test)]
mod rev_tests {
    use super::*;
    use super::tests::Lcg;
    use std::f64::consts::PI;

    fn bx(size: Vec3, c: Vec3) -> TSolid {
        build::box_solid(size, c, None)
    }
    fn ball(c: Vec3, r: f64) -> TSolid {
        build::sphere_solid(c, r, [0.0, 0.0, 1.0])
    }
    fn cone(c: Vec3, r: f64, h: f64) -> TSolid {
        build::cone_solid(c, r, h, [0.0, 0.0, 1.0])
    }
    fn cyl(c: Vec3, r: f64, h: f64) -> TSolid {
        build::cylinder_solid(c, r, h, [0.0, 0.0, 1.0])
    }
    fn vol(s: &TSolid) -> f64 {
        build::solid_volume(s)
    }
    /// Volume of the ball of radius `r` between heights `z1 < z2` measured from its centre.
    fn zone(r: f64, z1: f64, z2: f64) -> f64 {
        let (z1, z2) = (z1.max(-r), z2.min(r));
        PI * (r * r * (z2 - z1) - (z2.powi(3) - z1.powi(3)) / 3.0)
    }
    fn build_op(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
        match boolean_planar(op, a, b) {
            Outcome::Built(r) => Some(r),
            _ => None,
        }
    }
    fn mesh_volume(res: &TSolid, defl: f64) -> (bool, f64) {
        let m = crate::mesh::mesh_solid(res, defl).expect("meshes");
        let mut v = 0.0;
        for t in m.indices.chunks(3) {
            let (a, b, c) = (m.positions[t[0] as usize], m.positions[t[1] as usize], m.positions[t[2] as usize]);
            v += dot(a, cross(b, c)) / 6.0;
        }
        (ops::check_watertight(&m), v)
    }
    /// The result must build, equal the closed form to 1e-9, and mesh watertight at both chords.
    fn exact(label: &str, op: &str, a: &TSolid, b: &TSolid, want: f64) -> TSolid {
        let r = build_op(op, a, b).unwrap_or_else(|| panic!("{label}: {op} refused"));
        let got = vol(&r);
        assert!((got - want).abs() <= 1e-9 * want.abs().max(1.0), "{label}: {op} volume {got} vs {want}");
        for defl in [0.05, 0.5] {
            let (closed, v) = mesh_volume(&r, defl);
            let slack = if defl < 0.1 { 0.03 } else { 0.15 };
            assert!(closed, "{label}: {op} mesh not watertight at {defl}");
            assert!((v - want).abs() < slack * want.abs() + 10.0 * defl, "{label}: {op} mesh volume {v} vs {want} at {defl}");
        }
        r
    }

    #[test]
    fn dome_on_a_base_plate() {
        // box(40, 40, 10) from z = 0 to 10, and a ball of diameter 24 centred in it.
        let b = bx([40.0, 40.0, 10.0], [0.0, 0.0, 5.0]);
        let s = ball([0.0, 0.0, 5.0], 12.0);
        let inside = zone(12.0, -5.0, 5.0);
        let vb = 40.0 * 40.0 * 10.0;
        let vs = 4.0 / 3.0 * PI * 12.0f64.powi(3);
        exact("dome", "union", &b, &s, vb + vs - inside);
        exact("dome", "intersect", &b, &s, inside);
        exact("dome", "subtract", &b, &s, vb - inside);
        // The ball minus the slab is two caps with nothing joining them: not one solid.
        assert!(build_op("subtract", &s, &b).is_none());
    }
    #[test]
    fn spherical_pocket_in_a_slab() {
        // box(40, 40, 20) from -10 to 10 and a ball of diameter 24 at the origin: the ball leaves the slab
        // through its top and bottom.
        let b = bx([40.0, 40.0, 20.0], [0.0; 3]);
        let s = ball([0.0; 3], 12.0);
        let inside = zone(12.0, -10.0, 10.0);
        let vb = 40.0 * 40.0 * 20.0;
        let vs = 4.0 / 3.0 * PI * 12.0f64.powi(3);
        exact("slab", "subtract", &b, &s, vb - inside);
        exact("slab", "union", &b, &s, vb + vs - inside);
        exact("slab", "intersect", &b, &s, inside);
        // A blind pocket: the ball only breaks the top face.
        let s2 = ball([0.0, 0.0, 8.0], 6.0);
        let cap = zone(6.0, 2.0, 6.0); // above z = 10
        let vs2 = 4.0 / 3.0 * PI * 216.0;
        exact("pocket", "subtract", &b, &s2, vb - (vs2 - cap));
        exact("pocket", "union", &b, &s2, vb + cap);
        exact("pocket", "intersect", &b, &s2, vs2 - cap);
        // Sealed inside: a cavity (or the box whole, or the ball whole).
        let s3 = ball([0.0, 0.0, 0.0], 5.0);
        let vs3 = 4.0 / 3.0 * PI * 125.0;
        exact("sealed", "union", &b, &s3, vb);
        exact("sealed", "intersect", &b, &s3, vs3);
    }

    #[test]
    fn cone_tip_on_a_cylinder() {
        // cylinder(20, 20) from z = -10 to 10 and a cone of base diameter 20, 14 tall, standing on its top.
        let c = cyl([0.0; 3], 10.0, 20.0);
        let k = cone([0.0, 0.0, 17.0], 10.0, 14.0);
        let (vc, vk) = (PI * 100.0 * 20.0, PI * 100.0 * 14.0 / 3.0);
        let u = exact("tip", "union", &c, &k, vc + vk);
        assert_eq!(u.faces().len(), 3, "bottom disk, wall, cone");
        // Only touching: no overlap to intersect, the subtract leaves the cylinder.
        // A narrower cone on the same top: the top disk keeps a ring.
        let k2 = cone([0.0, 0.0, 17.0], 6.0, 14.0);
        exact("narrow tip", "union", &c, &k2, vc + PI * 36.0 * 14.0 / 3.0);
        // A wider cone overhangs the cylinder.
        let k3 = cone([0.0, 0.0, 17.0], 14.0, 14.0);
        exact("wide tip", "union", &c, &k3, vc + PI * 196.0 * 14.0 / 3.0);
    }

    #[test]
    fn sphere_sliced_by_a_box_and_cone_by_a_plane() {
        // A ball of radius 12 and a slab that keeps the cap above z = 8 (h = 4).
        let s = ball([0.0; 3], 12.0);
        let slab = bx([60.0, 60.0, 20.0], [0.0, 0.0, 18.0]);
        let vs = 4.0 / 3.0 * PI * 1728.0;
        let cap = PI * 16.0 * (36.0 - 4.0) / 3.0;
        exact("cap", "intersect", &s, &slab, cap);
        exact("cap", "subtract", &s, &slab, vs - cap);
        exact("cap", "union", &s, &slab, 60.0 * 60.0 * 20.0 + vs - cap);
        // A cone (base radius 10, height 20, z from 0 to 20) sliced at z = 5 by a slab above it.
        let k = cone([0.0, 0.0, 10.0], 10.0, 20.0);
        let up = bx([40.0, 40.0, 30.0], [0.0, 0.0, 20.0]);
        let vk = PI * 100.0 * 20.0 / 3.0;
        let tip = PI * 7.5 * 7.5 * 15.0 / 3.0;
        exact("slice", "intersect", &k, &up, tip);
        exact("slice", "subtract", &k, &up, vk - tip);
        exact("slice", "union", &k, &up, 40.0 * 40.0 * 30.0 + vk - tip);
    }

    #[test]
    fn ball_knob_on_a_post_and_coaxial_pairs() {
        // A post (r 4, z 0 to 20) with a ball (r 8) centred at z 24: the ball takes the post's top.
        let post = cyl([0.0, 0.0, 10.0], 4.0, 20.0);
        let s = ball([0.0, 0.0, 24.0], 8.0);
        let z1 = 24.0 - (64.0f64 - 16.0).sqrt();
        let overlap = PI * 16.0 * (20.0 - z1) + PI * (8.0 - 48f64.sqrt()).powi(2) * (24.0 - (8.0 - 48f64.sqrt())) / 3.0;
        let (vp, vs) = (PI * 16.0 * 20.0, 4.0 / 3.0 * PI * 512.0);
        exact("knob", "union", &post, &s, vp + vs - overlap);
        exact("knob", "intersect", &post, &s, overlap);
        exact("knob", "subtract", &post, &s, vp - overlap);
        exact("knob", "subtract", &s, &post, vs - overlap);
        // Two balls on one line: a lens.
        let a = ball([0.0; 3], 10.0);
        let b = ball([0.0, 0.0, 12.0], 7.0);
        // They meet at z where 100 - z^2 = 49 - (z - 12)^2: z = (100 - 49 + 144) / 24.
        let z = (100.0 - 49.0 + 144.0) / 24.0;
        let lens = zone(10.0, z, 10.0) + zone(7.0, -7.0, z - 12.0);
        let (va, vb) = (4.0 / 3.0 * PI * 1000.0, 4.0 / 3.0 * PI * 343.0);
        exact("lens", "union", &a, &b, va + vb - lens);
        exact("lens", "intersect", &a, &b, lens);
        exact("lens", "subtract", &a, &b, va - lens);
    }

    // ---- an independent oracle: cross-sections of solids about one axis ------------------------

    #[derive(Clone, Copy, Debug)]
    enum Sd {
        Ball { c: f64, r: f64 },
        /// Base at `zb`, apex `h` above (`up`) or below it.
        Cone { zb: f64, r: f64, h: f64, up: bool },
        Cyl { z0: f64, z1: f64, r: f64 },
        /// A 200 x 200 slab: wider than anything about the axis.
        Slab { z0: f64, z1: f64 },
    }

    const INF: f64 = f64::INFINITY;

    impl Sd {
        fn solid(&self) -> TSolid {
            match *self {
                Sd::Ball { c, r } => ball([0.0, 0.0, c], r),
                Sd::Cone { zb, r, h, up } => {
                    if up {
                        build::cone_solid([0.0, 0.0, zb + h / 2.0], r, h, [0.0, 0.0, 1.0])
                    } else {
                        build::cone_solid([0.0, 0.0, zb - h / 2.0], r, h, [0.0, 0.0, -1.0])
                    }
                }
                Sd::Cyl { z0, z1, r } => cyl([0.0, 0.0, 0.5 * (z0 + z1)], r, z1 - z0),
                Sd::Slab { z0, z1 } => bx([200.0, 200.0, z1 - z0], [0.0, 0.0, 0.5 * (z0 + z1)]),
            }
        }
        /// The radial intervals (in rho squared) the solid fills at height `z`.
        fn section(&self, z: f64) -> Vec<(f64, f64)> {
            match *self {
                Sd::Ball { c, r } => {
                    if (z - c).abs() < r {
                        vec![(0.0, r * r - (z - c) * (z - c))]
                    } else {
                        vec![]
                    }
                }
                Sd::Cone { zb, r, h, up } => {
                    let t = if up { z - zb } else { zb - z };
                    if t > 0.0 && t < h {
                        vec![(0.0, (r * (1.0 - t / h)).powi(2))]
                    } else {
                        vec![]
                    }
                }
                Sd::Cyl { z0, z1, r } => {
                    if z > z0 && z < z1 {
                        vec![(0.0, r * r)]
                    } else {
                        vec![]
                    }
                }
                Sd::Slab { z0, z1 } => {
                    if z > z0 && z < z1 {
                        vec![(0.0, INF)]
                    } else {
                        vec![]
                    }
                }
            }
        }
        /// Heights where the section changes shape.
        fn ends(&self) -> Vec<f64> {
            match *self {
                Sd::Ball { c, r } => vec![c - r, c + r],
                Sd::Cone { zb, h, up, .. } => vec![zb, if up { zb + h } else { zb - h }],
                Sd::Cyl { z0, z1, .. } | Sd::Slab { z0, z1 } => vec![z0, z1],
            }
        }
        /// rho squared as a quadratic `a z^2 + b z + c` in z.
        fn quad(&self) -> Option<(f64, f64, f64)> {
            match *self {
                Sd::Ball { c, r } => Some((-1.0, 2.0 * c, r * r - c * c)),
                Sd::Cone { zb, r, h, up } => {
                    // rho = r (1 - t / h), t = s (z - zb), s = +-1
                    let s = if up { 1.0 } else { -1.0 };
                    let (k, k0) = (-r * s / h, r * (1.0 + s * zb / h));
                    Some((k * k, 2.0 * k * k0, k0 * k0))
                }
                Sd::Cyl { r, .. } => Some((0.0, 0.0, r * r)),
                Sd::Slab { .. } => None,
            }
        }
    }

    impl Sd {
        fn scaled(&self, k: f64) -> Sd {
            match *self {
                Sd::Ball { c, r } => Sd::Ball { c: c * k, r: r * k },
                Sd::Cone { zb, r, h, up } => Sd::Cone { zb: zb * k, r: r * k, h: h * k, up },
                Sd::Cyl { z0, z1, r } => Sd::Cyl { z0: z0 * k, z1: z1 * k, r: r * k },
                Sd::Slab { z0, z1 } => Sd::Slab { z0: z0 * k, z1: z1 * k },
            }
        }
    }

    fn norm(mut v: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
        v.retain(|p| p.1 - p.0 > 1e-12 || p.1 == INF);
        v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut out: Vec<(f64, f64)> = Vec::new();
        for p in v {
            match out.last_mut() {
                Some(l) if p.0 <= l.1 => l.1 = l.1.max(p.1),
                _ => out.push(p),
            }
        }
        out
    }
    fn set_op(op: &str, a: &[(f64, f64)], b: &[(f64, f64)]) -> Vec<(f64, f64)> {
        let inter = |x: &[(f64, f64)], y: &[(f64, f64)]| {
            let mut o = Vec::new();
            for p in x {
                for q in y {
                    let (lo, hi) = (p.0.max(q.0), p.1.min(q.1));
                    if hi > lo {
                        o.push((lo, hi));
                    }
                }
            }
            norm(o)
        };
        match op {
            "union" => norm(a.iter().chain(b.iter()).copied().collect()),
            "intersect" => inter(a, b),
            _ => {
                // a minus b: a meets the complement of b within [0, INF)
                let mut comp = Vec::new();
                let mut at = 0.0;
                for q in b {
                    if q.0 > at {
                        comp.push((at, q.0));
                    }
                    at = q.1;
                }
                if at < INF {
                    comp.push((at, INF));
                }
                inter(a, &comp)
            }
        }
    }
    fn area_of(v: &[(f64, f64)]) -> f64 {
        v.iter().map(|&(lo, hi)| if hi == INF { 200.0 * 200.0 - PI * lo } else { PI * (hi - lo) }).sum()
    }
    /// The exact volume of `((first op1 s1) op2 s2) ...`: the section area is piecewise quadratic in
    /// z, so Gauss-Legendre is exact between the heights where the section changes shape.
    fn oracle(seq: &[(&str, Sd)], first: Sd) -> f64 {
        let all: Vec<Sd> = std::iter::once(first).chain(seq.iter().map(|s| s.1)).collect();
        let section = |z: f64| {
            let mut cur = first.section(z);
            for (op, s) in seq {
                cur = set_op(op, &cur, &s.section(z));
            }
            area_of(&cur)
        };
        let mut zs: Vec<f64> = all.iter().flat_map(|s| s.ends()).collect();
        // Where two curved surfaces cross.
        for i in 0..all.len() {
            for j in 0..i {
                if let (Some(p), Some(q)) = (all[i].quad(), all[j].quad()) {
                    let (a, b, c) = (p.0 - q.0, p.1 - q.1, p.2 - q.2);
                    if a.abs() < 1e-12 {
                        if b.abs() > 1e-12 {
                            zs.push(-c / b);
                        }
                    } else {
                        let d = b * b - 4.0 * a * c;
                        if d >= 0.0 {
                            zs.push((-b + d.sqrt()) / (2.0 * a));
                            zs.push((-b - d.sqrt()) / (2.0 * a));
                        }
                    }
                }
            }
        }
        zs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        zs.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
        let mut v = 0.0;
        for w in zs.windows(2) {
            let (a, b) = (w[0], w[1]);
            if b - a < 1e-12 {
                continue;
            }
            // Three-point Gauss-Legendre: exact for the quadratic, and every node is strictly inside.
            let (m, h) = (0.5 * (a + b), 0.5 * (b - a));
            let d = h * (3.0f64 / 5.0).sqrt();
            v += h * (5.0 / 9.0 * (section(m - d) + section(m + d)) + 8.0 / 9.0 * section(m));
        }
        v
    }

    /// The pieces of the solid, by flood fill over its (rho, z) half-plane at 0.1 mm: 0 for an empty
    /// result. An independent reading of "is this one solid", used to explain refusals.
    fn lumps(seq: &[(&str, Sd)], first: Sd) -> usize {
        let (nz, nr) = (700usize, 200usize);
        let (z_lo, dz, dr) = (-30.0, 0.1, 0.1);
        let section = |z: f64| {
            let mut cur = first.section(z);
            for (op, s) in seq {
                cur = set_op(op, &cur, &s.section(z));
            }
            cur
        };
        let mut cell = vec![false; nz * nr];
        for i in 0..nz {
            let sec = section(z_lo + dz * (i as f64 + 0.5));
            for j in 0..nr {
                let r2 = (dr * (j as f64 + 0.5)).powi(2);
                cell[i * nr + j] = sec.iter().any(|&(lo, hi)| r2 > lo && r2 < hi);
            }
        }
        let mut seen = vec![false; nz * nr];
        let mut n = 0;
        for start in 0..nz * nr {
            if !cell[start] || seen[start] {
                continue;
            }
            n += 1;
            let mut stack = vec![start];
            seen[start] = true;
            while let Some(c) = stack.pop() {
                let (i, j) = (c / nr, c % nr);
                for (di, dj) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
                    let (ni, nj) = (i as i64 + di, j as i64 + dj);
                    if ni < 0 || nj < 0 || ni >= nz as i64 || nj >= nr as i64 {
                        continue;
                    }
                    let k = ni as usize * nr + nj as usize;
                    if cell[k] && !seen[k] {
                        seen[k] = true;
                        stack.push(k);
                    }
                }
            }
        }
        n
    }

    fn random_sd(rng: &mut Lcg, slab_ok: bool) -> Sd {
        let k = (rng.next() * if slab_ok { 4.0 } else { 3.0 }) as usize;
        let z = -12.0 + 24.0 * rng.next();
        match k {
            0 => Sd::Ball { c: z, r: 4.0 + 10.0 * rng.next() },
            1 => Sd::Cone { zb: z, r: 3.0 + 10.0 * rng.next(), h: 5.0 + 20.0 * rng.next(), up: rng.next() < 0.5 },
            2 => Sd::Cyl { z0: z, z1: z + 4.0 + 20.0 * rng.next(), r: 3.0 + 10.0 * rng.next() },
            _ => Sd::Slab { z0: z, z1: z + 3.0 + 20.0 * rng.next() },
        }
    }

    /// Random pairs about the axis against the oracle. Returns (built, refused); a built result that
    /// differs from the oracle by more than 1e-9 panics.
    fn pair_sweep(seed: u64, n: usize, mesh_every: usize, dispatcher: bool) -> (usize, usize) {
        let mut rng = Lcg(seed);
        let (mut built, mut refused, mut unexplained) = (0, 0, 0);
        for i in 0..n {
            let (a, b) = (random_sd(&mut rng, true), random_sd(&mut rng, true));
            if matches!((a, b), (Sd::Slab { .. }, Sd::Slab { .. })) {
                continue;
            }
            for op in ["union", "intersect", "subtract"] {
                let want = oracle(&[(op, b)], a);
                let res = if dispatcher { ops::boolean(op, &a.solid(), &b.solid()) } else { build_op(op, &a.solid(), &b.solid()) };
                match res {
                    Some(r) => {
                        built += 1;
                        let got = vol(&r);
                        assert!((got - want).abs() <= 1e-9 * want.abs().max(1.0), "pair {i} {op}: {a:?} {b:?}: volume {got} vs oracle {want}");
                        if mesh_every > 0 && built % mesh_every == 0 {
                            for (defl, slack) in [(0.05, 0.03), (0.5, 0.35)] {
                                let (closed, v) = mesh_volume(&r, defl);
                                assert!(closed, "pair {i} {op}: {a:?} {b:?}: mesh not watertight at {defl}");
                                assert!((v - want).abs() < slack * want.abs() + 1.0, "pair {i} {op}: mesh volume {v} vs {want} at {defl}");
                            }
                        }
                    }
                    None => {
                        refused += 1;
                        // A refusal is right when the answer is empty or is not one solid.
                        let n = lumps(&[(op, b)], a);
                        if n == 1 && !dispatcher {
                            unexplained += 1;
                            eprintln!("UNEXPLAINED REFUSAL {op}: {a:?} | {b:?}");
                        }
                    }
                }
            }
        }
        eprintln!("seed {seed}: built {built}, refused {refused}, of which one solid (unexplained) {unexplained}");
        (built, refused)
    }

    /// The same pairs at other sizes: 0.2x (parts a millimetre across) and 5x. Every threshold in the
    /// module is an absolute 1e-7 mm, so size is a real axis.
    #[test]
    fn random_coaxial_pairs_at_other_scales_match_the_oracle() {
        let mut rng = Lcg(7101);
        let (mut built, mut refused) = (0, 0);
        for k in [0.2, 5.0] {
            for i in 0..80 {
                let (a, b) = (random_sd(&mut rng, true).scaled(k), random_sd(&mut rng, true).scaled(k));
                if matches!((a, b), (Sd::Slab { .. }, Sd::Slab { .. })) {
                    continue;
                }
                for op in ["union", "intersect", "subtract"] {
                    let want = oracle(&[(op, b)], a);
                    match build_op(op, &a.solid(), &b.solid()) {
                        Some(r) => {
                            built += 1;
                            let got = vol(&r);
                            assert!((got - want).abs() <= 1e-9 * want.abs().max(1.0), "scale {k} pair {i} {op}: {a:?} {b:?}: volume {got} vs oracle {want}");
                        }
                        None => refused += 1,
                    }
                }
            }
        }
        eprintln!("scaled pairs: built {built}, refused {refused}");
        assert!(built > 200);
    }

    #[test]
    fn random_coaxial_pairs_through_the_dispatcher_match_the_oracle() {
        // The same pairs through `ops::boolean`, which tries the older face-by-face path first: nothing
        // it builds may differ from the oracle either.
        let (b1, r1) = pair_sweep(7003, 100, 0, true);
        eprintln!("dispatcher: built {b1}, refused {r1}");
    }

    #[test]
    fn oracle_agrees_with_the_hand_cases() {
        // A ball in a slab: slab + ball - the part of the ball inside the slab.
        let b = Sd::Slab { z0: 0.0, z1: 10.0 };
        let s = Sd::Ball { c: 5.0, r: 12.0 };
        let want = 200.0 * 200.0 * 10.0 + 4.0 / 3.0 * PI * 1728.0 - zone(12.0, -5.0, 5.0);
        assert!((oracle(&[("union", s)], b) - want).abs() < 1e-6);
        // A cone and a one-thick coin of tiny radius: the cone, to within the coin.
        let k = Sd::Cone { zb: 0.0, r: 10.0, h: 20.0, up: true };
        assert!((oracle(&[("union", Sd::Cyl { z0: 0.0, z1: 1.0, r: 1.0 })], k) - PI * 100.0 * 20.0 / 3.0).abs() < 0.2);
    }

    #[test]
    fn random_coaxial_pairs_match_the_oracle() {
        let (b1, r1) = pair_sweep(7001, 130, 7, false);
        let (b2, r2) = pair_sweep(7002, 130, 7, false);
        // Every result of a larger run meshes closed at both chords (a few seconds).
        let n = std::env::var("REV_MESH_N").ok().and_then(|v| v.parse().ok()).unwrap_or(40);
        pair_sweep(7004, n, 1, false);
        eprintln!("coaxial pairs: built {}, refused {}", b1 + b2, r1 + r2);
        assert!(b1 + b2 >= 300, "only {} built", b1 + b2);
    }
    /// Three solids about the axis, folded left to right: the second operation reads the first one's
    /// RESULT, whose sphere and cone faces may already be flipped (a bowl) or banded.
    fn chain_sweep(seed: u64, n: usize, dispatcher: bool) -> (usize, usize) {
        let mut rng = Lcg(seed);
        let (mut built, mut stopped) = (0, 0);
        let ops = ["union", "intersect", "subtract"];
        for i in 0..n {
            let s0 = random_sd(&mut rng, true);
            let (s1, s2) = (random_sd(&mut rng, true), random_sd(&mut rng, true));
            let (op1, op2) = (ops[(rng.next() * 3.0) as usize], ops[(rng.next() * 3.0) as usize]);
            let step = |op: &str, a: &TSolid, b: &TSolid| if dispatcher { ops::boolean(op, a, b) } else { build_op(op, a, b) };
            let Some(r1) = step(op1, &s0.solid(), &s1.solid()) else {
                stopped += 1;
                continue;
            };
            let want1 = oracle(&[(op1, s1)], s0);
            assert!((vol(&r1) - want1).abs() <= 1e-9 * want1.abs().max(1.0), "chain {i}: first step {op1} {s0:?} {s1:?}: {} vs {want1}", vol(&r1));
            let Some(r2) = step(op2, &r1, &s2.solid()) else {
                stopped += 1;
                continue;
            };
            built += 1;
            let want = oracle(&[(op1, s1), (op2, s2)], s0);
            assert!((vol(&r2) - want).abs() <= 1e-9 * want.abs().max(1.0), "chain {i}: {op1} then {op2}: {s0:?} {s1:?} {s2:?}: volume {} vs oracle {want}", vol(&r2));
            if built % 6 == 0 {
                let (closed, v) = mesh_volume(&r2, 0.05);
                assert!(closed, "chain {i}: {s0:?} {op1} {s1:?} {op2} {s2:?}: mesh not watertight");
                assert!((v - want).abs() < 0.03 * want.abs() + 1.0, "chain {i}: mesh volume {v} vs {want}");
            }
        }
        eprintln!("chains (dispatcher {dispatcher}) seed {seed}: built {built}, stopped {stopped}");
        (built, stopped)
    }

    #[test]
    fn chained_booleans_on_flipped_and_banded_faces_match_the_oracle() {
        let (b, _) = chain_sweep(8101, 220, false);
        assert!(b >= 80, "only {b} chains built");
        chain_sweep(8102, 120, true);
    }
    /// The same pairs after one rigid motion of both operands: the axis points anywhere, the whole
    /// sphere frame is re-laid on it, and every circle's seam must still agree between faces.
    #[test]
    fn random_coaxial_pairs_on_a_turned_axis_match_the_oracle() {
        let mut rng = Lcg(9101);
        let (mut built, mut refused) = (0, 0);
        for i in 0..110 {
            let (a, b) = (random_sd(&mut rng, true), random_sd(&mut rng, true));
            if matches!((a, b), (Sd::Slab { .. }, Sd::Slab { .. })) {
                continue;
            }
            let axis = normalize([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]);
            let t = crate::math::Transform::translation([30.0 * rng.next(), 30.0 * rng.next(), 30.0 * rng.next()]).then(&crate::math::Transform::rotation(axis, 6.0 * rng.next()));
            let (sa, sb) = (build::transform_solid(&a.solid(), &t), build::transform_solid(&b.solid(), &t));
            for op in ["union", "intersect", "subtract"] {
                let want = oracle(&[(op, b)], a);
                match build_op(op, &sa, &sb) {
                    Some(r) => {
                        built += 1;
                        assert!((vol(&r) - want).abs() <= 1e-9 * want.abs().max(1.0), "turned pair {i} {op}: {a:?} {b:?}: {} vs {want}", vol(&r));
                    }
                    None => refused += 1,
                }
            }
        }
        eprintln!("turned pairs: built {built}, refused {refused}");
        assert!(built >= 150, "only {built} built");
    }

    #[test]
    fn what_is_not_provably_exact_refuses() {
        let slab = Sd::Slab { z0: -10.0, z1: 10.0 }.solid();
        // The ball pokes through the side of a narrow box: the cut is not a circle square to the axis.
        let narrow = bx([20.0, 20.0, 20.0], [0.0; 3]);
        let s = ball([0.0; 3], 12.0);
        for op in ["union", "intersect", "subtract"] {
            assert!(build_op(op, &narrow, &s).is_none(), "{op}: a ball through the side of a box");
            assert!(build_op(op, &s, &narrow).is_none(), "{op}: a box through the side of a ball");
        }
        // A box that stops short of the ball's equator: still the side faces reach the ball.
        let corner = bx([40.0, 40.0, 40.0], [20.0, 20.0, 20.0]);
        assert!(build_op("subtract", &s, &corner).is_none());
        // An off-axis cylinder through a ball, and an off-axis ball in a cylinder.
        let off = cyl([5.0, 0.0, 0.0], 4.0, 40.0);
        assert!(build_op("subtract", &s, &off).is_none());
        let k = cone([0.0, 0.0, 0.0], 8.0, 20.0);
        assert!(build_op("union", &k, &off).is_none());
        // Equal spheres, the same cone, and a plane tangent to the ball.
        assert!(build_op("union", &s, &ball([0.0; 3], 12.0)).is_none());
        assert!(build_op("union", &k, &cone([0.0; 3], 8.0, 20.0)).is_none());
        let tangent = bx([40.0, 40.0, 10.0], [0.0, 0.0, 17.0]);
        assert!(build_op("union", &s, &tangent).is_none(), "a plate resting on the ball's pole");
        // A plane through a cone's apex.
        let at_apex = bx([40.0, 40.0, 10.0], [0.0, 0.0, 15.0]);
        assert!(build_op("union", &k, &at_apex).is_none(), "a plate touching the apex");
        // Two balls and a box: sides clear, so this one is fine.
        let two = build_op("union", &s, &ball([0.0, 0.0, 15.0], 6.0)).expect("two balls");
        let r = build_op("subtract", &slab, &s).expect("slab minus ball");
        assert!(vol(&r) > 0.0 && vol(&two) > 0.0);
    }
    /// Near-tangent and near-coincident pairs: whatever the kernel builds is exact, and what it cannot
    /// prove it refuses. (Every threshold in the module is an absolute 1e-7; this walks across them.)
    #[test]
    fn near_tangent_pairs_are_exact_or_refused() {
        let deltas = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 3e-7, 1e-7, 5e-8, 1e-8, 0.0, -1e-8, -1e-7, -1e-6, -1e-3];
        let mut pairs: Vec<(Sd, Sd, String, f64)> = Vec::new();
        for &d in &deltas {
            // a plate whose bottom face is d below the ball's pole, and one d above the cone's apex
            pairs.push((Sd::Ball { c: 0.0, r: 12.0 }, Sd::Slab { z0: 12.0 - d, z1: 30.0 }, format!("plate {d} into the pole"), d));
            pairs.push((Sd::Cone { zb: 0.0, r: 10.0, h: 20.0, up: true }, Sd::Slab { z0: 20.0 - d, z1: 30.0 }, format!("plate {d} into the apex"), d));
            // a cylinder whose radius is d short of the ball's, and one d wider
            pairs.push((Sd::Ball { c: 0.0, r: 12.0 }, Sd::Cyl { z0: -20.0, z1: 20.0, r: 12.0 - d }, format!("cylinder {d} inside the ball"), d));
            // two balls d apart from touching
            pairs.push((Sd::Ball { c: 0.0, r: 8.0 }, Sd::Ball { c: 14.0 - d, r: 6.0 }, format!("balls {d} past touching"), d));
            // a cylinder end d inside the ball's equator plane, a cone base d inside a plate face
            pairs.push((Sd::Cyl { z0: -5.0, z1: 12.0 - d, r: 3.0 }, Sd::Ball { c: 0.0, r: 12.0 }, format!("post end {d} short of the pole"), d));
            pairs.push((Sd::Cyl { z0: -10.0, z1: 0.0, r: 6.0 }, Sd::Cone { zb: -d, r: 6.0, h: 10.0, up: true }, format!("cone base {d} into the cylinder top"), d));
            // a cone whose slope meets a ball nearly tangentially
            pairs.push((Sd::Ball { c: 0.0, r: 6.0 }, Sd::Cone { zb: -9.0 + d, r: 3.0, h: 20.0, up: true }, format!("ball and cone {d}"), d));
        }
        let (mut built, mut refused) = (0, 0);
        for (a, b, label, d) in &pairs {
            // Within the module's 1e-7 mm a face is "the same place" as its neighbour: the slice that
            // thin (at most 1e-7 x the largest section, about 450 mm^2) is not seen, by design.
            let snap = if d.abs() <= 3e-7 { 5e-5 } else { 0.0 };
            for op in ["union", "intersect", "subtract"] {
                let want = oracle(&[(op, *b)], *a);
                match build_op(op, &a.solid(), &b.solid()) {
                    Some(r) => {
                        built += 1;
                        let got = vol(&r);
                        assert!((got - want).abs() <= 1e-9 * want.abs().max(1.0) + snap, "{label}: {op}: volume {got} vs oracle {want}");
                        let (closed, _) = mesh_volume(&r, 0.05);
                        assert!(closed, "{label}: {op}: mesh not watertight");
                    }
                    None => refused += 1,
                }
            }
        }
        eprintln!("near-tangent pairs: built {built}, refused {refused}");
        assert!(built > 60, "built only {built}");
    }
    /// A cap or an off-centre band of a sphere has the box of THAT band, not one dragged to the
    /// sphere's centre: the cap above z = 8 of a ball of radius 12 spans z from 8 to 12.
    #[test]
    fn a_sphere_cap_has_a_tight_bounding_box() {
        let r = build_op("intersect", &ball([0.0; 3], 12.0), &bx([60.0, 60.0, 20.0], [0.0, 0.0, 18.0])).unwrap();
        let bb = build::solid_aabb(&r);
        let rho = (144.0f64 - 64.0).sqrt();
        for (got, want) in [(bb.lo[0], -rho), (bb.lo[1], -rho), (bb.lo[2], 8.0), (bb.hi[0], rho), (bb.hi[1], rho), (bb.hi[2], 12.0)] {
            assert!((got - want).abs() < 1e-9, "bbox {bb:?}");
        }
        // The same ball off the origin, and a band between two heights that does not cross its centre.
        let r = build_op("subtract", &bx([60.0, 60.0, 40.0], [5.0, 0.0, 10.0]), &ball([5.0, 0.0, 24.0], 12.0)).unwrap();
        let bb = build::solid_aabb(&r);
        assert!((bb.lo[2] + 10.0).abs() < 1e-9 && (bb.hi[2] - 30.0).abs() < 1e-9, "bbox {bb:?}");
    }

    /// STEP: a cone's apex circle has radius zero, never a rounding-error negative one (OpenCascade
    /// dropped the whole solid on read-back), and a polar cap is written as its one rim.
    #[test]
    fn step_writes_the_apex_and_the_polar_cap() {
        let tip = build_op("union", &cyl([0.0; 3], 10.0, 20.0), &cone([0.0, 0.0, 17.0], 10.0, 14.0)).unwrap();
        let text = crate::step::write_solid(&tip, "tip").expect("a cone on a cylinder writes");
        for l in text.lines().filter(|l| l.contains("= CIRCLE(")) {
            let radius = l.trim_end_matches(");").rsplit(',').next().unwrap();
            assert!(!radius.starts_with('-'), "a circle with a negative radius: {l}");
        }
        let dome = build_op("union", &bx([40.0, 40.0, 10.0], [0.0, 0.0, 5.0]), &ball([0.0, 0.0, 10.0], 8.0)).unwrap();
        let text = crate::step::write_solid(&dome, "dome").expect("a dome on a plate writes (a cap with the pole in it)");
        assert!(text.contains("SPHERICAL_SURFACE"));
    }
}
}
