//! Split-and-classify boolean for solids made of planes and cylinder walls
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
//! Sampled polygons appear below ONLY to decide orientation and containment;
//! no result geometry is ever a sampled curve.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::f64::consts::TAU;
use std::rc::Rc;

use crate::build::{self, TFace, TSolid};
use crate::geom::{ArcRange, Curve, Cylinder, Plane, Surface};
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
            _ => return None,
        }
    }
    // A whole circle on a plane face has an arbitrary start; the cylinder wall
    // it bounds has its seam at angle zero. Start the circle at the seam, or the
    // two halves of one circle cannot be welded after a cut.
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
    Some(out)
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
    }
}

fn boxes_meet(a: &Box3, b: &Box3) -> bool {
    (0..3).all(|k| a.0[k] <= b.1[k] + EPS && b.0[k] <= a.1[k] + EPS)
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

fn coplanar(f: &PFace, g: &PFace) -> bool {
    len(cross(f.plane.n, g.plane.n)) < 1e-9 && f.plane.distance(g.plane.origin).abs() < EPS
}

fn cuts_on_plane(f: &PFace, other: &[AFace]) -> Result<Vec<E2>, ()> {
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
            AFace::Cyl(g) => out.extend(cyl_on_plane(f, g, &me)?),
        }
    }
    Ok(out)
}

/// The curves where cylinder wall `g` meets the plane of `f`: two lines when
/// the plane is parallel to the axis, a circle when it is square to it.
fn cyl_on_plane(f: &PFace, g: &CFace, plane_box: &Box3) -> Result<Vec<E2>, ()> {
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
        if k.abs() > rr - EPS {
            bail!(); // tangent plane
        }
        let (phi, del) = (b.atan2(a), (k / rr).acos());
        for th in [phi + del, phi - del] {
            let rel = pos_ang(th - g.u0);
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

fn wall_grid(f: &CFace, other: &[AFace]) -> Result<Grid, ()> {
    let c = &f.cyl;
    let me = aabb_cyl(c);
    let tol = EPS / c.radius;
    let (mut us, mut vs) = (Vec::new(), Vec::new());
    for g in other {
        if !boxes_meet(&me, &aabb(g)) {
            continue;
        }
        let AFace::Plane(g) = g else {
            bail!(); // cylinder against cylinder: not modelled (S3)
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
            if k.abs() > rr - EPS {
                bail!();
            }
            let (phi, del) = (b.atan2(a), (k / rr).acos());
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

enum Kept {
    Plane { plane: Plane, region: Region },
    /// A finished cylinder-wall face, already flipped when it must be.
    Wall(TFace),
}

type VertexFn<'a> = &'a mut dyn FnMut(Vec3) -> topo::VertexRef;

#[allow(clippy::too_many_arguments)]
fn pieces(
    faces: &[AFace],
    grids: &[Option<Grid>],
    other: &[AFace],
    other_solid: &TSolid,
    keep: &dyn Fn(Class) -> bool,
    flip: bool,
    walls: &[(&CFace, &Grid)],
    vertex: VertexFn,
) -> Result<Vec<Kept>, ()> {
    let mut out = Vec::new();
    for (face, grid) in faces.iter().zip(grids) {
        match face {
            AFace::Plane(f) => {
                let cuts = cuts_on_plane(f, other)?;
                for region in split_face(f, &cuts, &grid_nodes(f, walls))? {
                    let s = interior_point(&region).ok_or(())?;
                    if !in_edges(s, &f.edges) {
                        continue;
                    }
                    if keep(classify_plane(f, f.plane.point(s), other, other_solid)?) {
                        let plane = if flip { Plane { origin: f.plane.origin, n: scale(f.plane.n, -1.0), u: f.plane.u, v: f.plane.v } } else { f.plane.clone() };
                        out.push(Kept::Plane { plane, region });
                    }
                }
            }
            AFace::Cyl(f) => {
                let g = grid.as_ref().ok_or(())?;
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
                        let class = if ops::inside_solid(other_solid, p3) { Class::Inside } else { Class::Outside };
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

fn e2_curve(e: &E2, plane: &Plane) -> (Curve, Vec3, Vec3) {
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
            if e.is_full() {
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

fn build_result(kept: Vec<Kept>, vertex: VertexFn) -> Option<TSolid> {
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
                let (curve, pa, pb) = e2_curve(e, &plane);
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
fn core(op: &str, a: &TSolid, b: &TSolid, pa: &[AFace], pb: &[AFace]) -> Result<Option<TSolid>, ()> {
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
    let grid_of = |faces: &[AFace], other: &[AFace]| -> Result<Vec<Option<Grid>>, ()> {
        faces.iter().map(|f| if let AFace::Cyl(w) = f { wall_grid(w, other).map(Some) } else { Ok(None) }).collect()
    };
    let (ga, gb) = (grid_of(pa, pb)?, grid_of(pb, pa)?);
    let mut walls: Vec<(&CFace, &Grid)> = Vec::new();
    for (faces, grids) in [(pa, &ga), (pb, &gb)] {
        for (f, g) in faces.iter().zip(grids) {
            if let (AFace::Cyl(w), Some(g)) = (f, g) {
                walls.push((w, g));
            }
        }
    }
    let mut kept = pieces(pa, &ga, pb, b, ka.as_ref(), false, &walls, &mut vertex)?;
    kept.extend(pieces(pb, &gb, pa, a, kb.as_ref(), op == "subtract", &walls, &mut vertex)?);
    let Some(solid) = build_result(kept, &mut vertex) else {
        return Ok(None);
    };
    let mut faces = solid.faces();
    ops::drop_degenerate_faces(&mut faces);
    ops::weld_shared_edges(&mut faces);
    if faces.is_empty() {
        return Ok(None);
    }
    // Every edge is used by exactly two faces (a cylinder seam by the same
    // face twice), no exceptions.
    if ops::edge_use_counts(&faces).values().any(|&n| n != 2) || !ops::unmatched_once_edges(&faces).is_empty() {
        bail!();
    }
    let result = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    if !ops::volume_is_translation_invariant(&result) {
        bail!();
    }
    if !ops::boolean_result_is_sound(op, a, b, &result) {
        bail!();
    }
    Ok(Some(result))
}

fn volume_of(r: &Option<TSolid>) -> f64 {
    r.as_ref().map_or(0.0, build::solid_volume)
}

/// The planar boolean. Besides the structural guards, the answer must agree
/// with its partner operation by inclusion-exclusion
/// (V(A+B) + V(A*B) = V(A) + V(B); V(A-B) + V(A*B) = V(A)), which no
/// face-selection mistake survives unless it is made twice in step.
pub fn boolean_planar(op: &str, a: &TSolid, b: &TSolid) -> Outcome {
    let (Some(pa), Some(pb)) = (extract(a), extract(b)) else {
        return Outcome::NotPlanar;
    };
    let Ok(main) = core(op, a, b, &pa, &pb) else {
        return Outcome::Refused;
    };
    let Some(result) = main else {
        return Outcome::Refused;
    };
    let partner = if op == "union" { "intersect" } else if op == "intersect" { "union" } else { "intersect" };
    let Ok(other) = core(partner, a, b, &pa, &pb) else {
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

    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
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
}


