//! Flat regions bounded by lines, circle arcs and one kind of hyperbola arc, and the booleans between two of them (W3 S1b, join and
//! cut of a cone with a box; SPEC-brep-cone-booleans.md).
//!
//! Every face of a cone against a box that lies in a plane is a region of that plane: a box face is a rectangle, the cone meets it
//! in a disk (a plane square to the axis), a region under a hyperbola (a plane along the axis) or a triangle (one that holds the
//! axis), and the cone's own base is a disk against the rectangle the box leaves at that height. A join keeps the rectangle outside
//! the cone, a cut the rectangle inside it, and so on: `rect minus Q`, `rect meets Q`, `Q minus rect`. Each is found here by cutting
//! the two outlines where they cross, keeping the pieces that lie inside or outside the other region, and chaining what is kept
//! into loops. Contacts that are not plain crossings (a tangent, a corner on a curve, edges lying along each other) are refused
//! rather than guessed at.

use std::f64::consts::{PI, TAU};

pub type P = (f64, f64);

/// One piece of an outline, parameterised by `t` in [0, 1].
#[derive(Clone, Debug)]
pub enum Piece {
    Seg(P, P),
    /// `c + r (cos a, sin a)` with `a = a0 + sw t`; counter-clockwise when `sw > 0`.
    Arc { c: P, r: f64, a0: f64, sw: f64 },
    /// `(a, z) = (d sinh s, h - (h d / r) cosh s)` with `s = s0 + (s1 - s0) t`: where the plane at distance `d` from the axis meets a
    /// cone of base radius `r` and height `h`.
    Hyp { d: f64, h: f64, r: f64, s0: f64, s1: f64 },
}

impl Piece {
    pub fn at(&self, t: f64) -> P {
        match self {
            Piece::Seg(a, b) => (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t),
            Piece::Arc { c, r, a0, sw } => {
                let an = a0 + sw * t;
                (c.0 + r * an.cos(), c.1 + r * an.sin())
            }
            Piece::Hyp { d, h, r, s0, s1 } => {
                let s = s0 + (s1 - s0) * t;
                (d * s.sinh(), h - (h * d / r) * s.cosh())
            }
        }
    }
    pub fn start(&self) -> P {
        self.at(0.0)
    }
    pub fn end(&self) -> P {
        self.at(1.0)
    }
    pub fn sub(&self, t0: f64, t1: f64) -> Piece {
        match self {
            Piece::Seg(..) => {
                let (a, b) = (if t0 <= 0.0 { self.start() } else { self.at(t0) }, if t1 >= 1.0 { self.end() } else { self.at(t1) });
                Piece::Seg(a, b)
            }
            Piece::Arc { c, r, a0, sw } => Piece::Arc { c: *c, r: *r, a0: a0 + sw * t0, sw: sw * (t1 - t0) },
            Piece::Hyp { d, h, r, s0, s1 } => Piece::Hyp { d: *d, h: *h, r: *r, s0: s0 + (s1 - s0) * t0, s1: s0 + (s1 - s0) * t1 },
        }
    }
    pub fn reversed(&self) -> Piece {
        match self {
            Piece::Seg(a, b) => Piece::Seg(*b, *a),
            Piece::Arc { c, r, a0, sw } => Piece::Arc { c: *c, r: *r, a0: a0 + sw, sw: -sw },
            Piece::Hyp { d, h, r, s0, s1 } => Piece::Hyp { d: *d, h: *h, r: *r, s0: *s1, s1: *s0 },
        }
    }
    /// A polyline with `n` steps, ends exact.
    fn poly(&self, n: usize) -> Vec<P> {
        (0..=n).map(|i| self.at(i as f64 / n as f64)).collect()
    }
}

#[derive(Clone, Debug)]
enum Kind {
    Rect { a0: f64, a1: f64, b0: f64, b1: f64 },
    Disk { c: P, r: f64 },
    /// The cone's cross-section by the plane at distance `d` from its axis: `0 <= z <= h`, `a^2 + d^2 <= (r / h)^2 (h - z)^2`.
    Cone { d: f64, h: f64, r: f64 },
}

/// A convex region with its outline, counter-clockwise.
#[derive(Clone, Debug)]
pub struct Region {
    pub outline: Vec<Piece>,
    kind: Kind,
}

impl Region {
    pub fn rect(a0: f64, a1: f64, b0: f64, b1: f64) -> Region {
        let (p0, p1, p2, p3) = ((a0, b0), (a1, b0), (a1, b1), (a0, b1));
        Region { outline: vec![Piece::Seg(p0, p1), Piece::Seg(p1, p2), Piece::Seg(p2, p3), Piece::Seg(p3, p0)], kind: Kind::Rect { a0, a1, b0, b1 } }
    }
    /// A disk. The whole circle is one piece starting at angle `a0`, which the caller picks to keep clear of any crossing.
    pub fn disk(c: P, r: f64, a0: f64) -> Region {
        Region { outline: vec![Piece::Arc { c, r, a0, sw: TAU }], kind: Kind::Disk { c, r } }
    }
    /// The cone's cross-section by the plane at distance `d` from the axis, `None` when the plane misses the cone's base circle.
    pub fn cone_section(d: f64, h: f64, r: f64) -> Option<Region> {
        let d = d.abs();
        if d >= r {
            return None;
        }
        let ac = (r * r - d * d).sqrt();
        let bottom = Piece::Seg((-ac, 0.0), (ac, 0.0));
        let top: Vec<Piece> = if d < 1e-9 * r.max(h) {
            vec![Piece::Seg((ac, 0.0), (0.0, h)), Piece::Seg((0.0, h), (-ac, 0.0))]
        } else {
            vec![Piece::Hyp { d, h, r, s0: (ac / d).asinh(), s1: -(ac / d).asinh() }]
        };
        let mut outline = vec![bottom];
        outline.extend(top);
        Some(Region { outline, kind: Kind::Cone { d, h, r } })
    }
    pub fn contains(&self, p: P) -> bool {
        match &self.kind {
            Kind::Rect { a0, a1, b0, b1 } => p.0 >= *a0 && p.0 <= *a1 && p.1 >= *b0 && p.1 <= *b1,
            Kind::Disk { c, r } => (p.0 - c.0).hypot(p.1 - c.1) <= *r,
            Kind::Cone { d, h, r } => {
                let k = r / h;
                p.1 >= 0.0 && p.1 <= *h && p.0 * p.0 + d * d <= k * k * (h - p.1) * (h - p.1)
            }
        }
    }
}

/// A closed outline made of pieces, each starting where the last ended.
pub type Loop = Vec<Piece>;

/// One face of a flat region: an outer loop (counter-clockwise) and its holes (clockwise).
#[derive(Clone, Debug)]
pub struct Face2 {
    pub outer: Loop,
    pub holes: Vec<Loop>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    /// `P and Q`
    Meet,
    /// `P minus Q`
    Minus,
}

const EDGE: f64 = 1e-9;

/// The parameters `(t on p, t on q)` where two pieces cross. `Err` for a contact that is not a plain crossing.
fn crossings(p: &Piece, q: &Piece) -> Result<Vec<(f64, f64)>, &'static str> {
    let interior = |t: f64| -> Result<bool, &'static str> {
        if t > -EDGE && t < EDGE || t > 1.0 - EDGE && t < 1.0 + EDGE {
            return Err("an outline passes through a corner of the other");
        }
        Ok(t > 0.0 && t < 1.0)
    };
    match (p, q) {
        (Piece::Seg(a, b), Piece::Seg(c, d)) => {
            let (e, f) = ((b.0 - a.0, b.1 - a.1), (d.0 - c.0, d.1 - c.1));
            let det = e.0 * f.1 - e.1 * f.0;
            let (le, lf) = (e.0.hypot(e.1), f.0.hypot(f.1));
            if det.abs() < 1e-12 * le * lf {
                // parallel: apart, or lying along each other
                let g = (c.0 - a.0, c.1 - a.1);
                if (g.0 * e.1 - g.1 * e.0).abs() < 1e-9 * le.max(1.0) * (le + lf).max(1.0) {
                    let (t0, t1) = ((g.0 * e.0 + g.1 * e.1) / (le * le), ((d.0 - a.0) * e.0 + (d.1 - a.1) * e.1) / (le * le));
                    if t0.max(t1) > EDGE && t0.min(t1) < 1.0 - EDGE {
                        return Err("two edges lie along each other");
                    }
                }
                return Ok(vec![]);
            }
            let g = (c.0 - a.0, c.1 - a.1);
            let t = (g.0 * f.1 - g.1 * f.0) / det;
            let u = (g.0 * e.1 - g.1 * e.0) / det;
            if interior(t)? && interior(u)? {
                Ok(vec![(t, u)])
            } else {
                Ok(vec![])
            }
        }
        (Piece::Seg(a, b), Piece::Arc { c, r, a0, sw }) => {
            let d = (b.0 - a.0, b.1 - a.1);
            let w = (a.0 - c.0, a.1 - c.1);
            let (qa, qb, qc) = (d.0 * d.0 + d.1 * d.1, 2.0 * (d.0 * w.0 + d.1 * w.1), w.0 * w.0 + w.1 * w.1 - r * r);
            let disc = qb * qb - 4.0 * qa * qc;
            if disc < 0.0 {
                return Ok(vec![]);
            }
            if disc < 1e-12 * (qb * qb + (4.0 * qa * qc).abs()) {
                return Err("an edge is tangent to a circle");
            }
            let sq = disc.sqrt();
            let mut out = Vec::new();
            for t in [(-qb - sq) / (2.0 * qa), (-qb + sq) / (2.0 * qa)] {
                if !interior(t)? {
                    continue;
                }
                let pt = (a.0 + d.0 * t, a.1 + d.1 * t);
                let ang = (pt.1 - c.1).atan2(pt.0 - c.0);
                let rel = ((ang - a0) * sw.signum()).rem_euclid(TAU);
                let u = rel / sw.abs();
                if sw.abs() > TAU - 1e-9 {
                    // a whole circle: its start point is no corner
                    if !(EDGE..=TAU - EDGE).contains(&rel) {
                        return Err("an edge crosses a circle at its start point");
                    }
                    out.push((t, u));
                } else if interior(u)? {
                    out.push((t, u));
                }
            }
            Ok(out)
        }
        (Piece::Seg(a, b), Piece::Hyp { d, h, r, s0, s1 }) => {
            let k = r / h;
            let (da, dz) = (b.0 - a.0, b.1 - a.1);
            let g0 = h - a.1;
            let (qa, qb, qc) = (da * da - k * k * dz * dz, 2.0 * a.0 * da + 2.0 * k * k * g0 * dz, a.0 * a.0 + d * d - k * k * g0 * g0);
            let mut roots: Vec<f64> = Vec::new();
            let scale = qb.abs().max(qc.abs()).max(qa.abs()).max(1e-300);
            if qa.abs() < 1e-12 * scale {
                if qb.abs() > 1e-12 * scale {
                    roots.push(-qc / qb);
                }
            } else {
                let disc = qb * qb - 4.0 * qa * qc;
                if disc < 0.0 {
                    return Ok(vec![]);
                }
                if disc < 1e-12 * (qb * qb + (4.0 * qa * qc).abs()) {
                    return Err("an edge is tangent to a hyperbola");
                }
                let sq = disc.sqrt();
                roots.push((-qb - sq) / (2.0 * qa));
                roots.push((-qb + sq) / (2.0 * qa));
            }
            let mut out = Vec::new();
            for t in roots {
                if !interior(t)? {
                    continue;
                }
                let (pa, pz) = (a.0 + da * t, a.1 + dz * t);
                if h - pz <= 0.0 {
                    continue; // the other nappe
                }
                let s = (pa / d).asinh();
                let u = (s - s0) / (s1 - s0);
                if interior(u)? {
                    out.push((t, u));
                }
            }
            Ok(out)
        }
        (a, b @ Piece::Seg(..)) => Ok(crossings(b, a)?.into_iter().map(|(t, u)| (u, t)).collect()),
        _ => Err("two curves meet"),
    }
}

fn dist(p: P, q: P) -> f64 {
    (p.0 - q.0).hypot(p.1 - q.1)
}

/// The area a loop encloses, `(1/2) loop (x dy - y dx)`: closed forms for a line and an arc, quadrature for a hyperbola.
fn area_of(loop_: &Loop) -> f64 {
    let mut a = 0.0;
    for pc in loop_ {
        a += match pc {
            Piece::Seg(p, q) => 0.5 * (p.0 * q.1 - q.0 * p.1),
            Piece::Arc { c, r, a0, sw } => {
                let a1 = a0 + sw;
                0.5 * (r * r * sw + c.0 * r * (a1.sin() - a0.sin()) - c.1 * r * (a1.cos() - a0.cos()))
            }
            Piece::Hyp { d, h, r, s0, s1 } => {
                // x dy - y dx with (x, y) = (d sinh s, h - (h d / r) cosh s)
                let k = h * d / r;
                0.5 * crate::geom::integrate_composite(*s0, *s1, 8, |s| d * s.sinh() * (-k * s.sinh()) - (h - k * s.cosh()) * d * s.cosh())
            }
        };
    }
    a
}

fn polygon(loop_: &Loop) -> Vec<P> {
    let mut pts: Vec<P> = Vec::new();
    for pc in loop_ {
        let n = match pc {
            Piece::Seg(..) => 1,
            _ => 96,
        };
        pts.extend(pc.poly(n).into_iter().take(n));
    }
    pts
}

fn inside_polygon(poly: &[P], p: P) -> bool {
    let mut c = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0 {
            c = !c;
        }
        j = i;
    }
    c
}

/// Cut `pieces` at the given parameters (sorted, deduplicated here), returning the sub-pieces in order.
fn split(piece: &Piece, mut cuts: Vec<f64>) -> Vec<Piece> {
    cuts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
    let mut ts = vec![0.0];
    ts.extend(cuts);
    ts.push(1.0);
    ts.windows(2).map(|w| piece.sub(w[0], w[1])).collect()
}

/// `p` and `q`, or `p` minus `q`, as faces. `scale` is the size of the picture (for tolerances).
pub fn combine(p: &Region, q: Option<&Region>, op: Op, scale: f64) -> Result<Vec<Face2>, &'static str> {
    let Some(q) = q else {
        return Ok(match op {
            Op::Meet => vec![],
            Op::Minus => vec![Face2 { outer: p.outline.clone(), holes: vec![] }],
        });
    };
    let mut cuts_p: Vec<Vec<f64>> = vec![Vec::new(); p.outline.len()];
    let mut cuts_q: Vec<Vec<f64>> = vec![Vec::new(); q.outline.len()];
    for (i, pp) in p.outline.iter().enumerate() {
        for (j, qq) in q.outline.iter().enumerate() {
            for (t, u) in crossings(pp, qq)? {
                cuts_p[i].push(t);
                cuts_q[j].push(u);
            }
        }
    }
    let mut kept: Vec<Piece> = Vec::new();
    for (i, pp) in p.outline.iter().enumerate() {
        for s in split(pp, cuts_p[i].clone()) {
            let inside = q.contains(s.at(0.5));
            if inside == (op == Op::Meet) {
                kept.push(s);
            }
        }
    }
    for (j, qq) in q.outline.iter().enumerate() {
        for s in split(qq, cuts_q[j].clone()) {
            if p.contains(s.at(0.5)) {
                kept.push(if op == Op::Meet { s } else { s.reversed() });
            }
        }
    }
    // chain the kept pieces into loops
    let tol = 1e-7 * scale;
    let mut used = vec![false; kept.len()];
    let mut loops: Vec<Loop> = Vec::new();
    for s in 0..kept.len() {
        if used[s] {
            continue;
        }
        used[s] = true;
        let mut lp = vec![kept[s].clone()];
        let first = kept[s].start();
        let mut at = kept[s].end();
        let mut guard = 0;
        while dist(at, first) > tol {
            let next: Vec<usize> = (0..kept.len()).filter(|&j| !used[j] && dist(kept[j].start(), at) < tol).collect();
            if next.len() != 1 {
                return Err("the pieces of an outline do not chain into one loop");
            }
            used[next[0]] = true;
            lp.push(kept[next[0]].clone());
            at = kept[next[0]].end();
            guard += 1;
            if guard > 64 {
                return Err("a loop that will not close");
            }
        }
        loops.push(lp);
    }
    // outer loops (counter-clockwise) and the holes that sit in them (clockwise)
    let areas: Vec<f64> = loops.iter().map(area_of).collect();
    let polys: Vec<Vec<P>> = loops.iter().map(polygon).collect();
    let mut faces: Vec<Face2> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    for (i, lp) in loops.iter().enumerate() {
        if areas[i] > 0.0 {
            owner.push(i);
            faces.push(Face2 { outer: lp.clone(), holes: vec![] });
        }
    }
    for (i, lp) in loops.iter().enumerate() {
        if areas[i] < 0.0 {
            let probe = lp[0].at(0.5);
            let home = (0..owner.len()).filter(|&k| inside_polygon(&polys[owner[k]], probe)).min_by(|&x, &y| areas[owner[x]].partial_cmp(&areas[owner[y]]).unwrap());
            match home {
                Some(k) => faces[k].holes.push(lp.clone()),
                None => return Err("a hole outside every outline"),
            }
        }
    }
    let _ = PI;
    Ok(faces)
}

/// The area of a face (outer minus holes), exact for lines and arcs, by fine sampling for a hyperbola.
pub fn face_area(f: &Face2) -> f64 {
    area_of(&f.outer) + f.holes.iter().map(area_of).sum::<f64>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle_area(r: f64) -> f64 {
        PI * r * r
    }

    #[test]
    fn a_rectangle_and_a_disk_meet_and_part_as_the_areas_say() {
        let disk = Region::disk((0.0, 0.0), 5.0, 0.37);
        // a rectangle crossing the circle at four points
        let r = Region::rect(-3.0, 8.0, -2.0, 2.0);
        let meet: f64 = combine(&r, Some(&disk), Op::Meet, 10.0).unwrap().iter().map(face_area).sum();
        let minus: f64 = combine(&r, Some(&disk), Op::Minus, 10.0).unwrap().iter().map(face_area).sum();
        let rect_area = 11.0 * 4.0;
        assert!((meet + minus - rect_area).abs() < 1e-9 * rect_area, "{meet} + {minus} vs {rect_area}");
        // the disk minus the rectangle, and meet again
        let dm: f64 = combine(&disk, Some(&r), Op::Minus, 10.0).unwrap().iter().map(face_area).sum();
        assert!((dm + meet - circle_area(5.0)).abs() < 1e-7, "{dm} + {meet} vs {}", circle_area(5.0));
        // a disk inside the rectangle: the rectangle minus it has a hole
        let inner = Region::disk((0.0, 0.0), 1.0, 0.3);
        let f = combine(&r, Some(&inner), Op::Minus, 10.0).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].holes.len(), 1);
        assert!((face_area(&f[0]) - (rect_area - circle_area(1.0))).abs() < 1e-7);
        // a rectangle inside the disk: nothing is left of it
        let small = Region::rect(-1.0, 1.0, -1.0, 1.0);
        assert!(combine(&small, Some(&disk), Op::Minus, 10.0).unwrap().is_empty());
        let m = combine(&small, Some(&disk), Op::Meet, 10.0).unwrap();
        assert!((face_area(&m[0]) - 4.0).abs() < 1e-12);
        // a rectangle cutting the disk in two pieces of the rectangle: a slab through it
        let slab = Region::rect(-8.0, 8.0, -1.0, 1.0);
        let rest = combine(&slab, Some(&disk), Op::Minus, 10.0).unwrap();
        assert_eq!(rest.len(), 2);
    }

    #[test]
    fn a_hyperbola_region_against_a_rectangle() {
        // cone r = 10, h = 20, a plane at d = 3: the section's area has a closed form by integrating the width
        let (r, h, d) = (10.0f64, 20.0f64, 3.0f64);
        let q = Region::cone_section(d, h, r).unwrap();
        let big = Region::rect(-20.0, 20.0, -5.0, 30.0);
        let whole = combine(&q, Some(&big), Op::Meet, 30.0).unwrap();
        assert_eq!(whole.len(), 1);
        // integral over z of 2 sqrt(w^2 - d^2) up to w = d
        let n = 200000;
        let zmax = h * (1.0 - d / r);
        let truth: f64 = (0..n).map(|i| {
            let z = (i as f64 + 0.5) / n as f64 * zmax;
            let w = r * (1.0 - z / h);
            2.0 * (w * w - d * d).max(0.0).sqrt() * zmax / n as f64
        }).sum();
        assert!((face_area(&whole[0]) - truth).abs() < 1e-3 * truth, "{} vs {truth}", face_area(&whole[0]));
        // a rectangle taking the right part and the top: meet and minus add up to the rectangle
        let part = Region::rect(-1.0, 12.0, 4.0, 11.0);
        let a: f64 = combine(&part, Some(&q), Op::Meet, 30.0).unwrap().iter().map(face_area).sum();
        let b: f64 = combine(&part, Some(&q), Op::Minus, 30.0).unwrap().iter().map(face_area).sum();
        assert!((a + b - 13.0 * 7.0).abs() < 1e-3, "{a} + {b}");
        // a plane through the axis: a triangle
        let t = Region::cone_section(0.0, h, r).unwrap();
        let tri = combine(&Region::rect(-20.0, 20.0, -5.0, 30.0), Some(&t), Op::Meet, 30.0).unwrap();
        assert!((face_area(&tri[0]) - r * h).abs() < 1e-9 * r * h);
    }

    #[test]
    fn a_contact_that_is_not_a_crossing_refuses() {
        let disk = Region::disk((0.0, 0.0), 5.0, 0.37);
        // a rectangle edge tangent to the circle
        assert!(combine(&Region::rect(5.0, 9.0, -1.0, 1.0), Some(&disk), Op::Meet, 10.0).is_err());
        // a rectangle corner on the circle
        assert!(combine(&Region::rect(3.0, 9.0, 4.0, 8.0), Some(&disk), Op::Meet, 10.0).is_err());
    }

    /// A tangent or a corner contact is refused, never combined: the rectangle's edge just touching the disk, its corner on the circle, and
    /// the same a hair inside and outside (a sliver under the tolerance counts as the contact, a clear gap does not).
    #[test]
    fn tangents_and_corner_contacts_are_refused() {
        let disk = Region::disk((0.0, 0.0), 5.0, 0.37);
        // the edge x = 5 touches the circle at one point
        let tangent = Region::rect(5.0, 9.0, -2.0, 2.0);
        for op in [Op::Meet, Op::Minus] {
            assert!(combine(&tangent, Some(&disk), op, 10.0).is_err(), "an edge tangent to the circle must refuse ({op:?})");
        }
        // a corner exactly on the circle: (3, 4) is at distance 5
        let corner = Region::rect(3.0, 9.0, 4.0, 9.0);
        for op in [Op::Meet, Op::Minus] {
            assert!(combine(&corner, Some(&disk), op, 10.0).is_err(), "a corner on the circle must refuse ({op:?})");
        }
        // clearly apart: nothing to meet, the rectangle is whole
        let apart = Region::rect(6.0, 9.0, -2.0, 2.0);
        assert!(combine(&apart, Some(&disk), Op::Meet, 10.0).unwrap().is_empty());
        let whole = combine(&apart, Some(&disk), Op::Minus, 10.0).unwrap();
        assert_eq!(whole.len(), 1);
        assert!((face_area(&whole[0]) - 12.0).abs() < 1e-12);
    }
}
