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
                match sphere_with_holes_scattered([0.0; 3], r, &loops, &in_hole, 1.2, true) {
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
}
