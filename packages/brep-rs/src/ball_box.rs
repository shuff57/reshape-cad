//! A ball against a box, at any orientation (SPEC-brep-ball-box.md): the geometry core.
//!
//! Everything here is in the ball's own frame (centre at the origin). A box is six half-spaces `n . p <= d` with unit outward
//! normals. The part of the sphere inside the box is bounded by arcs of the circles where the six planes cut the sphere,
//! joined at the points where a box edge meets the sphere. `region_loops` finds those loops, each as a dense polyline that
//! passes exactly through its corners and is traversed with the region on its left.

use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use std::f64::consts::{PI, TAU};

/// The half-space `n . p <= d`, `n` a unit outward normal.
#[derive(Clone, Copy, Debug)]
pub struct Half {
    pub n: Vec3,
    pub d: f64,
}

/// The six half-spaces of a box with orthonormal `axes`, centre `c` and half sizes `half`, in the ball's frame.
pub fn box_halves(c: Vec3, axes: [Vec3; 3], half: [f64; 3]) -> [Half; 6] {
    let mut out = [Half { n: [0.0; 3], d: 0.0 }; 6];
    for i in 0..3 {
        let s = dot(axes[i], c);
        out[2 * i] = Half { n: axes[i], d: s + half[i] };
        out[2 * i + 1] = Half { n: scale(axes[i], -1.0), d: -s + half[i] };
    }
    out
}

/// Whether `q` (on the sphere) is inside every half-space.
pub fn inside_all(halves: &[Half], q: Vec3) -> bool {
    halves.iter().all(|h| dot(h.n, q) <= h.d)
}

/// One circle where plane `i` cuts a sphere of radius `r`.
#[derive(Clone, Debug)]
pub struct Circle {
    pub c: Vec3,
    pub rho: f64,
    pub e1: Vec3,
    pub e2: Vec3,
    pub n: Vec3,
}

impl Circle {
    pub fn at(&self, t: f64) -> Vec3 {
        add(self.c, add(scale(self.e1, self.rho * t.cos()), scale(self.e2, self.rho * t.sin())))
    }
}

pub fn circle_of(h: &Half, r: f64) -> Option<Circle> {
    if h.d.abs() >= r {
        return None;
    }
    let n = h.n;
    let e1 = normalize(if n[0].abs() < 0.9 { cross(n, [1.0, 0.0, 0.0]) } else { cross(n, [0.0, 1.0, 0.0]) });
    Some(Circle { c: scale(n, h.d), rho: (r * r - h.d * h.d).sqrt(), e1, e2: cross(n, e1), n })
}

/// Intersect two sorted lists of disjoint intervals of [0, TAU].
fn intersect(a: &[(f64, f64)], b: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    for &(a0, a1) in a {
        for &(b0, b1) in b {
            let (lo, hi) = (a0.max(b0), a1.min(b1));
            if hi - lo > 1e-12 {
                out.push((lo, hi));
            }
        }
    }
    out.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
    out
}

/// The angles `t` of circle `ci` that lie inside half-space `h`, as intervals of [0, TAU]. `Err` for a plane tangent to the circle.
fn allowed_by(ci: &Circle, h: &Half) -> Result<Vec<(f64, f64)>, &'static str> {
    let a = ci.rho * dot(h.n, ci.e1);
    let b = ci.rho * dot(h.n, ci.e2);
    let k = h.d - dot(h.n, ci.c);
    let m = (a * a + b * b).sqrt();
    if m < 1e-12 * ci.rho.max(1.0) {
        return Ok(if k >= 0.0 { vec![(0.0, TAU)] } else { Vec::new() });
    }
    let q = k / m;
    if (q - 1.0).abs() < 1e-9 || (q + 1.0).abs() < 1e-9 {
        return Err("a box face is tangent to a circle of the ball");
    }
    if q > 1.0 {
        return Ok(vec![(0.0, TAU)]);
    }
    if q < -1.0 {
        return Ok(Vec::new());
    }
    let (al, g) = (b.atan2(a), q.acos());
    // cos(t - al) <= q  <=>  t - al in [g, TAU - g]
    let lo = (al + g).rem_euclid(TAU);
    let hi = lo + (TAU - 2.0 * g);
    if hi <= TAU {
        Ok(vec![(lo, hi)])
    } else {
        Ok(vec![(0.0, hi - TAU), (lo, TAU)])
    }
}

/// An arc of the boundary of the region, as the angles `from > to` on circle `plane`, traversed from `from` down to `to`
/// (decreasing angle: the region, which is inside the box, is on the left looking from outside the sphere).
#[derive(Clone, Copy, Debug)]
pub struct ArcRef {
    pub plane: usize,
    pub from: f64,
    pub to: f64,
}

/// The boundary of the part of a sphere inside a box.
#[derive(Clone, Debug)]
pub struct Region {
    pub r: f64,
    pub halves: Vec<Half>,
    pub circles: Vec<Option<Circle>>,
    /// Closed loops, each a chain of arcs, end to start.
    pub loops: Vec<Vec<ArcRef>>,
    /// Circles that lie wholly inside the box: a loop of their own, traversed from TAU down to 0.
    pub whole: Vec<usize>,
}

impl Region {
    pub fn is_boundaryless(&self) -> bool {
        self.loops.is_empty() && self.whole.is_empty()
    }
}

/// The boundary of the part of the sphere (radius `r`, centre the origin) inside `halves`. `Err` names a degenerate contact: a plane
/// tangent to the sphere or to one of the circles, or three circles through one point. When the result has no boundary the region
/// is empty or is the whole sphere (`inside_all` of any sphere point tells which).
pub fn region(r: f64, halves: &[Half]) -> Result<Region, &'static str> {
    let circles: Vec<Option<Circle>> = halves.iter().map(|h| circle_of(h, r)).collect();
    for h in halves {
        if (h.d.abs() - r).abs() < 1e-9 * r {
            return Err("a box face touches the ball at a single point");
        }
    }
    let mut arcs: Vec<ArcRef> = Vec::new();
    let mut whole: Vec<usize> = Vec::new();
    for (i, ci) in circles.iter().enumerate() {
        let Some(ci) = ci else { continue };
        let mut allowed = vec![(0.0, TAU)];
        for (j, h) in halves.iter().enumerate() {
            if j != i {
                allowed = intersect(&allowed, &allowed_by(ci, h)?);
            }
        }
        if allowed.is_empty() {
            continue;
        }
        if allowed.len() == 1 && allowed[0].0 <= 1e-12 && allowed[0].1 >= TAU - 1e-12 {
            whole.push(i);
            continue;
        }
        if allowed.len() > 1 && allowed[0].0 <= 1e-12 && allowed.last().unwrap().1 >= TAU - 1e-12 {
            let first = allowed.remove(0);
            let last = allowed.pop().unwrap();
            allowed.push((last.0, first.1 + TAU));
        }
        for (lo, hi) in allowed {
            arcs.push(ArcRef { plane: i, from: hi, to: lo });
        }
    }
    let tol = 1e-7 * r;
    let start_of = |a: &ArcRef| circles[a.plane].as_ref().unwrap().at(a.from);
    let end_of = |a: &ArcRef| circles[a.plane].as_ref().unwrap().at(a.to);
    let mut used = vec![false; arcs.len()];
    let mut loops: Vec<Vec<ArcRef>> = Vec::new();
    for s in 0..arcs.len() {
        if used[s] {
            continue;
        }
        let mut chain = Vec::new();
        let mut cur = s;
        loop {
            used[cur] = true;
            chain.push(arcs[cur]);
            let e = end_of(&arcs[cur]);
            let next: Vec<usize> = (0..arcs.len()).filter(|&k| len(sub(start_of(&arcs[k]), e)) < tol).collect();
            match next.as_slice() {
                [k] if *k == s => break,
                [k] if !used[*k] => cur = *k,
                [] => return Err("an arc of the ball's boundary does not meet another"),
                _ => return Err("more than two circles meet at one point of the sphere"),
            }
        }
        loops.push(chain);
    }
    Ok(Region { r, halves: halves.to_vec(), circles, loops, whole })
}

impl Region {
    /// The loops as dense closed polylines (no repeated closing point), arcs joined at their exact end points.
    pub fn polylines(&self, step: f64) -> Vec<Vec<Vec3>> {
        let sample = |a: &ArcRef| -> Vec<Vec3> {
            let ci = self.circles[a.plane].as_ref().unwrap();
            let n = ((ci.rho * (a.from - a.to) / step).ceil() as usize).max(2);
            (0..n).map(|k| ci.at(a.from - (a.from - a.to) * k as f64 / n as f64)).collect()
        };
        let mut out = Vec::new();
        for &i in &self.whole {
            out.push(sample(&ArcRef { plane: i, from: TAU, to: 0.0 }));
        }
        for l in &self.loops {
            out.push(l.iter().flat_map(|a| sample(a)).collect());
        }
        out
    }

    /// Every loop as a list of arcs, the whole circles included.
    fn all_loops(&self) -> Vec<Vec<ArcRef>> {
        let mut v: Vec<Vec<ArcRef>> = self.whole.iter().map(|&i| vec![ArcRef { plane: i, from: TAU, to: 0.0 }]).collect();
        v.extend(self.loops.iter().cloned());
        v
    }

    /// The number of connected pieces of the part of the sphere inside the box and of the part outside it, by Gauss-Bonnet on the loops:
    /// `A / R^2 + (boundary geodesic curvature) + (exterior angles) = 2 pi chi`, with `chi = 2 c - L` for `c` pieces and `L` loops. `None`
    /// when the Euler characteristic does not come out whole (a degenerate boundary).
    pub fn sphere_components(&self) -> Option<(usize, usize)> {
        let r = self.r;
        let l_count = self.loops.len() + self.whole.len();
        let mut kappa = 0.0;
        let mut theta = 0.0;
        for l in self.all_loops() {
            for (k, a) in l.iter().enumerate() {
                let ci = self.circles[a.plane].as_ref()?;
                // decreasing angle about n: clockwise about n, so the cap on the n side is on the RIGHT: curvature -d / (R rho) per length
                kappa += -(dot(ci.n, ci.c) / (r * ci.rho)) * ci.rho * (a.from - a.to);
                let b = &l[(k + 1) % l.len()];
                if l.len() == 1 && a.from - a.to > TAU - 1e-9 {
                    continue; // a whole circle has no corner
                }
                let (cb, cn) = (self.circles[b.plane].as_ref()?, ci);
                let tang = |c: &Circle, t: f64| scale(add(scale(c.e1, -t.sin()), scale(c.e2, t.cos())), -1.0);
                let (ta, tb) = (tang(cn, a.to), tang(cb, b.from));
                let p = normalize(cn.at(a.to));
                theta += dot(cross(ta, tb), p).atan2(dot(ta, tb));
            }
        }
        let area = self.area();
        let chi_in = (area / (r * r) + kappa + theta) / TAU;
        if (chi_in - chi_in.round()).abs() > 1e-6 {
            return None;
        }
        let chi_in = chi_in.round() as i64;
        let chi_out = 2 - chi_in;
        let comps = |chi: i64| -> Option<usize> {
            let c2 = chi + l_count as i64;
            if c2 < 0 || c2 % 2 != 0 {
                None
            } else {
                Some((c2 / 2) as usize)
            }
        };
        Some((comps(chi_in)?, comps(chi_out)?))
    }

    /// Points of the closed face whose bounding box is the face's: every arc's end points, the point of each arc that is extreme along a
    /// coordinate axis (if it lies on the arc), and the sphere's six axis points that belong to the face (`inside`: the region, else its
    /// complement). Exact; a sampled bound could fall short of the true extreme.
    pub fn extent_points(&self, inside: bool) -> Vec<Vec3> {
        let mut out = Vec::new();
        for l in self.all_loops() {
            for a in &l {
                let ci = self.circles[a.plane].as_ref().unwrap();
                out.push(ci.at(a.from));
                out.push(ci.at(a.to));
                for i in 0..3 {
                    let t0 = ci.e2[i].atan2(ci.e1[i]); // the maximum along axis i; +PI is the minimum
                    for t in [t0, t0 + PI] {
                        // t on the arc [to, from] modulo a turn
                        let rel = (a.from - t).rem_euclid(TAU);
                        if rel <= a.from - a.to {
                            out.push(ci.at(t));
                        }
                    }
                }
            }
        }
        for i in 0..3 {
            for sg in [1.0, -1.0] {
                let mut p = [0.0; 3];
                p[i] = sg * self.r;
                if inside_all(&self.halves, p) == inside {
                    out.push(p);
                }
            }
        }
        out
    }

    /// `int n dA` over the region (the vector area, `n` the outward normal), by Stokes: half the sum over the boundary of `r x dr`.
    /// Exact: each arc integrates in closed form.
    pub fn vector_area(&self) -> Vec3 {
        let mut acc = [0.0; 3];
        for l in self.all_loops() {
            for a in &l {
                let ci = self.circles[a.plane].as_ref().unwrap();
                let (u1, u0) = (sub(ci.at(a.to), ci.c), sub(ci.at(a.from), ci.c));
                let du = scale(sub(u1, u0), 1.0); // rho * (u(to) - u(from))
                let first = cross(ci.c, du);
                let second = scale(ci.n, ci.rho * ci.rho * (a.to - a.from));
                acc = add(acc, add(first, second));
            }
        }
        scale(acc, 0.5)
    }

    /// The area of a region that has a boundary. The divergence theorem with a field of divergence 1 whose only singularity is a point
    /// of the sphere that is not in the measured set, then a flux integral along the arcs (smooth, so Gauss-Legendre on short panels is
    /// exact to rounding). The side measured is the one whose complement has the roomier empty point, so the singularity is always far
    /// from every arc; the other side is `4 pi R^2` minus it.
    pub fn area(&self) -> f64 {
        let r = self.r;
        let total = 4.0 * PI * r * r;
        let polys = self.polylines(0.05 * r);
        let all: Vec<Vec3> = polys.iter().flatten().copied().collect();
        if all.is_empty() {
            return f64::NAN;
        }
        let n = 4000usize;
        let golden = PI * (3.0 - 5.0f64.sqrt());
        let mut best_out: Option<(Vec3, f64)> = None;
        let mut best_in: Option<(Vec3, f64)> = None;
        for k in 0..n {
            let z = 1.0 - 2.0 * (k as f64 + 0.5) / n as f64;
            let rho = (1.0 - z * z).sqrt();
            let q = [r * rho * (golden * k as f64).cos(), r * rho * (golden * k as f64).sin(), r * z];
            let d = all.iter().map(|p| len(sub(*p, q))).fold(f64::INFINITY, f64::min);
            let slot = if inside_all(&self.halves, q) { &mut best_in } else { &mut best_out };
            if slot.map_or(true, |(_, bd)| d > bd) {
                *slot = Some((q, d));
            }
        }
        let flux = |q: Vec3| -> f64 {
            let n_pole = scale(normalize(q), -1.0);
            self.all_loops().iter().flatten().map(|a| self.arc_flux(a, n_pole)).sum()
        };
        match (best_out, best_in) {
            (Some((q, d)), Some((_, di))) if d >= di => flux(q),
            (Some((q, _)), None) => flux(q),
            (_, Some((q, _))) => total + flux(q),
            (None, None) => f64::NAN,
        }
    }

    /// `int w . nu ds` along arc `a`, `w = R (cos(th) p - N) / (1 + cos(th))` (divergence 1, singular only at `-N`) and `nu` the outward
    /// conormal of the region on the arc's left.
    fn arc_flux(&self, a: &ArcRef, n_pole: Vec3) -> f64 {
        let ci = self.circles[a.plane].as_ref().unwrap();
        let r = self.r;
        let span = a.from - a.to;
        let panels = ((span / 0.15).ceil() as usize).max(1);
        // 16-point Gauss-Legendre on [-1, 1], as (node, weight) for the positive half
        const X: [f64; 8] = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
        const W: [f64; 8] = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
        let mut acc = 0.0;
        for k in 0..panels {
            let (t0, t1) = (a.from - span * k as f64 / panels as f64, a.from - span * (k + 1) as f64 / panels as f64);
            let (mid, half) = (0.5 * (t0 + t1), 0.5 * (t0 - t1));
            for g in 0..8 {
                for sg in [-1.0, 1.0] {
                    let t = mid + sg * X[g] * half;
                    let ph = scale(ci.at(t), 1.0 / r);
                    let cth = dot(ph, n_pole);
                    let w = scale(sub(scale(ph, cth), n_pole), r / (1.0 + cth));
                    // the travel direction is decreasing t: the unit tangent is -u'(t)
                    let tang = scale(add(scale(ci.e1, -t.sin()), scale(ci.e2, t.cos())), -1.0);
                    let nu = cross(tang, ph);
                    acc += W[g] * half * ci.rho * dot(w, nu);
                }
            }
        }
        acc
    }
}

/// Area of the disk of radius `rho` centred at the origin intersected with the rectangle `[y0, y1] x [z0, z1]`. Exact.
pub fn disk_rect_area(rho: f64, y0: f64, y1: f64, z0: f64, z1: f64) -> f64 {
    // Q(a, b): the area of the disk with y <= a and z <= b.
    let h = |y: f64| (rho * rho - y * y).max(0.0).sqrt();
    let prim = |y: f64| 0.5 * (y * h(y) + rho * rho * (y / rho).clamp(-1.0, 1.0).asin()); // int h dy
    let q = |a: f64, b: f64| -> f64 {
        let a = a.min(rho);
        if a <= -rho || b <= -rho {
            return 0.0;
        }
        if b >= rho {
            return 2.0 * (prim(a) - prim(-rho));
        }
        // |b| < rho: where h(y) > |b| (|y| < yb) the strip is b + h, elsewhere 2h (b > 0) or nothing (b < 0)
        let yb = (rho * rho - b * b).sqrt();
        let (lo, hi) = (-rho, a);
        let mut acc = 0.0;
        // the three ranges [-rho, -yb], [-yb, yb], [yb, rho]
        let seg = |s0: f64, s1: f64, f: &dyn Fn(f64, f64) -> f64| {
            let (u0, u1) = (s0.max(lo), s1.min(hi));
            if u1 > u0 {
                f(u0, u1)
            } else {
                0.0
            }
        };
        let outer = |u0: f64, u1: f64| if b > 0.0 { 2.0 * (prim(u1) - prim(u0)) } else { 0.0 };
        acc += seg(-rho, -yb, &outer);
        acc += seg(yb, rho, &outer);
        acc += seg(-yb, yb, &|u0, u1| b * (u1 - u0) + (prim(u1) - prim(u0)));
        acc
    };
    q(y1, z1) - q(y0, z1) - q(y1, z0) + q(y0, z0)
}

/// The volume of the ball (radius `r`, centre the origin) inside the box `halves`, by a numerical integral of exact cross-section
/// areas: it shares no algebra with the boundary representation. Accurate to about 1e-7 of the ball's volume.
pub fn overlap_volume(r: f64, centre: Vec3, axes: [Vec3; 3], half: [f64; 3]) -> f64 {
    // the ball's centre in the box's own frame
    let q = [-dot(axes[0], centre), -dot(axes[1], centre), -dot(axes[2], centre)];
    let (x0, x1) = ((-half[0]).max(q[0] - r), half[0].min(q[0] + r));
    if x1 <= x0 {
        return 0.0;
    }
    let (p0, p1) = (((x0 - q[0]) / r).clamp(-1.0, 1.0).asin(), ((x1 - q[0]) / r).clamp(-1.0, 1.0).asin());
    let panels = 4000usize;
    const X: [f64; 8] = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
    const W: [f64; 8] = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
    let mut acc = 0.0;
    for k in 0..panels {
        let (a, b) = (p0 + (p1 - p0) * k as f64 / panels as f64, p0 + (p1 - p0) * (k + 1) as f64 / panels as f64);
        let (mid, hw) = (0.5 * (a + b), 0.5 * (b - a));
        for g in 0..8 {
            for sg in [-1.0, 1.0] {
                let ph = mid + sg * X[g] * hw;
                let x = q[0] + r * ph.sin();
                let rho = r * ph.cos();
                // disk centred (q1, q2) in the box's y, z: shift the rectangle by it
                let area = disk_rect_area(rho, -half[1] - q[1], half[1] - q[1], -half[2] - q[2], half[2] - q[2]);
                let _ = x;
                acc += W[g] * hw * area * r * ph.cos();
            }
        }
    }
    acc
}


// ---------------------------------------------------------------------------
// The builder: a ball and a box as B-rep (S1, `keep`).
// ---------------------------------------------------------------------------

use crate::build::{TFace, TSolid};
use crate::geom::{Curve, HullTrim, Plane, SphTrim, SphereSurf, Surface};
use crate::topo::{self, Pcurve, Shell, Solid, Wire};
use std::cell::RefCell;
use std::rc::Rc;

/// A whole ball: one sphere face, untrimmed.
#[derive(Clone, Copy, Debug)]
pub struct BallSpec {
    pub c: Vec3,
    pub r: f64,
}

/// A box of any orientation: orthonormal right-handed axes, centre, half sizes.
#[derive(Clone, Copy, Debug)]
pub struct BoxSpec {
    pub c: Vec3,
    pub axes: [Vec3; 3],
    pub half: [f64; 3],
}

pub fn as_ball(s: &TSolid) -> Option<BallSpec> {
    let faces = s.faces();
    if faces.len() != 1 {
        return None;
    }
    let f = faces[0].borrow();
    let Surface::Sphere(sp) = &f.surface else { return None };
    if !sp.trim.is_none() || (sp.u_range[1] - sp.u_range[0] - TAU).abs() > 1e-9 || sp.v_range[0].abs() > 1e-9 || (sp.v_range[1] - PI).abs() > 1e-9 {
        return None;
    }
    Some(BallSpec { c: sp.center, r: sp.radius })
}

pub fn as_box(s: &TSolid) -> Option<BoxSpec> {
    let faces = s.faces();
    if faces.len() != 6 || s.shells.len() != 1 {
        return None;
    }
    let mut normals: Vec<Vec3> = Vec::new();
    for f in &faces {
        let fb = f.borrow();
        let Surface::Plane(p) = &fb.surface else { return None };
        let n = p.n;
        if !normals.iter().any(|m| len(cross(*m, n)) < 1e-9) {
            normals.push(normalize(n));
        }
    }
    if normals.len() != 3 {
        return None;
    }
    let mut axes = [normals[0], normals[1], normals[2]];
    for i in 0..3 {
        for j in (i + 1)..3 {
            if dot(axes[i], axes[j]).abs() > 1e-9 {
                return None;
            }
        }
    }
    if dot(cross(axes[0], axes[1]), axes[2]) < 0.0 {
        axes[2] = scale(axes[2], -1.0);
    }
    let verts = s.vertices();
    if verts.len() != 8 {
        return None;
    }
    let (mut centre, mut half) = ([0.0; 3], [0.0; 3]);
    for k in 0..3 {
        let proj: Vec<f64> = verts.iter().map(|v| dot(axes[k], v.borrow().point)).collect();
        let (lo, hi) = (proj.iter().cloned().fold(f64::INFINITY, f64::min), proj.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
        half[k] = 0.5 * (hi - lo);
        centre = add(centre, scale(axes[k], 0.5 * (hi + lo)));
    }
    if half.iter().any(|h| *h < 1e-9) {
        return None;
    }
    // exactly a cuboid: the volume of the solid is the volume of its box
    let v = crate::build::solid_volume(s);
    if (v - 8.0 * half[0] * half[1] * half[2]).abs() > 1e-9 * v {
        return None;
    }
    Some(BoxSpec { c: centre, axes, half })
}

/// One piece of a planar face's boundary, in the ball's frame, in the order the face traverses it.
enum Item {
    Seg(Vec3, Vec3),
    /// An arc of the plane's circle from one point to another; `ccw` says it turns counter-clockwise about the plane's outward normal.
    Arc { from: Vec3, to: Vec3, sweep: f64, ccw: bool },
    /// The whole circle, from its start point.
    Circle(Vec3, bool),
}

/// Where each edge of box face `i`'s rectangle meets the disk: `Some((lo, hi))`, the parameter range inside the disk, or `None` when
/// the edge never enters it. `Err` for a degenerate contact (an edge tangent to the circle, a corner on the sphere).
fn rect_edges(ci: &Circle, corners: &[Vec3; 4], r: f64) -> Result<[Option<(f64, f64)>; 4], &'static str> {
    let mut out = [None; 4];
    for j in 0..4 {
        let (p, q) = (corners[j], corners[(j + 1) % 4]);
        let d = sub(q, p);
        let w = sub(p, ci.c);
        let (a, b, c) = (dot(d, d), 2.0 * dot(d, w), dot(w, w) - ci.rho * ci.rho);
        let disc = b * b - 4.0 * a * c;
        if disc.abs() < 1e-12 * b * b.max(1.0) && c.abs() < 1e-3 * r * r {
            return Err("a box edge is tangent to the ball's circle");
        }
        if disc <= 0.0 {
            continue;
        }
        let sq = disc.sqrt();
        let (u0, u1) = ((-b - sq) / (2.0 * a), (-b + sq) / (2.0 * a));
        let (lo, hi) = (u0.max(0.0), u1.min(1.0));
        if hi - lo <= 1e-12 {
            continue;
        }
        for u in [u0, u1] {
            if u.abs() < 1e-9 || (u - 1.0).abs() < 1e-9 {
                return Err("a box corner lies on the sphere");
            }
        }
        out[j] = Some((lo, hi));
    }
    Ok(out)
}

/// The rectangle of box face `i` (counter-clockwise about its outward normal) and the circle where the ball's sphere cuts its plane.
fn rect_of(r: f64, halves: &[Half], bx: &BoxSpec, i: usize) -> Option<(Circle, [Vec3; 4], Vec3)> {
    let ci = circle_of(&halves[i], r)?;
    let (k, sgn) = (i / 2, if i % 2 == 0 { 1.0 } else { -1.0 });
    let (m, n) = ((k + 1) % 3, (k + 2) % 3);
    let rc = add(bx.c, scale(bx.axes[k], sgn * bx.half[k]));
    let signs: [(f64, f64); 4] = if sgn > 0.0 { [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] } else { [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)] };
    let c: Vec<Vec3> = signs.iter().map(|&(a, b)| add(rc, add(scale(bx.axes[m], a * bx.half[m]), scale(bx.axes[n], b * bx.half[n])))).collect();
    Some((ci, [c[0], c[1], c[2], c[3]], rc))
}

/// Whether the circle lies strictly inside the rectangle (no edge meets the disk, and the centre is within).
fn circle_inside_rect(ci: &Circle, bx: &BoxSpec, i: usize, rc: Vec3) -> bool {
    let k = i / 2;
    let (m, n) = ((k + 1) % 3, (k + 2) % 3);
    let off = sub(ci.c, rc);
    dot(bx.axes[m], off).abs() + ci.rho < bx.half[m] && dot(bx.axes[n], off).abs() + ci.rho < bx.half[n]
}

/// The boundary of the part of box face `i` INSIDE the ball (the rectangle intersected with the disk): one loop, counter-clockwise about
/// the face's outward normal. `Ok(None)`: no area.
fn inside_piece(r: f64, halves: &[Half], bx: &BoxSpec, i: usize) -> Result<Option<Vec<Item>>, &'static str> {
    let Some((ci, corners, rc)) = rect_of(r, halves, bx, i) else { return Ok(None) };
    let tol = 1e-9 * r;
    let ivs = rect_edges(&ci, &corners, r)?;
    let mut segs: Vec<(Vec3, Vec3)> = Vec::new();
    for j in 0..4 {
        if let Some((lo, hi)) = ivs[j] {
            let (p, d) = (corners[j], sub(corners[(j + 1) % 4], corners[j]));
            segs.push((add(p, scale(d, lo)), add(p, scale(d, hi))));
        }
    }
    if segs.is_empty() {
        return Ok(if circle_inside_rect(&ci, bx, i, rc) { Some(vec![Item::Circle(ci.at(0.0), true)]) } else { None });
    }
    let angle = |p: Vec3| dot(sub(p, ci.c), ci.e2).atan2(dot(sub(p, ci.c), ci.e1));
    let mut items = Vec::new();
    for j in 0..segs.len() {
        let (a, b) = segs[j];
        items.push(Item::Seg(a, b));
        let next = segs[(j + 1) % segs.len()].0;
        if len(sub(b, next)) > tol {
            let sweep = (angle(next) - angle(b)).rem_euclid(TAU);
            if sweep < 1e-9 {
                return Err("an arc of no length");
            }
            items.push(Item::Arc { from: b, to: next, sweep, ccw: true });
        }
    }
    Ok(Some(items))
}

/// One face's worth of boundary: an outer loop and at most one hole.
struct Piece {
    outer: Vec<Item>,
    hole: Option<Item>,
}

/// The parts of box face `i` OUTSIDE the ball (the rectangle minus the disk): each connected part's boundary is the rectangle's edge
/// stretches outside the disk, joined by arcs of the circle traversed clockwise about the face's normal (the part is on their left).
/// Those arcs are exactly the plane's region arcs, which `region` found already.
fn outside_pieces(rg: &Region, halves: &[Half], bx: &BoxSpec, i: usize) -> Result<Vec<Piece>, &'static str> {
    let r = rg.r;
    let Some((ci, corners, rc)) = rect_of(r, halves, bx, i) else {
        // the plane does not reach the ball: the whole rectangle
        let (k, sgn) = (i / 2, if i % 2 == 0 { 1.0 } else { -1.0 });
        let (m, n) = ((k + 1) % 3, (k + 2) % 3);
        let rc = add(bx.c, scale(bx.axes[k], sgn * bx.half[k]));
        let signs: [(f64, f64); 4] = if sgn > 0.0 { [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] } else { [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)] };
        let c: Vec<Vec3> = signs.iter().map(|&(a, b)| add(rc, add(scale(bx.axes[m], a * bx.half[m]), scale(bx.axes[n], b * bx.half[n])))).collect();
        return Ok(vec![Piece { outer: (0..4).map(|j| Item::Seg(c[j], c[(j + 1) % 4])).collect(), hole: None }]);
    };
    let tol = 1e-7 * r;
    let ivs = rect_edges(&ci, &corners, r)?;
    // directed pieces: (start, end, item)
    let mut pieces: Vec<(Vec3, Vec3, Item)> = Vec::new();
    for j in 0..4 {
        let (p, q) = (corners[j], corners[(j + 1) % 4]);
        let d = sub(q, p);
        match ivs[j] {
            None => pieces.push((p, q, Item::Seg(p, q))),
            Some((lo, hi)) => {
                if lo > 1e-12 {
                    let e = add(p, scale(d, lo));
                    pieces.push((p, e, Item::Seg(p, e)));
                }
                if hi < 1.0 - 1e-12 {
                    let s = add(p, scale(d, hi));
                    pieces.push((s, q, Item::Seg(s, q)));
                }
            }
        }
    }
    let mut hole = None;
    for l in rg.loops.iter() {
        for a in l.iter().filter(|a| a.plane == i) {
            let (pa, pb) = (ci.at(a.from), ci.at(a.to));
            // decreasing angle about n is clockwise about the face's outward normal
            pieces.push((pa, pb, Item::Arc { from: pa, to: pb, sweep: a.from - a.to, ccw: false }));
        }
    }
    if rg.whole.contains(&i) && circle_inside_rect(&ci, bx, i, rc) {
        hole = Some(Item::Circle(ci.at(0.0), false));
    }
    if pieces.iter().all(|(_, _, it)| matches!(it, Item::Arc { .. })) && hole.is_none() {
        return Ok(Vec::new()); // the rectangle is wholly inside the disk
    }
    let mut used = vec![false; pieces.len()];
    let mut chains: Vec<Vec<usize>> = Vec::new();
    for s in 0..pieces.len() {
        if used[s] {
            continue;
        }
        let mut chain: Vec<usize> = Vec::new();
        let mut cur = s;
        loop {
            used[cur] = true;
            chain.push(cur);
            let e = pieces[cur].1;
            let next: Vec<usize> = (0..pieces.len()).filter(|&k| len(sub(pieces[k].0, e)) < tol).collect();
            match next.as_slice() {
                [k] if *k == s => break,
                [k] if !used[*k] => cur = *k,
                _ => return Err("the pieces of a box face outside the ball do not close up"),
            }
        }
        chains.push(chain);
    }
    let mut items: Vec<Option<Item>> = pieces.into_iter().map(|(_, _, it)| Some(it)).collect();
    let mut out: Vec<Piece> = chains.into_iter().map(|ch| Piece { outer: ch.into_iter().filter_map(|k| items[k].take()).collect(), hole: None }).collect();
    if let Some(h) = hole {
        match out.first_mut() {
            Some(first) => first.hole = Some(h),
            None => return Err("a circle inside the rectangle with no rectangle around it"),
        }
    }
    Ok(out)
}

struct Verts(Vec<topo::VertexRef>, f64);
impl Verts {
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

fn pc(plane: &Plane, a: Vec3, b: Vec3, mid: Vec3) -> Pcurve {
    Pcurve { start: plane.project(a), end: plane.project(b), mid: plane.project(mid) }
}

/// A wire of edge uses from items, in world coordinates; `n` is the face's outward normal for the plane's circle.
fn wire_of(r: f64, ci: &Circle, plane: &Plane, items: &[Item], o: Vec3, verts: &mut Verts) -> Vec<topo::EdgeUse<Curve>> {
    let w = |p: Vec3| add(p, o);
    let mut uses = Vec::new();
    for it in items {
        let (va, vb, curve) = match it {
            Item::Seg(a, b) => (verts.at(w(*a)), verts.at(w(*b)), Curve::Segment { a: w(*a), b: w(*b) }),
            Item::Arc { from, to, sweep, ccw } => (
                verts.at(w(*from)),
                verts.at(w(*to)),
                Curve::Arc { center: w(ci.c), radius: ci.rho, normal: if *ccw { ci.n } else { scale(ci.n, -1.0) }, x_axis: normalize(sub(*from, ci.c)), sweep: *sweep },
            ),
            Item::Circle(a, ccw) => {
                let va = verts.at(w(*a));
                (va.clone(), va, Curve::Arc { center: w(ci.c), radius: ci.rho, normal: if *ccw { ci.n } else { scale(ci.n, -1.0) }, x_axis: normalize(sub(*a, ci.c)), sweep: TAU })
            }
        };
        let (pa, pb) = (va.borrow().point, vb.borrow().point);
        let mid = curve.point_at(0.5);
        uses.push(topo::EdgeUse { edge: topo::edge(va, vb, true, curve), forward: true, pcurve: pc(plane, pa, pb, mid) });
    }
    uses
}

/// The planar face of box face `i` from one piece. `flip`: the face's normal is the box's INWARD one (the wall of a cut), in which
/// case the piece's items must already be traversed counter-clockwise about that inward normal.
fn planar_face(r: f64, halves: &[Half], i: usize, piece: &Piece, o: Vec3, flip: bool) -> Option<TFace> {
    let ci = circle_of(&halves[i], r)?;
    let normal = if flip { scale(halves[i].n, -1.0) } else { halves[i].n };
    let plane = Plane::new(add(ci.c, o), normal);
    let mut verts = Verts(Vec::new(), 1e-9 * r);
    let mut wires = Vec::new();
    // Items carry `ccw` relative to the OUTWARD normal, so the circle is passed unflipped; only the plane's normal turns.
    wires.push(wire_of(r, &ci, &plane, &piece.outer, o, &mut verts));
    if let Some(h) = &piece.hole {
        wires.push(wire_of(r, &ci, &plane, std::slice::from_ref(h), o, &mut verts));
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for wr in &wires {
        for u in wr {
            for q in [u.pcurve.start, u.pcurve.end, u.pcurve.mid] {
                for k in 0..2 {
                    lo[k] = lo[k].min(q[k]);
                    hi[k] = hi[k].max(q[k]);
                }
            }
        }
    }
    let boundary = wires.into_iter().map(|uses| Rc::new(RefCell::new(Wire { edges: uses }))).collect();
    Some(Rc::new(RefCell::new(topo::Face { boundary, forward: true, surface: Surface::Plane(plane), uv_domain: [[lo[0], hi[0]], [lo[1], hi[1]]] })))
}

/// The same piece traversed the other way round (clockwise about the outward normal becomes counter-clockwise about the inward one).
fn reversed_piece(p: &Piece) -> Piece {
    let rev = |items: &[Item]| -> Vec<Item> {
        items
            .iter()
            .rev()
            .map(|it| match it {
                Item::Seg(a, b) => Item::Seg(*b, *a),
                Item::Arc { from, to, sweep, ccw } => Item::Arc { from: *to, to: *from, sweep: *sweep, ccw: !*ccw },
                Item::Circle(a, ccw) => Item::Circle(*a, !*ccw),
            })
            .collect()
    };
    Piece { outer: rev(&p.outer), hole: p.hole.as_ref().map(|h| rev(std::slice::from_ref(h)).remove(0)) }
}

/// The sphere face: one wire per loop of the region. `region_side`: the face is the part inside the box (`true`) or outside it;
/// `reversed`: its normal points into the sphere. The loops run with the face's material on the left of ITS normal.
fn sphere_face(rg: &Region, halves: &[Half], o: Vec3, region_side: bool, reversed: bool) -> Option<TFace> {
    let r = rg.r;
    let w = |p: Vec3| add(p, o);
    // Inside the box with the outward normal runs with t decreasing; flipping either the side or the normal turns it round (flipping
    // both turns it back).
    let decreasing = region_side != reversed;
    let mut wires = Vec::new();
    let mut all: Vec<Vec<ArcRef>> = rg.whole.iter().map(|&i| vec![ArcRef { plane: i, from: TAU, to: 0.0 }]).collect();
    all.extend(rg.loops.iter().cloned());
    for l in &all {
        let mut verts = Verts(Vec::new(), 1e-9 * r);
        let mut uses = Vec::new();
        let order: Vec<ArcRef> = if decreasing { l.clone() } else { l.iter().rev().map(|a| ArcRef { plane: a.plane, from: a.to, to: a.from }).collect() };
        for a in &order {
            let ci = rg.circles[a.plane].as_ref()?;
            let (pa, pb) = (ci.at(a.from), ci.at(a.to));
            let (va, vb) = (verts.at(w(pa)), verts.at(w(pb)));
            // a decreasing angle about n is counter-clockwise about -n; an increasing one is counter-clockwise about n
            let (normal, sweep) = if a.from > a.to { (scale(ci.n, -1.0), a.from - a.to) } else { (ci.n, a.to - a.from) };
            let curve = Curve::Arc { center: w(ci.c), radius: ci.rho, normal, x_axis: normalize(sub(pa, ci.c)), sweep };
            uses.push(topo::EdgeUse { edge: topo::edge(va, vb, true, curve), forward: true, pcurve: Pcurve { start: [0.0; 2], end: [0.0; 2], mid: [0.0; 2] } });
        }
        wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
    }
    let mut planes = [[0.0; 4]; 6];
    for (k, h) in halves.iter().enumerate().take(6) {
        planes[k] = [h.n[0], h.n[1], h.n[2], h.d];
    }
    let e1 = normalize(cross([0.0, 0.0, 1.0], [1.0, 0.0, 0.0]));
    let sp = SphereSurf {
        center: o,
        radius: r,
        axis: [0.0, 0.0, 1.0],
        e1,
        e2: cross([0.0, 0.0, 1.0], e1),
        u_range: [0.0, TAU],
        v_range: [0.0, PI],
        trim: SphTrim::Hull(HullTrim { n: halves.len().min(6) as u8, planes, inside: region_side, reversed }),
    };
    Some(Rc::new(RefCell::new(topo::Face { boundary: wires, forward: true, surface: Surface::Sphere(sp), uv_domain: [[0.0, TAU], [0.0, PI]] })))
}

/// How many separate lumps the faces make (faces joined through shared edge handles). `split_sphere`: the hull sphere face is several
/// pieces, one per boundary wire, so each wire is a node of its own.
fn lump_count(faces: &[TFace], split_sphere: bool) -> usize {
    // node ids: one per face, and for a split sphere face one per wire
    let mut node_of: Vec<Vec<usize>> = Vec::new();
    let mut next = 0usize;
    for f in faces {
        let fb = f.borrow();
        let split = split_sphere && matches!(&fb.surface, Surface::Sphere(sp) if sp.trim.is_hull());
        let nodes: Vec<usize> = if split { fb.boundary.iter().map(|_| { next += 1; next - 1 }).collect() } else { next += 1; vec![next - 1; fb.boundary.len().max(1)] };
        node_of.push(nodes);
    }
    let mut parent: Vec<usize> = (0..next).collect();
    fn find(p: &mut Vec<usize>, x: usize) -> usize {
        let mut r = x;
        while p[r] != r {
            r = p[r];
        }
        let mut c = x;
        while p[c] != r {
            let n = p[c];
            p[c] = r;
            c = n;
        }
        r
    }
    let mut seen: Vec<(topo::EdgeRef<Curve>, usize)> = Vec::new();
    for (fi, f) in faces.iter().enumerate() {
        for (wi, w) in f.borrow().boundary.iter().enumerate() {
            let node = node_of[fi][wi];
            for u in &w.borrow().edges {
                if let Some((_, other)) = seen.iter().find(|(e, _)| topo::same(e, &u.edge)) {
                    let (a, b) = (find(&mut parent, node), find(&mut parent, *other));
                    parent[a] = b;
                } else {
                    seen.push((u.edge.clone(), node));
                }
            }
        }
    }
    (0..next).filter(|&i| find(&mut parent, i) == i).count()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    /// ball AND box
    Keep,
    /// ball minus box
    CutBall,
    /// ball OR box
    Join,
    /// box minus ball
    CutBox,
}

/// A ball and a box as one solid, by `mode`. `None` when the pair is not a clean crossing: no boundary (one inside the other, or apart),
/// a degenerate contact, a result in more than one lump, or one the checks below cannot vouch for.
pub fn assemble(ball: &BallSpec, bx: &BoxSpec, mode: Mode) -> Option<TSolid> {
    let r = ball.r;
    let c = sub(bx.c, ball.c);
    let halves = box_halves(c, bx.axes, bx.half);
    let rg = region(r, &halves).ok()?;
    if rg.is_boundaryless() {
        return None;
    }
    let bxl = BoxSpec { c, axes: bx.axes, half: bx.half };
    let mut faces: Vec<TFace> = Vec::new();
    for i in 0..6 {
        match mode {
            Mode::Keep | Mode::CutBall => {
                if let Some(items) = inside_piece(r, &halves, &bxl, i).ok()? {
                    let piece = Piece { outer: items, hole: None };
                    faces.push(if mode == Mode::Keep { planar_face(r, &halves, i, &piece, ball.c, false)? } else { planar_face(r, &halves, i, &reversed_piece(&piece), ball.c, true)? });
                }
            }
            Mode::Join | Mode::CutBox => {
                for piece in outside_pieces(&rg, &halves, &bxl, i).ok()? {
                    if circle_of(&halves[i], r).is_some() {
                        faces.push(planar_face(r, &halves, i, &piece, ball.c, false)?);
                    } else {
                        // a plane that misses the sphere: the whole rectangle, built on any circle-free frame
                        faces.push(rect_face(&halves, &bxl, i, ball.c, r)?);
                    }
                }
            }
        }
    }
    let (region_side, reversed) = match mode {
        Mode::Keep => (true, false),
        Mode::CutBall | Mode::Join => (false, false),
        Mode::CutBox => (true, true),
    };
    faces.push(sphere_face(&rg, &halves, ball.c, region_side, reversed)?);
    crate::ops::drop_degenerate_faces(&mut faces);
    crate::ops::split_t_junctions(&mut faces);
    crate::ops::weld_shared_edges(&mut faces);
    if crate::ops::edge_use_counts(&faces).values().any(|&n| n != 2) || !crate::ops::unmatched_once_edges(&faces).is_empty() {
        return None;
    }
    // The sphere face may be several pieces (a slab through the ball leaves two caps), which the shared-edge graph cannot see: count its
    // pieces from the loops.
    let l_count = rg.loops.len() + rg.whole.len();
    let (c_in, c_out) = rg.sphere_components()?;
    let pieces = if region_side { c_in } else { c_out };
    if pieces != 1 && pieces != l_count {
        return None;
    }
    if lump_count(&faces, pieces == l_count && l_count > 1) != 1 {
        return None;
    }
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    let v_in = overlap_volume(r, c, bx.axes, bx.half);
    let (v_ball, v_box) = (4.0 / 3.0 * PI * r * r * r, 8.0 * bx.half[0] * bx.half[1] * bx.half[2]);
    let want = match mode {
        Mode::Keep => v_in,
        Mode::CutBall => v_ball - v_in,
        Mode::Join => v_ball + v_box - v_in,
        Mode::CutBox => v_box - v_in,
    };
    let got = crate::build::solid_volume(&solid);
    if !got.is_finite() || (got - want).abs() > 1e-7 * v_ball.max(v_box) {
        return None;
    }
    if !crate::ops::volume_is_translation_invariant(&solid) || !crate::ops::mesh_is_closed_coarse(&solid) {
        return None;
    }
    Some(solid)
}

/// A whole rectangle face of the box (a plane that misses the ball), with no circle.
fn rect_face(halves: &[Half], bx: &BoxSpec, i: usize, o: Vec3, r: f64) -> Option<TFace> {
    let (k, sgn) = (i / 2, if i % 2 == 0 { 1.0 } else { -1.0 });
    let (m, n) = ((k + 1) % 3, (k + 2) % 3);
    let rc = add(bx.c, scale(bx.axes[k], sgn * bx.half[k]));
    let signs: [(f64, f64); 4] = if sgn > 0.0 { [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] } else { [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)] };
    let c: Vec<Vec3> = signs.iter().map(|&(a, b)| add(rc, add(scale(bx.axes[m], a * bx.half[m]), scale(bx.axes[n], b * bx.half[n])))).collect();
    let plane = Plane::new(add(rc, o), halves[i].n);
    let mut verts = Verts(Vec::new(), 1e-9 * r);
    let mut uses = Vec::new();
    for j in 0..4 {
        let (a, b) = (add(c[j], o), add(c[(j + 1) % 4], o));
        let (va, vb) = (verts.at(a), verts.at(b));
        let curve = Curve::Segment { a, b };
        let mid = curve.point_at(0.5);
        uses.push(topo::EdgeUse { edge: topo::edge(va, vb, true, curve), forward: true, pcurve: pc(&plane, a, b, mid) });
    }
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for u in &uses {
        for q in [u.pcurve.start, u.pcurve.end, u.pcurve.mid] {
            for k in 0..2 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
    }
    Some(crate::build::make_face(Surface::Plane(plane), [[lo[0], hi[0]], [lo[1], hi[1]]], uses))
}

/// `ball AND box` as a solid (S1).
pub fn keep(ball: &BallSpec, bx: &BoxSpec) -> Option<TSolid> {
    assemble(ball, bx, Mode::Keep)
}

/// Two balls that cross, as one solid by `mode` (`Keep`, `CutBall` = a minus b, `Join`, `CutBox` = b minus a). Two spheres meet in ONE
/// circle, in their radical plane, so each ball's face is a hull of one half-space (the side of that plane) and the two faces share
/// the circle. `None` for nested, apart, tangent or concentric balls (no crossing circle), or when a check below fails.
pub fn ball_ball(a: &BallSpec, b: &BallSpec, mode: Mode) -> Option<TSolid> {
    let off = sub(b.c, a.c);
    let d = len(off);
    if d < 1e-9 * a.r.max(b.r) {
        return None;
    }
    let u = scale(off, 1.0 / d);
    // the radical plane, as a distance from each centre toward the other
    let (ta, tb) = ((d * d + a.r * a.r - b.r * b.r) / (2.0 * d), (d * d + b.r * b.r - a.r * a.r) / (2.0 * d));
    // a's part inside b: dot(u, q) >= ta, i.e. dot(-u, q) <= -ta; b's part inside a, toward -u from b's centre
    let (ha, hb) = (Half { n: scale(u, -1.0), d: -ta }, Half { n: u, d: -tb });
    let (mut ra, mut rb) = (region(a.r, &[ha]).ok()?, region(b.r, &[hb]).ok()?);
    if ra.whole != [0] || rb.whole != [0] {
        return None;
    }
    // one seam for both faces, so the circle's edge is one edge: any direction square to u
    let e1 = normalize(if u[0].abs() < 0.9 { cross(u, [1.0, 0.0, 0.0]) } else { cross(u, [0.0, 1.0, 0.0]) });
    for rg in [&mut ra, &mut rb] {
        let ci = rg.circles[0].as_mut()?;
        ci.e1 = e1;
        ci.e2 = cross(ci.n, e1);
    }
    // (a's side, a's normal reversed, b's side, b's normal reversed): `true` = the part inside the other ball
    let (a_in, a_rev, b_in, b_rev) = match mode {
        Mode::Keep => (true, false, true, false),
        Mode::CutBall => (false, false, true, true),
        Mode::Join => (false, false, false, false),
        Mode::CutBox => (true, true, false, false),
    };
    let faces = vec![sphere_face(&ra, &[ha], a.c, a_in, a_rev)?, sphere_face(&rb, &[hb], b.c, b_in, b_rev)?];
    let mut faces = faces;
    crate::ops::weld_shared_edges(&mut faces);
    if crate::ops::edge_use_counts(&faces).values().any(|&n| n != 2) || !crate::ops::unmatched_once_edges(&faces).is_empty() {
        return None;
    }
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    let (va, vb) = (4.0 / 3.0 * PI * a.r.powi(3), 4.0 / 3.0 * PI * b.r.powi(3));
    let v_in = lens_volume(a.r, b.r, d);
    let want = match mode {
        Mode::Keep => v_in,
        Mode::CutBall => va - v_in,
        Mode::Join => va + vb - v_in,
        Mode::CutBox => vb - v_in,
    };
    let got = crate::build::solid_volume(&solid);
    if !got.is_finite() || (got - want).abs() > 1e-7 * va.max(vb) {
        return None;
    }
    if !crate::ops::volume_is_translation_invariant(&solid) || !crate::ops::mesh_is_closed_coarse(&solid) {
        return None;
    }
    Some(solid)
}

/// Whether one of the two is a whole ball and the other a ball, a plain cylinder or a cuboid that stays clear of it by more than a
/// hair: exact, from the centre's distance to the other solid (their bounding boxes may still overlap, a ball beside a cylinder
/// leans into its corner). `false` when unsure.
pub fn provably_apart(a: &TSolid, b: &TSolid) -> bool {
    let one = |ball: &TSolid, other: &TSolid| -> bool {
        let Some(bl) = as_ball(ball) else { return false };
        let gap = |dist: f64| dist > bl.r + 1e-7 * bl.r.max(1.0);
        if let Some(o) = as_ball(other) {
            return gap(len(sub(o.c, bl.c)) - o.r);
        }
        if let Some((wall, p, q, _, _)) = crate::ops::cylinder_parts(other) {
            let (axis, h) = (sub(q, p), len(sub(q, p)));
            if h < 1e-12 {
                return false;
            }
            let u = scale(axis, 1.0 / h);
            let v = sub(bl.c, p);
            let t = dot(v, u);
            let radial = len(sub(v, scale(u, t)));
            return gap(((radial - wall.radius).max(0.0)).hypot((-t).max(t - h).max(0.0)));
        }
        if let Some(bx) = as_box(other) {
            let v = sub(bl.c, bx.c);
            let ex: f64 = (0..3).map(|k| (dot(v, bx.axes[k]).abs() - bx.half[k]).max(0.0).powi(2)).sum();
            return gap(ex.sqrt());
        }
        false
    };
    one(a, b) || one(b, a)
}

/// The volume two balls of radii `r1`, `r2` share when their centres are `d` apart and their surfaces cross (closed form).
pub fn lens_volume(r1: f64, r2: f64, d: f64) -> f64 {
    let s = r1 + r2 - d;
    PI * s * s * (d * d + 2.0 * d * r2 - 3.0 * r2 * r2 + 2.0 * d * r1 + 6.0 * r1 * r2 - 3.0 * r1 * r1) / (12.0 * d)
}

/// The boolean entry: a whole ball against a cuboid, in either order (or against another ball).
pub fn ball_box_boolean(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if let (Some(x), Some(y)) = (as_ball(a), as_ball(b)) {
        let mode = match op {
            "intersect" => Mode::Keep,
            "union" => Mode::Join,
            "subtract" => Mode::CutBall,
            _ => return None,
        };
        return ball_ball(&x, &y, mode);
    }
    let (ball, bx, ball_first) = match (as_ball(a), as_box(b)) {
        (Some(x), Some(y)) => (x, y, true),
        _ => match (as_box(a), as_ball(b)) {
            (Some(y), Some(x)) => (x, y, false),
            _ => return None,
        },
    };
    let mode = match (op, ball_first) {
        ("intersect", _) => Mode::Keep,
        ("union", _) => Mode::Join,
        ("subtract", true) => Mode::CutBall,
        ("subtract", false) => Mode::CutBox,
        _ => return None,
    };
    assemble(&ball, &bx, mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sphere_hull::sphere_with_holes_scattered;
    use std::f64::consts::PI;

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

    fn random_axes(rng: &mut Rng) -> [Vec3; 3] {
        let a = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
        let t = normalize(cross(a, [rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]));
        [a, t, cross(a, t)]
    }

    /// The area of the part of a sphere inside the half-spaces, by a Fibonacci lattice: no algebra shared with the loops.
    fn lattice_area(r: f64, halves: &[Half]) -> f64 {
        let n = 1_500_000usize;
        let golden = PI * (3.0 - 5.0f64.sqrt());
        let mut hit = 0usize;
        for k in 0..n {
            let z = 1.0 - 2.0 * (k as f64 + 0.5) / n as f64;
            let rho = (1.0 - z * z).sqrt();
            let p = [r * rho * (golden * k as f64).cos(), r * rho * (golden * k as f64).sin(), r * z];
            if inside_all(halves, p) {
                hit += 1;
            }
        }
        4.0 * PI * r * r * hit as f64 / n as f64
    }

    fn tri_area(t: &[Vec3; 3]) -> f64 {
        0.5 * len(cross(sub(t[1], t[0]), sub(t[2], t[0])))
    }

    /// P0 (the stop rule of the spec): the hull mesher closes a region whose boundary loops have CORNERS. Random boxes in random
    /// orientations; every non-degenerate one that leaves a proper part of the sphere must mesh, conforming and close in area to
    /// the lattice oracle, both for the part inside the box and for the part outside it.
    #[test]
    fn p0_the_hull_mesher_closes_loops_with_corners() {
        let r = 10.0;
        let mut rng = Rng(7);
        let (mut tried, mut proper, mut meshed, mut refused_geom) = (0, 0, 0, 0);
        let mut failures: Vec<String> = Vec::new();
        for _ in 0..120 {
            tried += 1;
            let axes = random_axes(&mut rng);
            let half = [rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r];
            let c = [rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r];
            let halves = box_halves(c, axes, half);
            let loops = match region(r, &halves) {
                Ok(rg) if !rg.is_boundaryless() => rg.polylines(0.5),
                Ok(_) => continue,
                Err(_) => {
                    refused_geom += 1;
                    continue;
                }
            };
            proper += 1;
            let want_in = lattice_area(r, &halves);
            for keep_inside in [true, false] {
                let in_hole = |q: Vec3| inside_all(&halves, q) != keep_inside;
                let want = if keep_inside { want_in } else { 4.0 * PI * r * r - want_in };
                // the loops are traversed with the box's inside on the left, so for the outside part the same polylines bound it
                match sphere_with_holes_scattered([0.0; 3], r, &loops, &in_hole, 1.2, true, &[]) {
                    Some(tris) => {
                        meshed += 1;
                        let area: f64 = tris.iter().map(tri_area).sum();
                        if (area - want).abs() > 0.03 * want.max(1.0) {
                            failures.push(format!("area {area} vs {want} (inside={keep_inside}) box c={c:?} half={half:?}"));
                        }
                    }
                    None => failures.push(format!("no mesh (inside={keep_inside}) box c={c:?} half={half:?} loops={}", loops.len())),
                }
            }
        }
        let cnt = |pat: &str| failures.iter().filter(|f| f.contains(pat)).count();
        eprintln!("P0 breakdown: no-mesh inside=true {}, no-mesh inside=false {}, area inside=true {}, area inside=false {}", cnt("no mesh (inside=true"), cnt("no mesh (inside=false"), cnt("area") - failures.iter().filter(|f| f.starts_with("area") && f.contains("inside=false")).count(), failures.iter().filter(|f| f.starts_with("area") && f.contains("inside=false")).count());
        eprintln!("P0: tried {tried}, degenerate {refused_geom}, with a boundary {proper}, meshed {meshed}, failures {}", failures.len());
        for f in failures.iter().take(8) {
            eprintln!("  {f}");
        }
        assert!(proper >= 20, "the sample must exercise the mesher");
        assert!(failures.is_empty(), "{} failures", failures.len());
    }

    /// The planar part of the boundary: the area of face `i` inside the ball.
    fn face_area(r: f64, halves: &[Half], centre: Vec3, axes: [Vec3; 3], half: [f64; 3], i: usize) -> f64 {
        let Some(ci) = circle_of(&halves[i], r) else { return 0.0 };
        let (k, sgn) = (i / 2, if i % 2 == 0 { 1.0 } else { -1.0 });
        let rect_c = add(centre, scale(axes[k], sgn * half[k]));
        let (m, n) = ((k + 1) % 3, (k + 2) % 3);
        let off = sub(ci.c, rect_c);
        let (dm, dn) = (dot(axes[m], off), dot(axes[n], off));
        disk_rect_area(ci.rho, -half[m] - dm, half[m] - dm, -half[n] - dn, half[n] - dn)
    }

    /// The decisive check of the geometry: the volume assembled from the EXACT face areas (the planar pieces by the closed form, the
    /// sphere part by the flux integral) equals the independent numerical overlap integral, over random boxes at random orientations.
    #[test]
    fn s1_the_exact_face_areas_assemble_the_overlap_volume() {
        let r = 10.0;
        let mut rng = Rng(11);
        let (mut checked, mut worst) = (0, 0.0f64);
        for _ in 0..150 {
            let axes = random_axes(&mut rng);
            let half = [rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r];
            let c = [rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r];
            let halves = box_halves(c, axes, half);
            let Ok(rg) = region(r, &halves) else { continue };
            if rg.is_boundaryless() {
                continue;
            }
            let a_s = rg.area();
            let planar: f64 = (0..6).map(|i| face_area(r, &halves, c, axes, half, i) * halves[i].d).sum();
            let v = (planar + r * a_s) / 3.0;
            let want = overlap_volume(r, c, axes, half);
            let vball = 4.0 / 3.0 * PI * r * r * r;
            let err = (v - want).abs() / vball;
            worst = worst.max(err);
            checked += 1;
            assert!(err < 2e-6, "volume {v} vs oracle {want} (err {err:.2e}) box c={c:?} half={half:?}");
            // the vector area closes the same identity: the whole-sphere average of the normal is zero, so for the
            // complement it is minus this one; check the region's own is inside the area bound
            assert!(len(rg.vector_area()) <= a_s * (1.0 + 1e-9), "|int n dA| <= area");
            assert!((a_s - lattice_area(r, &halves)).abs() < 0.01 * 4.0 * PI * r * r, "area against the lattice");
        }
        eprintln!("S1 geometry: {checked} boxes checked, worst volume error {worst:.2e} of the ball");
        assert!(checked >= 40);
    }

    /// The centroid-bearing identity: for a ball wholly inside the box nothing is cut; a box wholly inside leaves no sphere.
    #[test]
    fn s1_disk_rect_area_matches_simple_cases() {
        let pi = PI;
        assert!((disk_rect_area(2.0, -10.0, 10.0, -10.0, 10.0) - pi * 4.0).abs() < 1e-12, "disk inside the rectangle");
        assert!(disk_rect_area(2.0, 5.0, 9.0, -1.0, 1.0).abs() < 1e-12, "rectangle clear of the disk");
        assert!((disk_rect_area(2.0, -0.5, 0.5, -0.5, 0.5) - 1.0).abs() < 1e-12, "rectangle inside the disk");
        assert!((disk_rect_area(3.0, 0.0, 9.0, -9.0, 9.0) - pi * 4.5).abs() < 1e-12, "a half disk");
        assert!((disk_rect_area(3.0, 0.0, 9.0, 0.0, 9.0) - pi * 9.0 / 4.0).abs() < 1e-12, "a quarter");
    }

    /// A rotated, moved box as a kernel solid.
    fn box_solid_at(c: Vec3, axes: [Vec3; 3], half: [f64; 3]) -> TSolid {
        let b = crate::build::box_solid([2.0 * half[0], 2.0 * half[1], 2.0 * half[2]], [0.0; 3], None);
        let m = [[axes[0][0], axes[1][0], axes[2][0]], [axes[0][1], axes[1][1], axes[2][1]], [axes[0][2], axes[1][2], axes[2][2]]];
        crate::build::transform_solid(&b, &crate::math::Transform { m, t: c })
    }

    /// S1 end to end through the public boolean: a ball and a box at random orientations. Every build equals the numerical overlap volume
    /// (the solid's own volume comes from the exact faces), is a closed mesh, and the pair is refused only when the contact is degenerate.
    #[test]
    fn s1_keep_ball_and_box_builds_the_exact_overlap() {
        let r = 10.0;
        let mut rng = Rng(23);
        let (mut with_boundary, mut built, mut worst) = (0, 0, 0.0f64);
        let mut misses: Vec<String> = Vec::new();
        for _ in 0..80 {
            let axes = random_axes(&mut rng);
            let half = [rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r];
            let ball_c = [rng.range(-5.0, 5.0), rng.range(-5.0, 5.0), rng.range(-5.0, 5.0)];
            let rel = [rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r];
            let bc = add(ball_c, rel);
            let halves = box_halves(rel, axes, half);
            let Ok(rg) = region(r, &halves) else { continue };
            if rg.is_boundaryless() {
                continue;
            }
            with_boundary += 1;
            let ball = crate::build::sphere_solid(ball_c, r, [0.0, 0.0, 1.0]);
            let bx = box_solid_at(bc, axes, half);
            match crate::ops::boolean("intersect", &ball, &bx) {
                Some(res) => {
                    built += 1;
                    let want = overlap_volume(r, rel, axes, half);
                    let got = crate::build::solid_volume(&res);
                    let vball = 4.0 / 3.0 * PI * r * r * r;
                    worst = worst.max((got - want).abs() / vball);
                    assert!((got - want).abs() < 1e-6 * vball, "volume {got} vs {want} for box c={rel:?} half={half:?}");
                    assert!(crate::ops::mesh_is_closed_coarse(&res), "the mesh is closed");
                    // the mesh reaches the analytic bounding box (the sphere's own extreme points are in it)
                    let bbm = crate::build::solid_aabb(&res);
                    let diag = len(sub(bbm.hi, bbm.lo));
                    let m = match crate::mesh::mesh_solid(&res, 0.003 * diag) {
                        Some(m) => m,
                        None => {
                            let tried: Vec<bool> = [0.003, 0.002, 0.001, 0.0005, 0.0003].iter().map(|k| crate::mesh::mesh_solid(&res, k * diag).is_some()).collect();
                            panic!("does not mesh at 0.003 diag ({diag}); at 0.003/0.002/0.001/0.0005/0.0003: {tried:?}; box c={rel:?} half={half:?}")
                        }
                    };
                    for k in 0..3 {
                        let (lo, hi) = m.positions.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), p| (l.min(p[k]), h.max(p[k])));
                        let slack = 2.0 * 0.003 * diag; // the mesh is chordal: it may fall short of an extreme that sits close to a loop
                        assert!(lo <= bbm.lo[k] + slack && hi >= bbm.hi[k] - slack, "axis {k}: mesh [{lo}, {hi}] vs box [{}, {}]", bbm.lo[k], bbm.hi[k]);
                    }
                    let bb = crate::build::solid_aabb(&res);
                    assert!((0..3).all(|k| bb.lo[k] >= ball_c[k] - r - 1e-6 && bb.hi[k] <= ball_c[k] + r + 1e-6), "inside the ball's box");
                }
                None => misses.push(format!("c={rel:?} half={half:?} planes crossing={}", rg.circles.iter().flatten().count())),
            }
        }
        eprintln!("S1 keep: {with_boundary} with a boundary, {built} built, worst volume error {worst:.2e}");
        for m in misses.iter().take(6) {
            eprintln!("  miss {m}");
        }
        assert!(with_boundary >= 30);
        assert!(built * 100 >= with_boundary * 95, "at least 95% of clean crossings build");
    }

    /// S2 and S3: all four operations through the public boolean, in both operand orders where they differ. Every build is the oracle volume
    /// (inclusion-exclusion on the numerical overlap), a closed mesh, and a single lump; a pair refuses only where the result would be two
    /// lumps or the contact is degenerate.
    #[test]
    fn s23_every_operation_builds_the_exact_solid() {
        let r = 10.0;
        let mut rng = Rng(31);
        let names = ["intersect", "union", "ball-box", "box-ball"];
        let (mut seen, mut built) = ([0usize; 4], [0usize; 4]);
        let mut worst = 0.0f64;
        for _ in 0..90 {
            let axes = random_axes(&mut rng);
            let half = [rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r, rng.range(0.15, 1.1) * r];
            let ball_c = [rng.range(-5.0, 5.0), rng.range(-5.0, 5.0), rng.range(-5.0, 5.0)];
            let rel = [rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r, rng.range(-1.1, 1.1) * r];
            let halves = box_halves(rel, axes, half);
            let Ok(rg) = region(r, &halves) else { continue };
            if rg.is_boundaryless() {
                continue;
            }
            let ball = crate::build::sphere_solid(ball_c, r, [0.0, 0.0, 1.0]);
            let bx = box_solid_at(add(ball_c, rel), axes, half);
            let (vb, vx, vi) = (4.0 / 3.0 * PI * r * r * r, 8.0 * half[0] * half[1] * half[2], overlap_volume(r, rel, axes, half));
            let cases: [(usize, Option<TSolid>, f64); 4] = [
                (0, crate::ops::boolean("intersect", &ball, &bx), vi),
                (1, crate::ops::boolean("union", &ball, &bx), vb + vx - vi),
                (2, crate::ops::boolean("subtract", &ball, &bx), vb - vi),
                (3, crate::ops::boolean("subtract", &bx, &ball), vx - vi),
            ];
            for (k, res, want) in cases {
                seen[k] += 1;
                let Some(res) = res else { continue };
                built[k] += 1;
                let got = crate::build::solid_volume(&res);
                worst = worst.max((got - want).abs() / vb.max(vx));
                assert!((got - want).abs() < 1e-6 * vb.max(vx), "{}: volume {got} vs {want} for box c={rel:?} half={half:?}", names[k]);
                assert!(crate::ops::mesh_is_closed_coarse(&res), "{}: the mesh is closed (box c={rel:?} half={half:?})", names[k]);
                assert_eq!(lump_count(&res.faces(), false), 1, "{}: one lump", names[k]);
            }
        }
        eprintln!("S2/S3: built/seen {:?}/{:?} for {:?}, worst relative volume error {worst:.2e}", built, seen, names);
        for k in 0..4 {
            assert!(seen[k] >= 30);
            assert!(built[k] * 10 >= seen[k] * 6, "{}: at least 60% of clean crossings build ({}/{})", names[k], built[k], seen[k]);
        }
    }

    /// A cut that leaves two separate lumps is one solid with two shells: refused, in either direction where it arises. A connected
    /// result of the same pair still builds.
    #[test]
    fn s23_a_cut_that_leaves_two_lumps_refuses() {
        let r = 10.0;
        let ball = crate::build::sphere_solid([0.0; 3], r, [0.0, 0.0, 1.0]);
        // a slab through the middle: ball minus slab is two caps; slab minus ball is one slab with a hole
        let slab = crate::build::box_solid([30.0, 30.0, 6.0], [0.0; 3], None);
        assert!(crate::ops::boolean("subtract", &ball, &slab).is_none(), "two caps");
        let holed = crate::ops::boolean("subtract", &slab, &ball).expect("a slab with a spherical hole is one lump");
        let (vb, vi) = (4.0 / 3.0 * PI * r * r * r, overlap_volume(r, [0.0; 3], [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], [15.0, 15.0, 3.0]));
        assert!((crate::build::solid_volume(&holed) - (30.0 * 30.0 * 6.0 - vi)).abs() < 1e-6 * vb);
        // a thin long box through the ball: box minus ball is two stubs
        let rod = crate::build::box_solid([4.0, 4.0, 40.0], [0.0; 3], None);
        assert!(crate::ops::boolean("subtract", &rod, &ball).is_none(), "two stubs");
        let drilled = crate::ops::boolean("subtract", &ball, &rod).expect("a ball with a square hole is one lump");
        let vi2 = overlap_volume(r, [0.0; 3], [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], [2.0, 2.0, 20.0]);
        assert!((crate::build::solid_volume(&drilled) - (vb - vi2)).abs() < 1e-6 * vb);
    }

    /// Two balls that cross, all three operations in both orders, against the closed-form lens volume: they meet in one circle, so
    /// each result is one lump of two sphere faces.
    #[test]
    fn two_crossing_balls_build_all_operations() {
        let mut rng = Rng(5);
        let (mut tried, mut built) = (0, 0);
        let mut worst = 0.0f64;
        for _ in 0..60 {
            let (r1, r2) = (rng.range(4.0, 14.0), rng.range(4.0, 14.0));
            let c1 = [rng.range(-5.0, 5.0), rng.range(-5.0, 5.0), rng.range(-5.0, 5.0)];
            let dir = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let d = rng.range((r1 - r2).abs() * 1.05 + 0.3, (r1 + r2) * 0.97);
            let c2 = add(c1, scale(dir, d));
            let (a, b) = (crate::build::sphere_solid(c1, r1, [0.0, 0.0, 1.0]), crate::build::sphere_solid(c2, r2, [0.0, 0.0, 1.0]));
            let (va, vb, vi) = (4.0 / 3.0 * PI * r1.powi(3), 4.0 / 3.0 * PI * r2.powi(3), lens_volume(r1, r2, d));
            for (op, x, y, want) in [("intersect", &a, &b, vi), ("union", &a, &b, va + vb - vi), ("subtract", &a, &b, va - vi), ("subtract", &b, &a, vb - vi)] {
                tried += 1;
                let Some(s) = crate::ops::boolean(op, x, y) else { continue };
                built += 1;
                let got = crate::build::solid_volume(&s);
                worst = worst.max((got - want).abs() / va.max(vb));
                assert!(crate::ops::mesh_is_closed_coarse(&s), "{op} mesh is open");
            }
        }
        assert!(built == tried, "{built} of {tried} built");
        assert!(worst < 1e-9, "worst volume error {worst}");
    }

    /// A ball that leans into the corner of a cylinder's bounding box without touching the cylinder (the sweep's pair family places
    /// them 0.1 apart): bounding boxes overlap, the solids do not. Cut leaves the cylinder, join is the two side by side.
    #[test]
    fn a_ball_leaning_into_a_cylinders_box_without_touching_it() {
        let cyl = crate::build::cylinder_solid([0.0; 3], 6.375, 48.17, [0.0, 0.0, 1.0]);
        let (cv, bv) = (PI * 6.375f64.powi(2) * 48.17, 4.0 / 3.0 * PI * 18.26f64.powi(3));
        let ball = crate::build::sphere_solid([-24.63, -2.24, 7.77], 18.26, [0.0, 0.0, 1.0]);
        assert!(provably_apart(&cyl, &ball) && provably_apart(&ball, &cyl));
        let cut = crate::ops::boolean("subtract", &cyl, &ball).expect("a cut that misses leaves the part");
        assert!((crate::build::solid_volume(&cut) - cv).abs() < 1e-9 * cv);
        let join = crate::ops::boolean("union", &cyl, &ball).expect("two bodies side by side");
        assert!((crate::build::solid_volume(&join) - cv - bv).abs() < 1e-9 * (cv + bv));
        assert!(crate::ops::boolean("intersect", &cyl, &ball).is_none());
        assert!(crate::ops::solids_provably_disjoint(&cyl, &ball));
        // 0.01 closer than touching: no longer apart, so the clean-separation shortcut must NOT claim it
        let near = crate::build::sphere_solid([-24.63 + 0.12, -2.24, 7.77], 18.26, [0.0, 0.0, 1.0]);
        assert!(!provably_apart(&cyl, &near));
    }
}
