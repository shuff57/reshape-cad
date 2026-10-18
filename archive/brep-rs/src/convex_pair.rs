//! Pairs of convex bodies that provably do not meet, or where one holds the other (W3 S0, SPEC-brep-cone-booleans.md).
//!
//! A ball, a plain cylinder, a cuboid and a whole cone are all convex. Two convex bodies are APART when a plane separates them, and
//! one is INSIDE another when its extreme features are. Both are decided exactly (every claim is verified with closed forms, never
//! with sampling), and the answer is `false` whenever the proof does not go through. When a cone is one of the two, the boolean of
//! such a pair needs no curve at all: apart, a cut leaves the part and a join is two bodies side by side; inside, a join is the
//! bigger body and a keep is the smaller.

use crate::build;
use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use crate::topo::Solid;
use crate::geom::Surface;

use crate::build::TSolid;

/// A convex body, in world coordinates.
#[derive(Clone, Copy, Debug)]
pub enum Body {
    Ball { c: Vec3, r: f64 },
    /// Both cap centres and the radius.
    Cyl { p: Vec3, q: Vec3, rho: f64 },
    /// The base circle's centre and radius, and the apex.
    Cone { base: Vec3, apex: Vec3, r: f64 },
    Box { c: Vec3, axes: [Vec3; 3], half: [f64; 3] },
}

/// A whole cone: a lateral face over its whole slant and one base disk.
pub fn as_cone(s: &TSolid) -> Option<Body> {
    let faces = s.faces();
    if faces.len() != 2 || s.shells.len() != 1 {
        return None;
    }
    let mut cone = None;
    for f in &faces {
        let fb = f.borrow();
        match &fb.surface {
            Surface::Cone(c) => {
                if cone.is_some() || c.v_range[0].abs() > 1e-9 || (c.v_range[1] - c.slant).abs() > 1e-9 * c.slant {
                    return None;
                }
                cone = Some(c.clone());
            }
            Surface::Plane(_) => {}
            _ => return None,
        }
    }
    let c = cone?;
    let axis = normalize(c.axis);
    let apex = s.vertices().iter().map(|v| v.borrow().point).find(|p| dot(sub(*p, c.base), axis).abs() > 1e-9 * c.slant)?;
    let h = dot(sub(apex, c.base), axis);
    // the apex sits on the axis, a whole height up the base, and the base circle is the lateral face's own
    if h < 1e-9 || len(sub(apex, add(c.base, scale(axis, h)))) > 1e-7 * c.slant || (h * h + c.base_radius * c.base_radius - c.slant * c.slant).abs() > 1e-7 * c.slant * c.slant {
        return None;
    }
    Some(Body::Cone { base: c.base, apex, r: c.base_radius })
}

pub fn body_of(s: &TSolid) -> Option<Body> {
    if let Some(b) = crate::ball_box::as_ball(s) {
        return Some(Body::Ball { c: b.c, r: b.r });
    }
    if let Some((wall, p, q, _, _)) = crate::ops::cylinder_parts(s) {
        return Some(Body::Cyl { p, q, rho: wall.radius });
    }
    if let Some(b) = crate::ball_box::as_box(s) {
        return Some(Body::Box { c: b.c, axes: b.axes, half: b.half });
    }
    as_cone(s)
}

fn perp(d: Vec3, u: Vec3) -> Vec3 {
    sub(d, scale(u, dot(d, u)))
}

/// The point of a circle (centre `c`, radius `r`, plane normal `u`) farthest along `d`.
fn circle_support(c: Vec3, r: f64, u: Vec3, d: Vec3) -> Vec3 {
    let pd = perp(d, u);
    let l = len(pd);
    if l < 1e-15 {
        c
    } else {
        add(c, scale(pd, r / l))
    }
}

impl Body {
    /// The point of the body farthest along `d`.
    pub fn support(&self, d: Vec3) -> Vec3 {
        match *self {
            Body::Ball { c, r } => {
                let l = len(d);
                if l < 1e-15 { c } else { add(c, scale(d, r / l)) }
            }
            Body::Cyl { p, q, rho } => {
                let u = normalize(sub(q, p));
                let end = if dot(d, u) >= 0.0 { q } else { p };
                circle_support(end, rho, u, d)
            }
            Body::Cone { base, apex, r } => {
                let u = normalize(sub(apex, base));
                let rim = circle_support(base, r, u, d);
                if dot(d, rim) >= dot(d, apex) { rim } else { apex }
            }
            Body::Box { c, axes, half } => {
                let mut x = c;
                for k in 0..3 {
                    x = add(x, scale(axes[k], if dot(d, axes[k]) >= 0.0 { half[k] } else { -half[k] }));
                }
                x
            }
        }
    }

    pub fn contains(&self, x: Vec3) -> bool {
        match *self {
            Body::Ball { c, r } => len(sub(x, c)) <= r,
            Body::Cyl { p, q, rho } => {
                let (h, u) = (len(sub(q, p)), normalize(sub(q, p)));
                let t = dot(sub(x, p), u);
                t >= 0.0 && t <= h && len(perp(sub(x, p), u)) <= rho
            }
            Body::Cone { base, apex, r } => {
                let (h, u) = (len(sub(apex, base)), normalize(sub(apex, base)));
                let t = dot(sub(x, base), u);
                t >= 0.0 && t <= h && len(perp(sub(x, base), u)) <= r * (1.0 - t / h)
            }
            Body::Box { c, axes, half } => (0..3).all(|k| dot(sub(x, c), axes[k]).abs() <= half[k]),
        }
    }

    /// A length that sets the scale of every tolerance.
    fn size(&self) -> f64 {
        match *self {
            Body::Ball { r, .. } => r,
            Body::Cyl { p, q, rho } => len(sub(q, p)).max(rho),
            Body::Cone { base, apex, r } => len(sub(apex, base)).max(r),
            Body::Box { half, .. } => half[0].max(half[1]).max(half[2]),
        }
    }

    fn centre(&self) -> Vec3 {
        match *self {
            Body::Ball { c, .. } | Body::Box { c, .. } => c,
            Body::Cyl { p, q, .. } => scale(add(p, q), 0.5),
            Body::Cone { base, apex, .. } => scale(add(base, apex), 0.5),
        }
    }
}

/// The point of `pts` set (at most four, an affine simplex) nearest the origin, and the subset of `pts` that carries it.
fn nearest_to_origin(pts: &[Vec3]) -> (Vec3, Vec<Vec3>) {
    let n = pts.len();
    let mut best: Option<(f64, Vec3, Vec<Vec3>)> = None;
    for mask in 1u32..(1 << n) {
        let idx: Vec<usize> = (0..n).filter(|i| mask & (1 << i) != 0).collect();
        let k = idx.len();
        // minimise |sum l_i p_i|^2 with sum l_i = 1: the KKT system
        let mut m = vec![vec![0.0; k + 2]; k + 1];
        for a in 0..k {
            for b in 0..k {
                m[a][b] = dot(pts[idx[a]], pts[idx[b]]);
            }
            m[a][k] = 1.0;
        }
        for b in 0..k {
            m[k][b] = 1.0;
        }
        m[k][k + 1] = 1.0;
        // Gaussian elimination with pivoting; a singular subset (a degenerate simplex) is skipped
        let mut ok = true;
        for col in 0..=k {
            let piv = (col..=k).max_by(|&x, &y| m[x][col].abs().total_cmp(&m[y][col].abs())).unwrap();
            if m[piv][col].abs() < 1e-14 {
                ok = false;
                break;
            }
            m.swap(col, piv);
            for r in 0..=k {
                if r != col {
                    let f = m[r][col] / m[col][col];
                    for c2 in col..=k + 1 {
                        m[r][c2] -= f * m[col][c2];
                    }
                }
            }
        }
        if !ok {
            continue;
        }
        let lam: Vec<f64> = (0..k).map(|a| m[a][k + 1] / m[a][a]).collect();
        if lam.iter().any(|l| *l < -1e-12) {
            continue;
        }
        let mut v = [0.0; 3];
        for a in 0..k {
            v = add(v, scale(pts[idx[a]], lam[a]));
        }
        let d = dot(v, v);
        if best.as_ref().is_none_or(|b| d < b.0) {
            best = Some((d, v, idx.iter().map(|&i| pts[i]).collect()));
        }
    }
    let (_, v, sub_pts) = best.unwrap_or((0.0, pts[0], vec![pts[0]]));
    (v, sub_pts)
}

/// Whether a plane separates the two bodies by more than a hair. GJK finds the direction; the support functions then prove it, so a
/// wrong direction can only make this `false`, never a false "apart".
pub fn apart(a: &Body, b: &Body) -> bool {
    let size = a.size() + b.size() + len(sub(a.centre(), b.centre()));
    let margin = 1e-7 * size.max(1.0);
    let diff = |d: Vec3| sub(a.support(d), b.support(scale(d, -1.0)));
    let mut simplex = vec![diff([1.0, 0.0, 0.0])];
    let mut v = simplex[0];
    for _ in 0..80 {
        let (nv, keep) = nearest_to_origin(&simplex);
        v = nv;
        simplex = keep;
        let vv = dot(v, v);
        if vv < 1e-24 * size * size {
            return false;
        }
        let w = diff(scale(v, -1.0));
        if vv - dot(v, w) <= 1e-13 * vv {
            break;
        }
        simplex.push(w);
    }
    let l = len(v);
    if l < 1e-12 * size {
        return false;
    }
    let u = scale(v, 1.0 / l);
    // every point of A is at least `lo` along u, every point of B at most `hi`
    let lo = dot(a.support(scale(u, -1.0)), u);
    let hi = dot(b.support(u), u);
    lo - hi > margin
}

/// What a body is made of for containment: points, circles (centre, radius, normal) and whole balls.
enum Feature {
    Point(Vec3),
    Circle(Vec3, f64, Vec3),
    Ball(Vec3, f64),
}

fn features(a: &Body) -> Vec<Feature> {
    match *a {
        Body::Ball { c, r } => vec![Feature::Ball(c, r)],
        Body::Cyl { p, q, rho } => {
            let u = normalize(sub(q, p));
            vec![Feature::Circle(p, rho, u), Feature::Circle(q, rho, u)]
        }
        Body::Cone { base, apex, r } => vec![Feature::Point(apex), Feature::Circle(base, r, normalize(sub(apex, base)))],
        Body::Box { c, axes, half } => {
            let mut v = Vec::new();
            for i in 0..8 {
                let mut p = c;
                for k in 0..3 {
                    p = add(p, scale(axes[k], if i & (1 << k) != 0 { half[k] } else { -half[k] }));
                }
                v.push(Feature::Point(p));
            }
            v
        }
    }
}

impl Feature {
    /// The farthest the feature reaches along the unit direction `n`.
    fn reach(&self, n: Vec3) -> f64 {
        match self {
            Feature::Point(p) => dot(*p, n),
            Feature::Circle(c, r, u) => dot(*c, n) + r * len(perp(n, *u)),
            Feature::Ball(c, r) => dot(*c, n) + r,
        }
    }
}

/// Whether `a` lies inside `b` with a margin: exact (closed form per container), `false` when the proof does not go through (a
/// circle square-on to nothing the container is built around).
pub fn inside(a: &Body, b: &Body) -> bool {
    let margin = 1e-7 * (a.size() + b.size() + len(sub(a.centre(), b.centre()))).max(1.0);
    let feats = features(a);
    // every feature's distance to an axis (point `o`, unit `u`): the axis-aligned circle's farthest point is |offset| + r; a circle
    // tilted to the axis is not proved here
    let radial = |f: &Feature, o: Vec3, u: Vec3| -> Option<f64> {
        match f {
            Feature::Point(p) => Some(len(perp(sub(*p, o), u))),
            Feature::Ball(c, r) => Some(len(perp(sub(*c, o), u)) + r),
            Feature::Circle(c, r, n) => (len(cross(*n, u)) < 1e-9).then(|| len(perp(sub(*c, o), u)) + r),
        }
    };
    match *b {
        Body::Ball { c, r } => feats.iter().all(|f| match f {
            Feature::Point(p) => len(sub(*p, c)) <= r - margin,
            Feature::Ball(c2, r2) => len(sub(*c2, c)) + r2 <= r - margin,
            Feature::Circle(c2, r2, n) => {
                let w = sub(*c2, c);
                (dot(w, w) + r2 * r2 + 2.0 * r2 * len(perp(w, *n))).sqrt() <= r - margin
            }
        }),
        Body::Box { c, axes, half } => feats.iter().all(|f| (0..3).all(|k| f.reach(axes[k]) - dot(c, axes[k]) <= half[k] - margin && f.reach(scale(axes[k], -1.0)) + dot(c, axes[k]) <= half[k] - margin)),
        Body::Cyl { p, q, rho } => {
            let (h, u) = (len(sub(q, p)), normalize(sub(q, p)));
            feats.iter().all(|f| f.reach(u) - dot(p, u) <= h - margin && f.reach(scale(u, -1.0)) + dot(p, u) <= -margin && radial(f, p, u).is_some_and(|d| d <= rho - margin))
        }
        Body::Cone { base, apex, r } => {
            let (h, u) = (len(sub(apex, base)), normalize(sub(apex, base)));
            let slant = (h * h + r * r).sqrt();
            // the cone is t >= 0 and g <= 0, with g the signed distance (in a meridian plane) to the generating line
            let g = |rho: f64, t: f64| (h * rho + r * t - r * h) / slant;
            feats.iter().all(|f| {
                if f.reach(scale(u, -1.0)) + dot(base, u) > -margin {
                    return false;
                }
                let Some(rho) = radial(f, base, u) else { return false };
                match f {
                    Feature::Point(pt) => g(rho, dot(sub(*pt, base), u)) <= -margin,
                    Feature::Circle(c2, _, _) => g(rho, dot(sub(*c2, base), u)) <= -margin,
                    // a ball: the radial figure already includes its radius, which is the wrong measure here; the distance to the
                    // generating line must be at least the radius
                    Feature::Ball(c2, r2) => g(rho - r2, dot(sub(*c2, base), u)) <= -r2 - margin,
                }
            })
        }
    }
}

fn copy(s: &TSolid) -> TSolid {
    build::transform_solid(s, &crate::math::Transform::identity())
}

/// A boolean needing no curve: `op` on two convex bodies, at least one a whole cone, that are apart or one inside the other.
/// `None` when the pair is neither (or the case is left to the existing paths: a cut of a body that lies inside the other).
pub fn trivial(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    let (ba, bb) = (body_of(a)?, body_of(b)?);
    if !matches!(ba, Body::Cone { .. }) && !matches!(bb, Body::Cone { .. }) {
        return None;
    }
    if apart(&ba, &bb) {
        return match op {
            "subtract" => Some(copy(a)),
            "union" => {
                let (ca, cb) = (copy(a), copy(b));
                Some(Solid { shells: ca.shells.into_iter().chain(cb.shells).collect() })
            }
            _ => None,
        };
    }
    if inside(&ba, &bb) {
        return match op {
            "union" => Some(copy(b)),
            "intersect" => Some(copy(a)),
            _ => None,
        };
    }
    if inside(&bb, &ba) {
        return match op {
            "union" => Some(copy(a)),
            "intersect" => Some(copy(b)),
            _ => None,
        };
    }
    None
}

/// Whether two bodies, at least one a whole cone, are provably apart (for the "do not overlap" sentence).
pub fn provably_apart(a: &TSolid, b: &TSolid) -> bool {
    let (Some(ba), Some(bb)) = (body_of(a), body_of(b)) else { return false };
    (matches!(ba, Body::Cone { .. }) || matches!(bb, Body::Cone { .. })) && apart(&ba, &bb)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        fn dir(&mut self) -> Vec3 {
            loop {
                let v = [self.range(-1.0, 1.0), self.range(-1.0, 1.0), self.range(-1.0, 1.0)];
                if len(v) > 0.2 && len(v) < 1.0 {
                    return normalize(v);
                }
            }
        }
    }

    fn random_body(rng: &mut Rng, kind: usize, at: Vec3, aligned: bool) -> Body {
        let axis = if aligned { [0.0, 0.0, 1.0] } else { rng.dir() };
        match kind {
            0 => Body::Ball { c: at, r: rng.range(3.0, 12.0) },
            1 => {
                let h = rng.range(4.0, 20.0);
                Body::Cyl { p: sub(at, scale(axis, h / 2.0)), q: add(at, scale(axis, h / 2.0)), rho: rng.range(3.0, 12.0) }
            }
            2 => {
                let h = rng.range(4.0, 20.0);
                Body::Cone { base: sub(at, scale(axis, h / 2.0)), apex: add(at, scale(axis, h / 2.0)), r: rng.range(3.0, 12.0) }
            }
            _ => {
                let a = if aligned { [1.0, 0.0, 0.0] } else { normalize(cross(axis, rng.dir())) };
                Body::Box { c: at, axes: [a, cross(axis, a), axis], half: [rng.range(3.0, 10.0), rng.range(3.0, 10.0), rng.range(3.0, 10.0)] }
            }
        }
    }

    /// Points of `a`, by rejection in a ball about it.
    fn samples(rng: &mut Rng, a: &Body, n: usize) -> Vec<Vec3> {
        let (c, r) = (a.centre(), 1.2 * a.size() * 1.8);
        let mut out = Vec::new();
        let mut tries = 0;
        while out.len() < n && tries < 40 * n {
            tries += 1;
            let p = [c[0] + rng.range(-r, r), c[1] + rng.range(-r, r), c[2] + rng.range(-r, r)];
            if a.contains(p) {
                out.push(p);
            }
        }
        out
    }

    /// Every claim of "apart" or "inside" is checked against points of the bodies; the claims must also actually be made.
    #[test]
    fn apart_and_inside_claims_hold_against_sampled_points() {
        let mut rng = Rng(11);
        let (mut apart_n, mut inside_n, mut pairs) = (0, 0, 0);
        for i in 0..3000 {
            let (ka, kb) = (i % 4, (i / 4) % 4);
            let (aligned, a_at) = (i % 3 != 0, [0.0, 0.0, 0.0]);
            let a = random_body(&mut rng, ka, a_at, aligned);
            let off = scale(rng.dir(), rng.range(0.0, if i % 2 == 0 { 30.0 } else { 5.0 }));
            let b = random_body(&mut rng, kb, off, aligned);
            pairs += 1;
            let (sa, sb) = (samples(&mut rng, &a, 150), samples(&mut rng, &b, 150));
            if apart(&a, &b) {
                apart_n += 1;
                assert!(!sa.iter().any(|p| b.contains(*p)) && !sb.iter().any(|p| a.contains(*p)), "claimed apart but they share a point: {a:?} {b:?}");
            }
            if inside(&a, &b) {
                inside_n += 1;
                assert!(sa.iter().all(|p| b.contains(*p)), "claimed inside but a point is out: {a:?} in {b:?}");
            }
            if inside(&b, &a) {
                inside_n += 1;
                assert!(sb.iter().all(|p| a.contains(*p)), "claimed inside but a point is out: {b:?} in {a:?}");
            }
        }
        assert!(apart_n > 300 && inside_n > 100, "claims too rare to mean anything: {apart_n} apart, {inside_n} inside of {pairs}");
    }

    #[test]
    fn a_cone_clear_of_or_inside_another_solid_builds_exactly() {
        let cone = build::cone_solid([0.0; 3], 10.0, 20.0, [0.0, 0.0, 1.0]);
        let cv = PI * 100.0 * 20.0 / 3.0;
        // clear of a ball by 0.1 while the bounding boxes overlap
        let ball = build::sphere_solid([14.2, 0.0, 0.0], 4.0, [0.0, 0.0, 1.0]);
        let bv = 4.0 / 3.0 * PI * 64.0;
        assert!(provably_apart(&cone, &ball));
        let cut = crate::ops::boolean("subtract", &cone, &ball).expect("a cut that misses leaves the cone");
        assert!((build::solid_volume(&cut) - cv).abs() < 1e-9 * cv);
        let join = crate::ops::boolean("union", &cone, &ball).expect("side by side");
        assert!((build::solid_volume(&join) - cv - bv).abs() < 1e-9 * cv);
        assert!(crate::ops::boolean("intersect", &cone, &ball).is_none());
        // a ball clearly round the cone, and a box round it
        let big = build::sphere_solid([0.0; 3], 20.0, [0.0, 0.0, 1.0]);
        let bigv = 4.0 / 3.0 * PI * 8000.0;
        assert!((build::solid_volume(&crate::ops::boolean("intersect", &cone, &big).unwrap()) - cv).abs() < 1e-9 * cv);
        assert!((build::solid_volume(&crate::ops::boolean("union", &big, &cone).unwrap()) - bigv).abs() < 1e-9 * bigv);
        let bx = build::box_solid([30.0, 30.0, 30.0], [0.0; 3], None);
        assert!((build::solid_volume(&crate::ops::boolean("union", &cone, &bx).unwrap()) - 27000.0).abs() < 1e-6);
        // a cone inside a cylinder; a ball inside a cone
        let cyl = build::cylinder_solid([0.0; 3], 11.0, 22.0, [0.0, 0.0, 1.0]);
        assert!((build::solid_volume(&crate::ops::boolean("intersect", &cone, &cyl).unwrap()) - cv).abs() < 1e-9 * cv);
        let tiny = build::sphere_solid([0.0, 0.0, -4.0], 2.0, [0.0, 0.0, 1.0]);
        assert!(inside(&body_of(&tiny).unwrap(), &body_of(&cone).unwrap()));
        let tv = 4.0 / 3.0 * PI * 8.0;
        assert!((build::solid_volume(&crate::ops::boolean("intersect", &tiny, &cone).unwrap()) - tv).abs() < 1e-9 * tv);
        // a crossing pair is NEITHER, and is not claimed
        let cross_ball = build::sphere_solid([8.0, 0.0, 0.0], 6.0, [0.0, 0.0, 1.0]);
        assert!(!provably_apart(&cone, &cross_ball));
        assert!(!inside(&body_of(&cone).unwrap(), &body_of(&cross_ball).unwrap()) && !inside(&body_of(&cross_ball).unwrap(), &body_of(&cone).unwrap()));
    }
}
