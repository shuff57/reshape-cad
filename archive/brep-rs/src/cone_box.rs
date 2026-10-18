//! A cone against a box that has a face square to the cone's axis (W3 S1, SPEC-brep-cone-booleans.md): the geometry core, P0.
//!
//! Frame: the cone's base centre is the origin, its axis is +z, the base has radius `r` and the apex is at height `h`; the cone's
//! radius at height z is `w(z) = r (1 - z / h)`. The box is `lo <= p <= hi`. Every box plane is then square to the axis (a circle on
//! the cone) or parallel to it (a hyperbola), never tilted.
//!
//! The cone's slanted face is ruled, so for each angle theta the box restricts it to ONE vertical interval: the radius `w` along the
//! generator must satisfy `lo_x <= w cos <= hi_x`, `lo_y <= w sin <= hi_y` and the height limits, which is an interval of `w`. The
//! slanted face of `cone AND box` is therefore a ladder of columns (a pair of points per station theta), no interior points needed.
//! `cone AND box` is convex, so each plane face is the convex hull of the vertices that lie on its plane.

use crate::math::{add, cross, dot, len, scale, sub, Vec3};
use std::f64::consts::TAU;

#[derive(Clone, Copy, Debug)]
pub struct ConeSpec {
    pub r: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct AlignedBox {
    pub lo: Vec3,
    pub hi: Vec3,
}

impl ConeSpec {
    pub fn w(&self, z: f64) -> f64 {
        self.r * (1.0 - z / self.h)
    }
    pub fn z(&self, w: f64) -> f64 {
        self.h * (1.0 - w / self.r)
    }
}

/// The `w` interval `(lo, hi)` the box leaves on the generator at angle `t`, unchecked for emptiness. `None` when a plane parallel to
/// the generator's own direction already excludes it.
fn raw(c: &ConeSpec, b: &AlignedBox, t: f64) -> Option<(f64, f64)> {
    let (cs, sn) = (t.cos(), t.sin());
    let z_lo = b.lo[2].max(0.0);
    let z_hi = b.hi[2].min(c.h);
    if z_hi <= z_lo {
        return None;
    }
    let (mut lo, mut hi) = (c.w(z_hi), c.w(z_lo));
    for axis in 0..2usize {
        let trig = if axis == 0 { cs } else { sn };
        let (l, u) = (b.lo[axis], b.hi[axis]);
        if trig.abs() < 1e-12 {
            if l > 0.0 || u < 0.0 {
                return None;
            }
            continue;
        }
        let (wl, wu) = if trig > 0.0 { (l / trig, u / trig) } else { (u / trig, l / trig) };
        lo = lo.max(wl);
        hi = hi.min(wu);
    }
    Some((lo, hi))
}

fn nonempty(c: &ConeSpec, b: &AlignedBox, t: f64) -> bool {
    raw(c, b, t).is_some_and(|(lo, hi)| lo <= hi)
}

/// One station of the ladder: the angle and the two ends of the vertical interval (lower point, upper point).
#[derive(Clone, Copy, Debug)]
pub struct Column {
    pub t: f64,
    pub lower: Vec3,
    pub upper: Vec3,
}

/// A run of columns: consecutive stations, closed into a ring when `cyclic`.
#[derive(Clone, Debug)]
pub struct Run {
    pub cols: Vec<Column>,
    pub cyclic: bool,
}

fn column(c: &ConeSpec, b: &AlignedBox, t: f64) -> Option<Column> {
    let (lo, hi) = raw(c, b, t)?;
    // at a pinch the two bounds are equal up to rounding: use their mean
    let (wl, wu) = if lo > hi { (0.5 * (lo + hi), 0.5 * (lo + hi)) } else { (lo, hi) };
    let (wl, wu) = (wl.max(0.0), wu.min(c.r));
    let p = |w: f64| [w * t.cos(), w * t.sin(), c.z(w)];
    Some(Column { t, lower: p(wu), upper: p(wl) })
}

/// Every angle at which two bounds on `w` are equal (where the binding bound changes, or the interval opens or closes), and where a
/// plane through the axis changes which side of it the generator is on.
fn event_angles(c: &ConeSpec, b: &AlignedBox) -> Vec<f64> {
    let (z_lo, z_hi) = (b.lo[2].max(0.0), b.hi[2].min(c.h));
    let wz = [c.w(z_lo), c.w(z_hi)];
    let mut out: Vec<f64> = vec![0.0, std::f64::consts::FRAC_PI_2, std::f64::consts::PI, 3.0 * std::f64::consts::FRAC_PI_2];
    let xs = [b.lo[0], b.hi[0]];
    let ys = [b.lo[1], b.hi[1]];
    for w in wz {
        if w < 1e-12 {
            continue;
        }
        for x in xs {
            if (x / w).abs() <= 1.0 {
                let a = (x / w).acos();
                out.push(a);
                out.push(-a);
            }
        }
        for y in ys {
            if (y / w).abs() <= 1.0 {
                let a = (y / w).asin();
                out.push(a);
                out.push(std::f64::consts::PI - a);
            }
        }
    }
    for x in xs {
        for y in ys {
            if x.abs() > 1e-14 || y.abs() > 1e-14 {
                let a = y.atan2(x);
                out.push(a);
                out.push(a + std::f64::consts::PI);
            }
        }
    }
    out.iter().map(|a| a.rem_euclid(TAU)).collect()
}

/// The slanted face's columns: a uniform lattice of `n` angles plus every event angle. Between two stations the interval is
/// non-empty throughout or empty throughout (nothing changes between events), so one test at the middle decides each cell.
pub fn runs(c: &ConeSpec, b: &AlignedBox, n: usize) -> Vec<Run> {
    let mut st: Vec<f64> = (0..n).map(|k| k as f64 * TAU / n as f64).collect();
    st.extend(event_angles(c, b));
    st.sort_by(|a, b| a.total_cmp(b));
    st.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
    let m = st.len();
    let cell_ok: Vec<bool> = (0..m).map(|k| {
        let (t0, t1) = (st[k], if k + 1 < m { st[k + 1] } else { st[0] + TAU });
        nonempty(c, b, 0.5 * (t0 + t1))
    }).collect();
    if !cell_ok.iter().any(|&x| x) {
        return vec![];
    }
    let angle = |k: usize| if k < m { st[k] } else { st[k - m] + TAU };
    // start the scan at the first cell after an empty one, so no run wraps the end, unless nothing is empty
    let first = (0..m).find(|&k| !cell_ok[k]).map(|k| (k + 1) % m).unwrap_or(0);
    let cyclic = cell_ok.iter().all(|&x| x);
    let mut out = Vec::new();
    let mut cur: Vec<f64> = Vec::new();
    for j in 0..m {
        let k = (first + j) % m;
        let t0 = st[k] + if first + j >= m && k < first { TAU } else { 0.0 };
        if cell_ok[k] {
            if cur.is_empty() {
                cur.push(t0);
            }
            cur.push(angle_after(&st, k, t0));
        } else if !cur.is_empty() {
            out.push(Run { cols: cur.iter().filter_map(|&t| column(c, b, t)).collect(), cyclic: false });
            cur.clear();
        }
    }
    if !cur.is_empty() {
        if cyclic {
            // the last station coincides with the first: drop the duplicate so the ring closes on itself
            cur.pop();
        }
        out.push(Run { cols: cur.iter().filter_map(|&t| column(c, b, t)).collect(), cyclic });
    }
    let _ = angle;
    out
}

fn angle_after(st: &[f64], k: usize, t0: f64) -> f64 {
    let m = st.len();
    let next = st[(k + 1) % m];
    if next > st[k] { t0 + (next - st[k]) } else { t0 + (next + TAU - st[k]) }
}

/// A triangle soup over welded vertices.
#[derive(Default)]
pub struct Soup {
    pub pts: Vec<Vec3>,
    pub tris: Vec<[usize; 3]>,
    pub tol: f64,
}

impl Soup {
    pub fn vertex(&mut self, p: Vec3) -> usize {
        if let Some(i) = self.pts.iter().position(|q| len(sub(*q, p)) < self.tol) {
            return i;
        }
        self.pts.push(p);
        self.pts.len() - 1
    }
}

fn hull2(pts: &[(f64, f64, usize)]) -> Vec<usize> {
    let mut p: Vec<(f64, f64, usize)> = pts.to_vec();
    p.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    p.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-12 && (a.1 - b.1).abs() < 1e-12);
    if p.len() < 3 {
        return vec![];
    }
    let cr = |o: &(f64, f64, usize), a: &(f64, f64, usize), b: &(f64, f64, usize)| (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0);
    let mut h: Vec<(f64, f64, usize)> = Vec::new();
    for q in &p {
        while h.len() >= 2 && cr(&h[h.len() - 2], &h[h.len() - 1], q) <= 0.0 {
            h.pop();
        }
        h.push(*q);
    }
    let lower = h.len() + 1;
    for q in p.iter().rev().skip(1) {
        while h.len() >= lower && cr(&h[h.len() - 2], &h[h.len() - 1], q) <= 0.0 {
            h.pop();
        }
        h.push(*q);
    }
    h.pop();
    h.iter().map(|q| q.2).collect()
}

/// The mesh of `cone AND box` as a triangle soup, or `None` when there is no region.
pub fn mesh_keep(c: &ConeSpec, b: &AlignedBox, n: usize) -> Option<Soup> {
    let rs = runs(c, b, n);
    let scale_len = c.r.max(c.h);
    let mut soup = Soup { tol: 1e-9 * scale_len, ..Default::default() };
    // 1. the slanted face
    for run in &rs {
        let m = run.cols.len();
        let pairs = if run.cyclic { m } else { m.saturating_sub(1) };
        for k in 0..pairs {
            let (c0, c1) = (&run.cols[k], &run.cols[(k + 1) % m]);
            let (a, bq, d, e) = (soup.vertex(c0.lower), soup.vertex(c0.upper), soup.vertex(c1.upper), soup.vertex(c1.lower));
            let mid = scale(add(add(c0.lower, c0.upper), add(c1.upper, c1.lower)), 0.25);
            let out = [mid[0], mid[1], c.r / c.h * (mid[0] * mid[0] + mid[1] * mid[1]).sqrt()];
            for tri in [[a, bq, d], [a, d, e]] {
                let (p0, p1, p2) = (soup.pts[tri[0]], soup.pts[tri[1]], soup.pts[tri[2]]);
                if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
                    continue;
                }
                let nrm = cross(sub(p1, p0), sub(p2, p0));
                soup.tris.push(if dot(nrm, out) >= 0.0 { tri } else { [tri[0], tri[2], tri[1]] });
            }
        }
    }
    // 2. the vertices a plane face needs besides the slanted face's: box corners inside the cone, and the box's vertical edges where
    // they cross the base plane
    let inside_cone = |p: Vec3| p[2] > 1e-9 * scale_len && p[2] < c.h - 1e-9 * scale_len && (p[0] * p[0] + p[1] * p[1]).sqrt() < c.w(p[2]) - 1e-9 * scale_len;
    let mut extra: Vec<Vec3> = Vec::new();
    for i in 0..8 {
        let p = [if i & 1 != 0 { b.hi[0] } else { b.lo[0] }, if i & 2 != 0 { b.hi[1] } else { b.lo[1] }, if i & 4 != 0 { b.hi[2] } else { b.lo[2] }];
        if inside_cone(p) {
            extra.push(p);
        }
    }
    if b.lo[2] < 0.0 && b.hi[2] > 0.0 {
        for i in 0..4 {
            let p = [if i & 1 != 0 { b.hi[0] } else { b.lo[0] }, if i & 2 != 0 { b.hi[1] } else { b.lo[1] }, 0.0];
            if (p[0] * p[0] + p[1] * p[1]).sqrt() < c.r - 1e-9 * scale_len {
                extra.push(p);
            }
        }
    }
    for p in extra {
        soup.vertex(p);
    }
    // 3. the plane faces: the convex hull of the vertices on each plane
    let z_lo = b.lo[2].max(0.0);
    let z_hi = b.hi[2].min(c.h);
    let planes: [(usize, f64, f64); 6] = [(0, b.lo[0], -1.0), (0, b.hi[0], 1.0), (1, b.lo[1], -1.0), (1, b.hi[1], 1.0), (2, z_lo, -1.0), (2, z_hi, 1.0)];
    let eps = 1e-8 * scale_len;
    let all = soup.pts.clone();
    for (axis, at, sgn) in planes {
        let on: Vec<(f64, f64, usize)> = all.iter().enumerate().filter(|(_, p)| (p[axis] - at).abs() < eps).map(|(i, p)| (p[(axis + 1) % 3], p[(axis + 2) % 3], i)).collect();
        let hull = hull2(&on);
        if hull.len() < 3 {
            continue;
        }
        let mut nrm = [0.0; 3];
        nrm[axis] = sgn;
        for k in 1..hull.len() - 1 {
            let tri = [hull[0], hull[k], hull[k + 1]];
            let (p0, p1, p2) = (soup.pts[tri[0]], soup.pts[tri[1]], soup.pts[tri[2]]);
            let cn = cross(sub(p1, p0), sub(p2, p0));
            soup.tris.push(if dot(cn, nrm) >= 0.0 { tri } else { [tri[0], tri[2], tri[1]] });
        }
    }
    if soup.tris.is_empty() {
        return None;
    }
    Some(soup)
}

impl Soup {
    pub fn volume(&self) -> f64 {
        self.tris.iter().map(|t| dot(self.pts[t[0]], cross(self.pts[t[1]], self.pts[t[2]])) / 6.0).sum()
    }
    /// Edges used other than twice, in the two directions (a closed, consistently wound mesh uses each directed edge once and its
    /// reverse once).
    pub fn open_list(&self) -> Vec<(Vec3, Vec3)> {
        use std::collections::HashMap;
        let mut m: HashMap<(usize, usize), i32> = HashMap::new();
        for t in &self.tris {
            for k in 0..3 {
                *m.entry((t[k], t[(k + 1) % 3])).or_insert(0) += 1;
            }
        }
        m.iter().filter(|(&(a, b), &n)| n != 1 || m.get(&(b, a)) != Some(&1)).map(|(&(a, b), _)| (self.pts[a], self.pts[b])).collect()
    }
    pub fn open_edges(&self) -> usize {
        use std::collections::HashMap;
        let mut m: HashMap<(usize, usize), i32> = HashMap::new();
        for t in &self.tris {
            for k in 0..3 {
                *m.entry((t[k], t[(k + 1) % 3])).or_insert(0) += 1;
            }
        }
        m.iter().filter(|(&(a, b), &n)| n != 1 || m.get(&(b, a)) != Some(&1)).count()
    }
}

/// An independent volume of `cone AND box`: the area of a disk of radius `w(z)` inside the box's rectangle, integrated over z.
pub fn overlap_volume(c: &ConeSpec, b: &AlignedBox) -> f64 {
    let (z0, z1) = (b.lo[2].max(0.0), b.hi[2].min(c.h));
    if z1 <= z0 {
        return 0.0;
    }
    let steps = 4000usize;
    let f = |z: f64| crate::ball_box::disk_rect_area(c.w(z).max(0.0), b.lo[0], b.hi[0], b.lo[1], b.hi[1]);
    let hstep = (z1 - z0) / steps as f64;
    let mut s = f(z0) + f(z1);
    for k in 1..steps {
        s += f(z0 + k as f64 * hstep) * if k % 2 == 1 { 4.0 } else { 2.0 };
    }
    s * hstep / 3.0
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// P0 (the stop rule): over random cones and boxes with a face square to the axis, the ladder-and-hull mesh of `cone AND box` is
    /// closed, consistently wound, and has the volume the independent integral gives.
    #[test]
    fn p0_the_ladder_and_hull_mesh_closes_and_has_the_right_volume() {
        let mut rng = Rng(3);
        let (mut tried, mut meshed, mut worst) = (0, 0, 0.0f64);
        let mut failures: Vec<String> = Vec::new();
        let (mut cyclic, mut with_apex, mut base_cut) = (0, 0, 0);
        for _ in 0..4000 {
            let c = ConeSpec { r: rng.range(5.0, 15.0), h: rng.range(5.0, 25.0) };
            let mut lo = [0.0; 3];
            let mut hi = [0.0; 3];
            for k in 0..2 {
                let (a, w) = (rng.range(-1.3, 1.0) * c.r, rng.range(0.2, 1.6) * c.r);
                lo[k] = a;
                hi[k] = a + w;
            }
            let (a, w) = (rng.range(-0.3, 1.0) * c.h, rng.range(0.15, 1.2) * c.h);
            lo[2] = a;
            hi[2] = a + w;
            let b = AlignedBox { lo, hi };
            let want = overlap_volume(&c, &b);
            if want < 1e-3 * c.r * c.r * c.h {
                continue;
            }
            tried += 1;
            let Some(soup) = mesh_keep(&c, &b, 720) else {
                failures.push(format!("no mesh {c:?} {b:?}"));
                continue;
            };
            let (got, open) = (soup.volume(), soup.open_edges());
            // sag is a share of the cone, not of a thin sliver of it
            let err = (got - want).abs() / (std::f64::consts::PI * c.r * c.r * c.h / 3.0);
            if open != 0 || err > 3e-5 {
                failures.push(format!("open {open} err {err:.2e} {c:?} {b:?}"));
                continue;
            }
            meshed += 1;
            worst = worst.max(err);
            let rs = runs(&c, &b, 720);
            cyclic += rs.iter().filter(|r| r.cyclic).count();
            with_apex += (b.hi[2] >= c.h && b.lo[0] <= 0.0 && b.hi[0] >= 0.0 && b.lo[1] <= 0.0 && b.hi[1] >= 0.0) as usize;
            base_cut += (b.lo[2] < 0.0) as usize;
            // doubling the lattice must cut the sag error about fourfold
            let fine = mesh_keep(&c, &b, 1440).unwrap();
            assert!(fine.open_edges() == 0 && (fine.volume() - want).abs() <= (got - want).abs() * 0.5 + 1e-9 * want, "finer lattice did not help: {c:?} {b:?}");
        }
        assert!(failures.is_empty(), "{} of {tried} failed; first: {:?}", failures.len(), failures.iter().take(3).collect::<Vec<_>>());
        eprintln!("cone_box P0: {meshed} of {tried} closed, worst volume error {worst:.2e}; full-turn runs {cyclic}, boxes holding the apex {with_apex}, boxes cutting the base {base_cut}");
    }
}
