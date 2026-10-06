//! A ball against a box, at any orientation (SPEC-brep-ball-box.md): the geometry core.
//!
//! Everything here is in the ball's own frame (centre at the origin). A box is six half-spaces `n . p <= d` with unit outward
//! normals. The part of the sphere inside the box is bounded by arcs of the circles where the six planes cut the sphere,
//! joined at the points where a box edge meets the sphere. `region_loops` finds those loops, each as a dense polyline that
//! passes exactly through its corners and is traversed with the region on its left.

use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use std::f64::consts::TAU;

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
struct Circle {
    c: Vec3,
    rho: f64,
    e1: Vec3,
    e2: Vec3,
    n: Vec3,
}

impl Circle {
    fn at(&self, t: f64) -> Vec3 {
        add(self.c, add(scale(self.e1, self.rho * t.cos()), scale(self.e2, self.rho * t.sin())))
    }
}

fn circle_of(h: &Half, r: f64) -> Option<Circle> {
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

struct Arc {
    plane: usize,
    lo: f64,
    hi: f64,
}

/// The boundary of the part of the sphere (radius `r`, centre the origin) inside `halves`, as closed polylines (no repeated
/// closing point) with the region on the left, looking from outside. `step` is the arc length between samples. An empty list
/// means the region is empty or is the whole sphere (`inside_all` of any sphere point tells which). `Err` names a degenerate
/// contact: a plane tangent to the sphere, or to one of the circles, or three circles through one point.
pub fn region_loops(r: f64, halves: &[Half], step: f64) -> Result<Vec<Vec<Vec3>>, &'static str> {
    let circles: Vec<Option<Circle>> = halves.iter().map(|h| circle_of(h, r)).collect();
    for h in halves {
        if (h.d.abs() - r).abs() < 1e-9 * r {
            return Err("a box face touches the ball at a single point");
        }
    }
    let mut arcs: Vec<Arc> = Vec::new();
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
            arcs.push(Arc { plane: i, lo, hi });
        }
    }
    let mut loops: Vec<Vec<Vec3>> = Vec::new();
    let sample = |ci: &Circle, lo: f64, hi: f64| -> Vec<Vec3> {
        let n = ((ci.rho * (hi - lo) / step).ceil() as usize).max(2);
        // traversed with the region on the left: t decreasing (the +n side is to the left of increasing t, and it is the outside)
        (0..n).map(|k| ci.at(hi - (hi - lo) * k as f64 / n as f64)).collect()
    };
    for &i in &whole {
        let ci = circles[i].as_ref().unwrap();
        loops.push(sample(ci, 0.0, TAU));
    }
    // Link arcs end to start.
    let tol = 1e-7 * r;
    let start_of = |a: &Arc| circles[a.plane].as_ref().unwrap().at(a.hi);
    let end_of = |a: &Arc| circles[a.plane].as_ref().unwrap().at(a.lo);
    let mut used = vec![false; arcs.len()];
    for s in 0..arcs.len() {
        if used[s] {
            continue;
        }
        let mut pts: Vec<Vec3> = Vec::new();
        let mut cur = s;
        loop {
            used[cur] = true;
            let ci = circles[arcs[cur].plane].as_ref().unwrap();
            pts.extend(sample(ci, arcs[cur].lo, arcs[cur].hi));
            let e = end_of(&arcs[cur]);
            let next: Vec<usize> = (0..arcs.len()).filter(|&k| len(sub(start_of(&arcs[k]), e)) < tol).collect();
            match next.as_slice() {
                [k] if *k == s => break,
                [k] if !used[*k] => cur = *k,
                [] => return Err("an arc of the ball's boundary does not meet another"),
                _ => return Err("more than two circles meet at one point of the sphere"),
            }
        }
        loops.push(pts);
    }
    Ok(loops)
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
            let loops = match region_loops(r, &halves, 0.5) {
                Ok(l) => l,
                Err(_) => {
                    refused_geom += 1;
                    continue;
                }
            };
            if loops.is_empty() {
                continue;
            }
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
}
