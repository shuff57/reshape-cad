//! A sphere with holes, meshed as a spherical Delaunay triangulation (SPEC-brep-sphere-multi-bore.md).
//!
//! The delaunay triangulation of points on a sphere is their 3D convex hull. The hole loops are sampled densely and
//! the interior lattice is kept at least one boundary spacing away from every loop vertex and out of every hole, so
//! each loop edge has an empty diametral cap and is therefore a hull edge (the conforming-Delaunay argument). Hull
//! triangles whose centre lies in a hole are dropped, and the result is checked: every loop edge must be present
//! and the only open edges must be the loop edges, or nothing is returned.
//!
//! Nothing here depends on how many holes there are, where they sit or how they are shaped, which is why it replaces the
//! one-bore pole fan for a sphere with several bores. It needs no pole, so no hole can be on one.

use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use std::collections::{HashMap, HashSet};

/// Hard cap on hull points: the hull scans every live facet per inserted point.
const MAX_POINTS: usize = 40_000;

/// The convex hull of points that all lie on one sphere about `c`, as outward-wound triangles over indices into
/// `pts`. `None` for fewer than four points, a flat set, or a point set the tolerance cannot make sense of.
pub fn sphere_hull(pts: &[Vec3], c: Vec3) -> Option<Vec<[u32; 3]>> {
    let n = pts.len();
    if n < 4 || n > MAX_POINTS {
        return None;
    }
    let p: Vec<Vec3> = pts.iter().map(|q| sub(*q, c)).collect();
    let rad = p.iter().map(|q| len(*q)).fold(0.0, f64::max);
    if !(rad > 0.0) {
        return None;
    }
    let eps = 1e-11 * rad;

    // A tetrahedron to start from: far apart, then widest triangle, then largest volume.
    let i0 = 0usize;
    let far = |f: &dyn Fn(usize) -> f64| (0..n).max_by(|&a, &b| f(a).partial_cmp(&f(b)).unwrap()).unwrap();
    let i1 = far(&|i| len(sub(p[i], p[i0])));
    let i2 = far(&|i| len(cross(sub(p[i1], p[i0]), sub(p[i], p[i0]))));
    let nrm = cross(sub(p[i1], p[i0]), sub(p[i2], p[i0]));
    let i3 = far(&|i| dot(nrm, sub(p[i], p[i0])).abs());
    if dot(nrm, sub(p[i3], p[i0])).abs() < 1e-9 * rad * rad * rad {
        return None;
    }
    let inside = scale(add(add(p[i0], p[i1]), add(p[i2], p[i3])), 0.25);

    struct Facets {
        v: Vec<[u32; 3]>,
        n: Vec<Vec3>,
        d: Vec<f64>,
        alive: Vec<bool>,
    }
    let mut f = Facets { v: Vec::new(), n: Vec::new(), d: Vec::new(), alive: Vec::new() };
    let add_facet = |f: &mut Facets, a: u32, b: u32, c2: u32, p: &Vec<Vec3>, inside: Vec3| {
        let (pa, pb, pc) = (p[a as usize], p[b as usize], p[c2 as usize]);
        let mut nn = normalize(cross(sub(pb, pa), sub(pc, pa)));
        let mut tri = [a, b, c2];
        if dot(nn, sub(inside, pa)) > 0.0 {
            // wound the wrong way round: turn it outward
            tri = [a, c2, b];
            nn = scale(nn, -1.0);
        }
        f.d.push(dot(nn, pa));
        f.n.push(nn);
        f.v.push(tri);
        f.alive.push(true);
    };
    let t = [i0 as u32, i1 as u32, i2 as u32, i3 as u32];
    for (a, b, c2) in [(0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3)] {
        add_facet(&mut f, t[a], t[b], t[c2], &p, inside);
    }

    let mut dead = 0usize;
    for k in 0..n {
        if t.contains(&(k as u32)) {
            continue;
        }
        let q = p[k];
        let visible: Vec<usize> = (0..f.v.len()).filter(|&i| f.alive[i] && dot(f.n[i], q) - f.d[i] > eps).collect();
        if visible.is_empty() {
            continue; // inside the hull to tolerance: a duplicate or a point the sphere does not make extreme
        }
        let mut edges: HashMap<(u32, u32), ()> = HashMap::with_capacity(visible.len() * 3);
        for &i in &visible {
            let [a, b, c2] = f.v[i];
            edges.insert((a, b), ());
            edges.insert((b, c2), ());
            edges.insert((c2, a), ());
        }
        let mut horizon: Vec<(u32, u32)> = Vec::new();
        for &(a, b) in edges.keys() {
            if !edges.contains_key(&(b, a)) {
                horizon.push((a, b));
            }
        }
        for &i in &visible {
            f.alive[i] = false;
        }
        dead += visible.len();
        for (a, b) in horizon {
            // a horizon edge a->b was wound outward by the facet that is now gone; (a, b, new point) keeps that winding
            let (pa, pb) = (p[a as usize], p[b as usize]);
            let mut nn = normalize(cross(sub(pb, pa), sub(q, pa)));
            let mut tri = [a, b, k as u32];
            if dot(nn, sub(inside, pa)) > 0.0 {
                tri = [b, a, k as u32];
                nn = scale(nn, -1.0);
            }
            f.d.push(dot(nn, pa));
            f.n.push(nn);
            f.v.push(tri);
            f.alive.push(true);
        }
        if dead > 4096 && dead * 2 > f.v.len() {
            let keep: Vec<usize> = (0..f.v.len()).filter(|&i| f.alive[i]).collect();
            f.v = keep.iter().map(|&i| f.v[i]).collect();
            f.n = keep.iter().map(|&i| f.n[i]).collect();
            f.d = keep.iter().map(|&i| f.d[i]).collect();
            f.alive = vec![true; keep.len()];
            dead = 0;
        }
    }
    let out: Vec<[u32; 3]> = (0..f.v.len()).filter(|&i| f.alive[i]).map(|i| f.v[i]).collect();
    // A closed polyhedron: every directed edge has its reverse.
    let mut count: HashMap<(u32, u32), i32> = HashMap::new();
    for tri in &out {
        for e in 0..3 {
            *count.entry((tri[e], tri[(e + 1) % 3])).or_insert(0) += 1;
        }
    }
    if count.iter().any(|(&(a, b), &c2)| c2 != 1 || count.get(&(b, a)) != Some(&1)) {
        return None;
    }
    Some(out)
}

/// The triangles of the sphere (centre `c`, radius `big`) with the holes removed, wound outward. `loops` are the holes'
/// boundary polylines (closed, no repeated closing point), the vertices the neighbouring faces also use; `in_hole`
/// says whether a point of the sphere is inside a hole; `spacing` is the interior lattice's edge length. `None` if the
/// triangulation does not hold every loop edge or leaves an open edge anywhere else.
pub fn sphere_with_holes(
    c: Vec3,
    big: f64,
    loops: &[Vec<Vec3>],
    in_hole: &dyn Fn(Vec3) -> bool,
    spacing: f64,
) -> Option<Vec<[Vec3; 3]>> {
    if loops.is_empty() || loops.iter().any(|l| l.len() < 3) {
        return None;
    }
    let mut hb: f64 = 0.0;
    for l in loops {
        for i in 0..l.len() {
            hb = hb.max(len(sub(l[(i + 1) % l.len()], l[i])));
        }
    }
    let h = spacing.max(hb);
    let margin = hb.max(0.8 * h);
    let target = ((4.0 * std::f64::consts::PI * big * big) / (0.866 * h * h)).ceil() as usize;
    if target < 12 || target > MAX_POINTS - 8 * loops.iter().map(|l| l.len()).sum::<usize>().min(4000) {
        return None;
    }
    // Fibonacci lattice, turned by a fixed irrational-ish rotation so no lattice row lines up with a bore's own symmetry.
    let golden = std::f64::consts::PI * (3.0 - 5.0f64.sqrt());
    let tilt = normalize([1.0, 2.0, 3.0]);
    let (ca, sa) = (0.37f64.cos(), 0.37f64.sin());
    let rot = |v: Vec3| add(add(scale(v, ca), scale(cross(tilt, v), sa)), scale(tilt, dot(tilt, v) * (1.0 - ca)));
    let all_loop: Vec<Vec3> = loops.iter().flat_map(|l| l.iter().copied()).collect();
    let mut pts: Vec<Vec3> = all_loop.clone();
    let margin2 = margin * margin;
    for k in 0..target {
        let z = 1.0 - 2.0 * (k as f64 + 0.5) / target as f64;
        let rho = (1.0 - z * z).max(0.0).sqrt();
        let phi = golden * k as f64;
        let q = add(c, scale(rot([rho * phi.cos(), rho * phi.sin(), z]), big));
        if in_hole(q) {
            continue;
        }
        let d2 = |a: Vec3, b: Vec3| {
            let d = sub(a, b);
            dot(d, d)
        };
        if all_loop.iter().any(|l| d2(*l, q) < margin2) {
            continue;
        }
        pts.push(q);
    }
    let tris = sphere_hull(&pts, c)?;
    let mut kept: Vec<[u32; 3]> = Vec::with_capacity(tris.len());
    for tri in tris {
        let cen = scale(add(add(pts[tri[0] as usize], pts[tri[1] as usize]), pts[tri[2] as usize]), 1.0 / 3.0);
        let on_sphere = add(c, scale(normalize(sub(cen, c)), big));
        if !in_hole(on_sphere) {
            kept.push(tri);
        }
    }
    // Conforming and closed: the unmatched directed edges must be exactly the loop edges (each once), nothing else.
    let mut count: HashMap<(u32, u32), i32> = HashMap::new();
    for tri in &kept {
        for e in 0..3 {
            *count.entry((tri[e], tri[(e + 1) % 3])).or_insert(0) += 1;
        }
    }
    let mut open: HashSet<(u32, u32)> = HashSet::new();
    for (&(a, b), &n) in &count {
        if n != 1 {
            return None;
        }
        if !count.contains_key(&(b, a)) {
            open.insert((a, b));
        }
    }
    let mut loop_edges = 0usize;
    let mut base = 0usize;
    for l in loops {
        for i in 0..l.len() {
            let (a, b) = ((base + i) as u32, (base + (i + 1) % l.len()) as u32);
            if !(open.contains(&(a, b)) || open.contains(&(b, a))) {
                return None; // a loop edge the triangulation does not hold
            }
            loop_edges += 1;
        }
        base += l.len();
    }
    if open.len() != loop_edges {
        return None;
    }
    Some(kept.iter().map(|t| [pts[t[0] as usize], pts[t[1] as usize], pts[t[2] as usize]]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Curve;
    use std::f64::consts::PI;

    /// (x, y, r): a through bore parallel to z at that offset, both ends holed.
    type Hole = (f64, f64, f64);

    fn loops_of(big: f64, holes: &[Hole], pts: usize) -> Vec<Vec<Vec3>> {
        let mut out = Vec::new();
        for &(x, y, r) in holes {
            let e = (x * x + y * y).sqrt();
            let n = [x / e, y / e, 0.0];
            let a = cross([0.0, 0.0, 1.0], n);
            for sign in [1.0, -1.0] {
                let c = Curve::SphCyl { center: [0.0; 3], d: [0.0, 0.0, 1.0], n, a, big_r: big, r, e, sign };
                out.push((0..pts).map(|k| c.point_at(k as f64 / pts as f64)).collect());
            }
        }
        out
    }

    fn tri_area(t: &[Vec3; 3]) -> f64 {
        0.5 * len(cross(sub(t[1], t[0]), sub(t[2], t[0])))
    }

    /// Area of the sphere cap a bore of radius r at offset e removes at one end: R * int [asin((e+w)/c) - asin((e-w)/c)] dy.
    fn cap_area(big: f64, r: f64, e: f64) -> f64 {
        let n = 20000;
        let mut acc = 0.0;
        for i in 0..n {
            let th = -0.5 * PI + PI * (i as f64 + 0.5) / n as f64;
            let (y, w) = (r * th.sin(), r * th.cos());
            let c = (big * big - y * y).sqrt();
            // midpoint rule in theta; dy = r cos(theta) dtheta
            acc += (((e + w) / c).asin() - ((e - w) / c).asin()) * r * th.cos() * PI / n as f64;
        }
        big * acc
    }

    fn run(big: f64, holes: &[Hole], chord: f64) -> Option<Vec<[Vec3; 3]>> {
        let loops = loops_of(big, holes, 360);
        let inside = |q: Vec3| holes.iter().any(|&(x, y, r)| (q[0] - x).powi(2) + (q[1] - y).powi(2) < r * r);
        sphere_with_holes([0.0; 3], big, &loops, &inside, chord)
    }

    #[test]
    fn the_hull_of_points_on_a_sphere_is_a_closed_outward_polyhedron() {
        let mut s = 12345u64;
        let mut rnd = || {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((s >> 11) as f64) / (1u64 << 53) as f64
        };
        let pts: Vec<Vec3> = (0..500)
            .map(|_| {
                let (z, p) = (2.0 * rnd() - 1.0, 2.0 * PI * rnd());
                let r = (1.0 - z * z).sqrt();
                [10.0 * r * p.cos(), 10.0 * r * p.sin(), 10.0 * z]
            })
            .collect();
        let tris = sphere_hull(&pts, [0.0; 3]).expect("a hull");
        assert_eq!(tris.len(), 2 * 500 - 4, "Euler: a triangulated sphere on n points has 2n - 4 triangles");
        let mut vol = 0.0;
        for t in &tris {
            let (a, b, c) = (pts[t[0] as usize], pts[t[1] as usize], pts[t[2] as usize]);
            vol += dot(a, cross(b, c)) / 6.0;
        }
        assert!(vol > 0.0 && vol < 4.0 / 3.0 * PI * 1000.0, "outward, inscribed: {vol}");
    }

    #[test]
    fn two_and_three_parallel_bores_mesh_conforming_and_close_to_the_exact_area() {
        let big = 20.0;
        let cases: Vec<Vec<Hole>> = vec![
            vec![(8.0, 0.0, 3.0), (-6.0, 5.0, 2.5)],
            vec![(8.0, 0.0, 3.0), (-8.0, 0.0, 3.0), (0.0, 9.0, 2.0)],
            vec![(2.0, 0.0, 3.0), (-9.0, 0.0, 3.0)], // the first swallows the pole
            vec![(5.0, 5.0, 4.0), (-5.0, -5.0, 4.0)],
        ];
        for holes in cases {
            for chord in [1.0, 2.8] {
                let tris = run(big, &holes, chord).unwrap_or_else(|| panic!("{holes:?} chord {chord}: refused"));
                let mut area = 0.0;
                for t in &tris {
                    area += tri_area(t);
                    let cen = scale(add(add(t[0], t[1]), t[2]), 1.0 / 3.0);
                    assert!(dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), cen) > 0.0, "{holes:?}: a triangle faces inward");
                }
                let exact = 4.0 * PI * big * big - holes.iter().map(|&(x, y, r)| 2.0 * cap_area(big, r, (x * x + y * y).sqrt())).sum::<f64>();
                let err = (area - exact).abs() / exact;
                assert!(err < 0.02, "{holes:?} chord {chord}: area {area} vs {exact} ({:.2}%)", err * 100.0);
            }
        }
    }
}
